/**
 * Authentication + per-route rate limiting for the simplify-jobs worker.
 *
 * Two principal types are accepted:
 *   1. Supabase JWT — `Authorization: Bearer <jwt>` (Lovable session)
 *   2. API key      — `Authorization: ApiKey <key>` or header `x-api-key: <key>`
 *
 * API keys are stored hashed (sha256) in `public.simplify_api_keys` with
 * scopes (`jobs:read`, `jobs:write`). A successful key lookup hydrates the
 * principal with the owning user_id so all downstream RLS / queries behave
 * identically to a JWT call.
 *
 * Rate limiting is an in-memory token bucket per (principal, route). Edge
 * functions pin to one isolate per region/instance so this is best-effort
 * burst protection — strict global quotas need a shared store (Redis/PG).
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export type Scope = 'jobs:read' | 'jobs:write';

export interface Principal {
  userId: string;
  via: 'jwt' | 'api_key';
  apiKeyId?: string;
  scopes: Scope[];
  /** Per-instance client honoring the caller's auth (RLS-aware). */
  client: SupabaseClient;
}

// ─── API key parsing ────────────────────────────────────────────────────────
function extractApiKey(req: Request): string | null {
  const xKey = req.headers.get('x-api-key');
  if (xKey) return xKey.trim();
  const auth = req.headers.get('authorization') ?? '';
  const m = auth.match(/^ApiKey\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Issue a fresh API key (raw + hash). Caller persists the hash + prefix. */
export async function mintApiKey(): Promise<{ raw: string; hash: string; prefix: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const raw = 'sjk_' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  const hash = await sha256Hex(raw);
  return { raw, hash, prefix: raw.slice(0, 12) };
}

// ─── Principal resolution ───────────────────────────────────────────────────
function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function resolvePrincipal(req: Request): Promise<Principal | null> {
  // 1. API key wins when present (cheaper, no JWT verification round-trip).
  const apiKey = extractApiKey(req);
  if (apiKey) {
    const hash = await sha256Hex(apiKey);
    const admin = adminClient();
    const { data, error } = await admin
      .from('simplify_api_keys')
      .select('id,user_id,scopes,expires_at,revoked_at')
      .eq('key_hash', hash)
      .maybeSingle();
    if (error || !data) return null;
    if (data.revoked_at) return null;
    if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;

    // Fire-and-forget: bump last_used_at for observability.
    admin
      .from('simplify_api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', data.id)
      .then(() => {});

    // For API-key callers we use a service-role client filtered by user_id
    // explicitly in queries. We don't impersonate via JWT here.
    return {
      userId: data.user_id,
      via: 'api_key',
      apiKeyId: data.id,
      scopes: (data.scopes ?? []) as Scope[],
      client: admin,
    };
  }

  // 2. Otherwise fall back to a JWT from the Authorization header or, for
  //    transports that can't set headers (e.g. EventSource), an `access_token`
  //    query parameter.
  let auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) {
    const tokenParam = new URL(req.url).searchParams.get('access_token');
    if (tokenParam) auth = `Bearer ${tokenParam}`;
  }
  if (!auth.startsWith('Bearer ')) return null;
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data } = await client.auth.getUser();
  if (!data.user) return null;
  return {
    userId: data.user.id,
    via: 'jwt',
    scopes: ['jobs:read', 'jobs:write'],
    client,
  };
}

// ─── Per-route token-bucket rate limiter (in-memory) ────────────────────────
export interface RouteLimit {
  /** Tokens per window. */
  capacity: number;
  /** Window length in milliseconds. Tokens refill linearly. */
  windowMs: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5_000;

export function _resetBucketsForTests() {
  buckets.clear();
}

export function rateLimit(
  principal: Principal,
  route: string,
  limit: RouteLimit,
): { allowed: boolean; remaining: number; resetMs: number; retryAfter: number } {
  // API keys get their own quota line; JWT users share by user_id.
  const subject = principal.via === 'api_key' ? `k:${principal.apiKeyId}` : `u:${principal.userId}`;
  const key = `${subject}|${route}`;
  const now = Date.now();
  const refillRate = limit.capacity / limit.windowMs; // tokens per ms

  let b = buckets.get(key);
  if (!b) {
    if (buckets.size >= MAX_BUCKETS) {
      // Evict the oldest entry (Map preserves insertion order).
      const firstKey = buckets.keys().next().value;
      if (firstKey !== undefined) buckets.delete(firstKey);
    }
    b = { tokens: limit.capacity, updatedAt: now };
    buckets.set(key, b);
  } else {
    const refill = (now - b.updatedAt) * refillRate;
    b.tokens = Math.min(limit.capacity, b.tokens + refill);
    b.updatedAt = now;
  }

  if (b.tokens >= 1) {
    b.tokens -= 1;
    return {
      allowed: true,
      remaining: Math.floor(b.tokens),
      resetMs: Math.ceil((limit.capacity - b.tokens) / refillRate),
      retryAfter: 0,
    };
  }
  const retryAfterMs = Math.ceil((1 - b.tokens) / refillRate);
  return {
    allowed: false,
    remaining: 0,
    resetMs: retryAfterMs,
    retryAfter: Math.ceil(retryAfterMs / 1000),
  };
}

/** Default per-route limits tuned for typical worker usage. */
export const ROUTE_LIMITS: Record<string, RouteLimit & { scope?: Scope }> = {
  create:      { capacity: 30,  windowMs: 60_000, scope: 'jobs:write' },
  batch:       { capacity: 5,   windowMs: 60_000, scope: 'jobs:write' },
  cancel:      { capacity: 60,  windowMs: 60_000, scope: 'jobs:write' },
  retry:       { capacity: 30,  windowMs: 60_000, scope: 'jobs:write' },
  batchCancel: { capacity: 30,  windowMs: 60_000, scope: 'jobs:write' },
  status:      { capacity: 600, windowMs: 60_000, scope: 'jobs:read'  },
  batchStatus: { capacity: 600, windowMs: 60_000, scope: 'jobs:read'  },
  list:        { capacity: 120, windowMs: 60_000, scope: 'jobs:read'  },
  batchList:   { capacity: 120, windowMs: 60_000, scope: 'jobs:read'  },
  stream:      { capacity: 60,  windowMs: 60_000, scope: 'jobs:read'  },
  batchStream: { capacity: 30,  windowMs: 60_000, scope: 'jobs:read'  },
};

export function rateLimitHeaders(
  res: { remaining: number; resetMs: number; retryAfter: number },
  limit: RouteLimit,
): Record<string, string> {
  const h: Record<string, string> = {
    'X-RateLimit-Limit': String(limit.capacity),
    'X-RateLimit-Remaining': String(res.remaining),
    'X-RateLimit-Reset': String(Math.ceil(res.resetMs / 1000)),
  };
  if (res.retryAfter > 0) h['Retry-After'] = String(res.retryAfter);
  return h;
}
