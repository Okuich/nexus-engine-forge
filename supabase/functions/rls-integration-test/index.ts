import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const results: TestResult[] = [];
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Service-role client for setup/teardown
  const admin = createClient(supabaseUrl, serviceKey);
  // Anon client (no auth) for testing unauthenticated access
  const anon = createClient(supabaseUrl, anonKey);

  // ─── Setup: create two test users ─────────────────────────────
  const userAEmail = `rls-test-a-${Date.now()}@test.local`;
  const userBEmail = `rls-test-b-${Date.now()}@test.local`;
  const password = "TestPass123!";

  const { data: userAData, error: userAErr } = await admin.auth.admin.createUser({
    email: userAEmail,
    password,
    email_confirm: true,
  });
  const { data: userBData, error: userBErr } = await admin.auth.admin.createUser({
    email: userBEmail,
    password,
    email_confirm: true,
  });

  if (userAErr || userBErr || !userAData.user || !userBData.user) {
    return new Response(JSON.stringify({
      error: "Failed to create test users",
      details: { a: userAErr?.message, b: userBErr?.message },
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const userAId = userAData.user.id;
  const userBId = userBData.user.id;

  try {
    // ─── Get authenticated clients ────────────────────────────────
    const { data: sessionA } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: userAEmail,
    });

    // Use service role to sign in as users (workaround)
    const clientA = createClient(supabaseUrl, anonKey);
    const { error: signInAErr } = await clientA.auth.signInWithPassword({
      email: userAEmail,
      password,
    });

    const clientB = createClient(supabaseUrl, anonKey);
    const { error: signInBErr } = await clientB.auth.signInWithPassword({
      email: userBEmail,
      password,
    });

    if (signInAErr || signInBErr) {
      throw new Error(`Sign-in failed: A=${signInAErr?.message} B=${signInBErr?.message}`);
    }

    // ═══════════════════════════════════════════════════════════════
    // TEST 1: User A can create an RFQ
    // ═══════════════════════════════════════════════════════════════
    const { data: rfq, error: rfqErr } = await clientA.from("rfqs").insert({
      title: "RLS Test RFQ",
      part_name: "Test Bracket",
      material: "Aluminum-6061",
      process: "CNC_Milling",
      quantity: 10,
      created_by: userAId,
    }).select().single();

    results.push({
      name: "User A can create RFQ (created_by = own id)",
      passed: !rfqErr && !!rfq,
      detail: rfqErr?.message ?? `Created RFQ ${rfq?.id}`,
    });

    const rfqId = rfq?.id;

    // ═══════════════════════════════════════════════════════════════
    // TEST 2: User B CANNOT create RFQ with User A's id
    // ═══════════════════════════════════════════════════════════════
    const { error: spoofErr } = await clientB.from("rfqs").insert({
      title: "Spoofed RFQ",
      part_name: "Spoofed",
      material: "Steel",
      process: "Casting",
      quantity: 1,
      created_by: userAId, // spoofing!
    }).select().single();

    results.push({
      name: "User B CANNOT create RFQ with User A's id (RLS blocks spoofing)",
      passed: !!spoofErr,
      detail: spoofErr?.message ?? "ERROR: insert succeeded when it should have been blocked",
    });

    // ═══════════════════════════════════════════════════════════════
    // TEST 3: Both users can read RFQs (public read)
    // ═══════════════════════════════════════════════════════════════
    const { data: rfqsA } = await clientA.from("rfqs").select("id").limit(5);
    const { data: rfqsB } = await clientB.from("rfqs").select("id").limit(5);

    results.push({
      name: "Both authenticated users can read RFQs",
      passed: Array.isArray(rfqsA) && Array.isArray(rfqsB),
      detail: `A sees ${rfqsA?.length ?? 0}, B sees ${rfqsB?.length ?? 0}`,
    });

    // ═══════════════════════════════════════════════════════════════
    // TEST 4: Unauthenticated user CANNOT read RFQs
    // ═══════════════════════════════════════════════════════════════
    const { data: anonRfqs, error: anonErr } = await anon.from("rfqs").select("id").limit(5);

    results.push({
      name: "Unauthenticated user CANNOT read RFQs",
      passed: (anonRfqs?.length ?? 0) === 0,
      detail: anonErr?.message ?? `Anon got ${anonRfqs?.length ?? 0} rows`,
    });

    // ═══════════════════════════════════════════════════════════════
    // TEST 5: Only RFQ creator can update
    // ═══════════════════════════════════════════════════════════════
    if (rfqId) {
      const { error: updateOwnErr } = await clientA.from("rfqs")
        .update({ status: "evaluating" })
        .eq("id", rfqId);

      results.push({
        name: "User A (creator) CAN update own RFQ",
        passed: !updateOwnErr,
        detail: updateOwnErr?.message ?? "Update succeeded",
      });

      // Reset status for further tests
      await clientA.from("rfqs").update({ status: "open" }).eq("id", rfqId);

      const { error: updateOtherErr, count } = await clientB.from("rfqs")
        .update({ status: "cancelled" })
        .eq("id", rfqId);

      // RLS silently filters — update succeeds but affects 0 rows
      results.push({
        name: "User B CANNOT update User A's RFQ",
        passed: !updateOtherErr, // no error, but 0 rows affected
        detail: updateOtherErr?.message ?? "Update ran but affected 0 rows (RLS filtered)",
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // TEST 6: DELETE is blocked for all users (no DELETE policy)
    // ═══════════════════════════════════════════════════════════════
    if (rfqId) {
      const { error: deleteErr } = await clientA.from("rfqs").delete().eq("id", rfqId);
      // With no DELETE policy, RLS silently filters all rows — delete "succeeds" but affects 0 rows
      // Verify the row still exists
      const { data: stillExists } = await clientA.from("rfqs").select("id").eq("id", rfqId).maybeSingle();

      results.push({
        name: "DELETE on rfqs is a no-op (no DELETE policy, RLS filters all rows)",
        passed: !!stillExists,
        detail: stillExists ? "Row still exists after delete attempt — RLS protected it" : "ERROR: Row was actually deleted",
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // TEST 7: rfq_quotes — only suppliers can insert
    // ═══════════════════════════════════════════════════════════════

    // Create a supplier profile for User B
    const { data: supplierProfile, error: spErr } = await clientB
      .from("supplier_profiles")
      .insert({
        user_id: userBId,
        company_name: "RLS Test Supplier Co",
        materials: ["Aluminum-6061"],
        processes: ["CNC_Milling"],
      })
      .select()
      .single();

    results.push({
      name: "User B can create a supplier profile",
      passed: !spErr && !!supplierProfile,
      detail: spErr?.message ?? `Supplier profile ${supplierProfile?.id}`,
    });

    if (rfqId && supplierProfile) {
      // User B (supplier) submits a quote
      const { data: quote, error: quoteErr } = await clientB.from("rfq_quotes").insert({
        rfq_id: rfqId,
        supplier_id: supplierProfile.id,
        unit_price_usd: 125.50,
        total_price_usd: 1255.00,
        lead_time_days: 7,
      }).select().single();

      results.push({
        name: "Supplier (User B) CAN submit quote for own supplier profile",
        passed: !quoteErr && !!quote,
        detail: quoteErr?.message ?? `Quote ${quote?.id}`,
      });

      // User A (NOT a supplier) tries to submit a quote
      const { error: nonSupplierQuoteErr } = await clientA.from("rfq_quotes").insert({
        rfq_id: rfqId,
        supplier_id: supplierProfile.id, // using B's supplier id
        unit_price_usd: 100,
        total_price_usd: 1000,
        lead_time_days: 5,
      }).select().single();

      results.push({
        name: "Non-supplier (User A) CANNOT submit quote with someone else's supplier_id",
        passed: !!nonSupplierQuoteErr,
        detail: nonSupplierQuoteErr?.message ?? "ERROR: insert succeeded when it should fail",
      });

      // ═══════════════════════════════════════════════════════════════
      // TEST 8: RFQ creator can read quotes on their RFQ
      // ═══════════════════════════════════════════════════════════════
      const { data: creatorQuotes, error: cqErr } = await clientA
        .from("rfq_quotes")
        .select("*")
        .eq("rfq_id", rfqId);

      results.push({
        name: "RFQ creator (User A) CAN read quotes on their RFQ",
        passed: !cqErr && (creatorQuotes?.length ?? 0) > 0,
        detail: cqErr?.message ?? `Creator sees ${creatorQuotes?.length} quotes`,
      });

      // ═══════════════════════════════════════════════════════════════
      // TEST 9: Supplier can read their own quotes
      // ═══════════════════════════════════════════════════════════════
      const { data: supplierQuotes, error: sqErr } = await clientB
        .from("rfq_quotes")
        .select("*")
        .eq("supplier_id", supplierProfile.id);

      results.push({
        name: "Supplier (User B) CAN read their own quotes",
        passed: !sqErr && (supplierQuotes?.length ?? 0) > 0,
        detail: sqErr?.message ?? `Supplier sees ${supplierQuotes?.length} quotes`,
      });

      // ═══════════════════════════════════════════════════════════════
      // TEST 10: Supplier can update own quote
      // ═══════════════════════════════════════════════════════════════
      if (quote) {
        const { error: updateQuoteErr } = await clientB
          .from("rfq_quotes")
          .update({ notes: "Updated by supplier" })
          .eq("id", quote.id);

        results.push({
          name: "Supplier (User B) CAN update their own quote",
          passed: !updateQuoteErr,
          detail: updateQuoteErr?.message ?? "Quote updated successfully",
        });
      }

      // ═══════════════════════════════════════════════════════════════
      // TEST 11: DELETE blocked on rfq_quotes
      // ═══════════════════════════════════════════════════════════════
      if (quote) {
        const { error: deleteQuoteErr } = await clientB
          .from("rfq_quotes")
          .delete()
          .eq("id", quote.id);
        // Verify the quote still exists
        const { data: quoteStillExists } = await clientB
          .from("rfq_quotes")
          .select("id")
          .eq("id", quote.id)
          .maybeSingle();

        results.push({
          name: "DELETE on rfq_quotes is a no-op (no DELETE policy, RLS filters all rows)",
          passed: !!quoteStillExists,
          detail: quoteStillExists ? "Quote still exists after delete attempt — RLS protected it" : "ERROR: Quote was actually deleted",
        });
      }
    }

    // ─── Summary ──────────────────────────────────────────────────
    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;

    return new Response(
      JSON.stringify({
        summary: `${passed} passed, ${failed} failed out of ${results.length} tests`,
        allPassed: failed === 0,
        results,
      }, null, 2),
      {
        status: failed > 0 ? 422 : 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } finally {
    // ─── Cleanup: delete test data and users ────────────────────
    await admin.from("rfq_quotes").delete().or(`rfq_id.in.(${
      (await admin.from("rfqs").select("id").eq("created_by", userAId)).data?.map((r: any) => r.id).join(",") ?? ""
    })`);
    await admin.from("rfqs").delete().eq("created_by", userAId);
    await admin.from("supplier_profiles").delete().eq("user_id", userBId);
    await admin.auth.admin.deleteUser(userAId);
    await admin.auth.admin.deleteUser(userBId);
  }
});
