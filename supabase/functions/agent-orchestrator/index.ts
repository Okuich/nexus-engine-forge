import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Tool Registry (server-side) ────────────────────────────────

const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "analyze_faces",
      description: "Extract and classify all faces from CAD geometry",
      parameters: {
        type: "object",
        properties: { model_id: { type: "string" } },
        required: ["model_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "detect_holes",
      description: "Detect and classify holes (through, blind, countersunk)",
      parameters: {
        type: "object",
        properties: {
          model_id: { type: "string" },
          min_diameter: { type: "number" },
        },
        required: ["model_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "measure_thickness",
      description: "Compute wall thickness distribution",
      parameters: {
        type: "object",
        properties: {
          model_id: { type: "string" },
          sample_density: { type: "number" },
        },
        required: ["model_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "check_draft_angles",
      description: "Check draft angles on all faces",
      parameters: {
        type: "object",
        properties: {
          model_id: { type: "string" },
          pull_direction: { type: "string" },
        },
        required: ["model_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "estimate_material_cost",
      description: "Calculate raw material cost",
      parameters: {
        type: "object",
        properties: {
          material: { type: "string" },
          volume_cm3: { type: "number" },
          bounding_volume_cm3: { type: "number" },
        },
        required: ["material", "volume_cm3"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "estimate_machining_time",
      description: "Estimate CNC machining cycle time",
      parameters: {
        type: "object",
        properties: {
          face_count: { type: "number" },
          hole_count: { type: "number" },
          material: { type: "string" },
          complexity_score: { type: "number" },
        },
        required: ["face_count", "material"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "run_stress_analysis",
      description: "Quick FEA stress analysis",
      parameters: {
        type: "object",
        properties: {
          model_id: { type: "string" },
          load_newtons: { type: "number" },
          material: { type: "string" },
        },
        required: ["model_id", "material"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "check_manufacturability",
      description: "Score manufacturability from geometry features",
      parameters: {
        type: "object",
        properties: {
          face_count: { type: "number" },
          hole_count: { type: "number" },
          min_thickness: { type: "number" },
          complex_face_ratio: { type: "number" },
        },
        required: ["face_count", "min_thickness"],
      },
    },
  },
];

// ─── Simulated Tool Execution (replace with real backends) ──────

const MAX_RETRIES = 2;

function executeTool(name: string, args: Record<string, unknown>): Record<string, unknown> {
  switch (name) {
    case "analyze_faces":
      return {
        total_faces: 47,
        breakdown: { planar: 28, cylindrical: 12, conical: 3, toroidal: 2, bspline: 2 },
        total_area_mm2: 18432.7,
        largest_face: { id: 3, type: "planar", area: 2841.2 },
      };
    case "detect_holes":
      return {
        total_holes: 12,
        holes: [
          { id: 1, diameter: 8.0, depth: 15.0, type: "through", position: [12.5, 0, 45.2] },
          { id: 2, diameter: 5.0, depth: 8.0, type: "blind", position: [-8.3, 0, 22.1] },
          { id: 3, diameter: 3.2, depth: 25.0, type: "through", position: [0, 15.0, 0] },
        ],
        warnings: ["Hole #3: L/D ratio of 7.8 exceeds recommended 6.0"],
      };
    case "measure_thickness":
      return {
        min_thickness_mm: 1.2,
        max_thickness_mm: 14.8,
        avg_thickness_mm: 4.3,
        thin_regions: [
          { location: [12.5, -3.2, 45.0], thickness: 1.2, warning: "Below 1.5mm minimum for Ti-6Al-4V" },
        ],
        uniformity_score: 62,
      };
    case "check_draft_angles":
      return {
        faces_checked: 47,
        passing: 44,
        failing: 3,
        details: [
          { face_id: 12, angle: 1.2, required: 3.0, recommendation: "Increase draft to 3°" },
          { face_id: 23, angle: 0.8, required: 3.0, recommendation: "Critical: near-zero draft" },
        ],
      };
    case "estimate_material_cost": {
      const material = (args.material as string) || "Ti-6Al-4V";
      const volume = (args.volume_cm3 as number) || 120;
      const pricePerKg: Record<string, number> = {
        "Ti-6Al-4V": 180, "Inconel 718": 95, "Al 7075-T6": 12, "SS 316L": 8,
      };
      const densities: Record<string, number> = {
        "Ti-6Al-4V": 4.43, "Inconel 718": 8.19, "Al 7075-T6": 2.81, "SS 316L": 7.99,
      };
      const density = densities[material] || 4.43;
      const price = pricePerKg[material] || 50;
      const massKg = (volume * density) / 1000;
      const buyToFly = 3.2;
      return {
        material, volume_cm3: volume, mass_kg: Math.round(massKg * 100) / 100,
        raw_material_kg: Math.round(massKg * buyToFly * 100) / 100,
        buy_to_fly_ratio: buyToFly,
        material_cost_usd: Math.round(massKg * buyToFly * price * 100) / 100,
      };
    }
    case "estimate_machining_time": {
      const faces = (args.face_count as number) || 47;
      const holes = (args.hole_count as number) || 12;
      const complexity = (args.complexity_score as number) || 65;
      const baseHours = 2.0;
      const faceTime = faces * 0.05;
      const holeTime = holes * 0.15;
      const complexityMultiplier = 1 + (complexity / 100) * 0.8;
      const total = (baseHours + faceTime + holeTime) * complexityMultiplier;
      return {
        roughing_hours: Math.round(total * 0.4 * 100) / 100,
        finishing_hours: Math.round(total * 0.45 * 100) / 100,
        setup_hours: Math.round(total * 0.15 * 100) / 100,
        total_hours: Math.round(total * 100) / 100,
        machine_rate_usd_hr: 150,
        machining_cost_usd: Math.round(total * 150 * 100) / 100,
      };
    }
    case "run_stress_analysis":
      return {
        max_von_mises_mpa: 342.7,
        yield_strength_mpa: 880,
        safety_factor: 2.57,
        critical_location: [12.5, -3.2, 45.0],
        status: "PASS",
        recommendation: "Safety factor adequate. Consider topology optimization to reduce mass.",
      };
    case "check_manufacturability":
      return {
        overall_score: 72,
        sub_scores: {
          wall_thickness: 58, hole_accessibility: 75,
          undercuts: 85, surface_complexity: 68, symmetry: 78,
        },
        warnings: [
          "Thin wall region at inlet junction (1.2mm < 1.5mm min)",
          "Deep hole L/D=7.8 requires special tooling",
          "3 faces with insufficient draft angle",
        ],
        recommendations: [
          "Add 0.5mm reinforcement rib at Section C-7",
          "Split hole #3 into two shorter operations",
          "Increase draft on faces 12, 23 to minimum 3°",
        ],
      };
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

async function executeToolWithRetry(
  name: string,
  args: Record<string, unknown>,
): Promise<{ success: boolean; data: Record<string, unknown>; retries: number }> {
  let retries = 0;
  while (retries <= MAX_RETRIES) {
    try {
      const result = executeTool(name, args);
      if (result.error) throw new Error(result.error as string);
      return { success: true, data: result, retries };
    } catch (e) {
      retries++;
      if (retries > MAX_RETRIES) {
        return { success: false, data: { error: (e as Error).message }, retries };
      }
      await new Promise((r) => setTimeout(r, 500 * retries));
    }
  }
  return { success: false, data: { error: "Max retries exceeded" }, retries: MAX_RETRIES };
}

// ─── SSE Helpers ─────────────────────────────────────────────────

function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// ─── Main Handler ────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `You are FORGE CAD Copilot, an AI assistant for industrial CAD/CAM engineering.
You have access to three specialized agent systems:

**Geometry Agent** 📐: analyze_faces, detect_holes, measure_thickness, check_draft_angles
**Cost Agent** 💰: estimate_material_cost, estimate_machining_time  
**Simulation Agent** 🔬: run_stress_analysis, check_manufacturability

When a user asks about their model, call the relevant tools to gather data, then synthesize a clear engineering response.
For complex queries, chain multiple tools. Always cite specific numbers from tool results.
Use markdown formatting. Be concise but thorough.

Current model context: Turbine_Housing_v4.step (Ti-6Al-4V, 47 faces, 12 holes, 24847 vertices)`;

    // Phase 1: Call LLM with tools to get a plan
    const planResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        tools: TOOL_DEFINITIONS,
        stream: false,
      }),
    });

    if (!planResponse.ok) {
      const status = planResponse.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "Credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${status}`);
    }

    const planData = await planResponse.json();
    const choice = planData.choices?.[0];

    // If no tool calls, just return the text as a stream
    if (!choice?.message?.tool_calls?.length) {
      const textContent = choice?.message?.content || "I'm ready to analyze your model. What would you like to know?";
      const body = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          // Send tokens word by word for streaming effect
          const words = textContent.split(' ');
          let i = 0;
          const interval = setInterval(() => {
            if (i >= words.length) {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
              clearInterval(interval);
              return;
            }
            const token = (i === 0 ? '' : ' ') + words[i];
            controller.enqueue(encoder.encode(sseEvent({
              choices: [{ delta: { content: token } }],
            })));
            i++;
          }, 30);
        },
      });

      return new Response(body, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    // Phase 2: Execute tool calls and stream events
    const toolCalls = choice.message.tool_calls;

    const body = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        const emit = (data: unknown) => {
          controller.enqueue(encoder.encode(sseEvent(data)));
        };

        // Emit planning event
        emit({
          event: "planning",
          content: `Planning ${toolCalls.length} tool calls across agents...`,
          data: { tool_count: toolCalls.length },
        });

        // Execute all tool calls
        const toolResults: Array<{ call_id: string; name: string; result: Record<string, unknown> }> = [];

        for (const tc of toolCalls) {
          const toolName = tc.function.name;
          let toolArgs: Record<string, unknown> = {};
          try {
            toolArgs = JSON.parse(tc.function.arguments || "{}");
          } catch { /* empty */ }

          // Determine agent
          const agentMap: Record<string, string> = {
            analyze_faces: "geometry", detect_holes: "geometry",
            measure_thickness: "geometry", check_draft_angles: "geometry",
            estimate_material_cost: "cost", estimate_machining_time: "cost",
            run_stress_analysis: "simulation", check_manufacturability: "simulation",
          };

          emit({
            event: "step_start",
            agent: agentMap[toolName] || "geometry",
            tool: toolName,
            stepId: tc.id,
            content: `Running ${toolName}...`,
          });

          const result = await executeToolWithRetry(toolName, toolArgs);

          if (result.success) {
            emit({
              event: "step_complete",
              agent: agentMap[toolName] || "geometry",
              tool: toolName,
              stepId: tc.id,
              data: result.data,
              content: `✓ ${toolName} completed${result.retries > 0 ? ` (${result.retries} retries)` : ""}`,
            });
          } else {
            emit({
              event: "step_error",
              agent: agentMap[toolName] || "geometry",
              tool: toolName,
              stepId: tc.id,
              content: `✗ ${toolName} failed: ${(result.data as any).error}`,
            });
          }

          toolResults.push({
            call_id: tc.id,
            name: toolName,
            result: result.data,
          });
        }

        // Phase 3: Send results back to LLM for aggregation/synthesis
        const synthesisMessages = [
          { role: "system", content: systemPrompt },
          ...messages,
          choice.message,
          ...toolResults.map((tr) => ({
            role: "tool" as const,
            tool_call_id: tr.call_id,
            content: JSON.stringify(tr.result),
          })),
        ];

        const synthesisResponse = await fetch(
          "https://ai.gateway.lovable.dev/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: synthesisMessages,
              stream: true,
            }),
          },
        );

        if (!synthesisResponse.ok || !synthesisResponse.body) {
          emit({ event: "error", content: "Failed to synthesize results" });
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }

        // Stream synthesis tokens
        const reader = synthesisResponse.body.getReader();
        const dec = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });

          let idx: number;
          while ((idx = buf.indexOf("\n")) !== -1) {
            let line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (!line.startsWith("data: ")) continue;
            const json = line.slice(6).trim();
            if (json === "[DONE]") break;
            try {
              const p = JSON.parse(json);
              const c = p.choices?.[0]?.delta?.content;
              if (c) {
                controller.enqueue(encoder.encode(sseEvent({
                  choices: [{ delta: { content: c } }],
                })));
              }
            } catch { /* ignore */ }
          }
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("Agent orchestrator error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
