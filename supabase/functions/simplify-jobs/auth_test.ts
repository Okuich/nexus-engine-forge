/**
 * Unit tests for the simplify-jobs auth + rate-limit module.
 * Covers: token-bucket allow/deny, refill, header shape, scope mapping.
 */
import { assertEquals, assert } from 'jsr:@std/assert';
import {
  rateLimit,
  rateLimitHeaders,
  ROUTE_LIMITS,
  mintApiKey,
  _resetBucketsForTests,
  type Principal,
} from './auth.ts';

const fakePrincipal = (overrides: Partial<Principal> = {}): Principal =>
  ({
    userId: 'u1',
    via: 'jwt',
    scopes: ['jobs:read', 'jobs:write'],
    // deno-lint-ignore no-explicit-any
    client: {} as any,
    ...overrides,
  });

Deno.test('rateLimit: allows up to capacity, then denies', () => {
  _resetBucketsForTests();
  const p = fakePrincipal();
  const limit = { capacity: 3, windowMs: 1_000 };
  const r1 = rateLimit(p, 'create', limit);
  const r2 = rateLimit(p, 'create', limit);
  const r3 = rateLimit(p, 'create', limit);
  const r4 = rateLimit(p, 'create', limit);
  assert(r1.allowed && r2.allowed && r3.allowed);
  assertEquals(r4.allowed, false);
  assertEquals(r4.remaining, 0);
  assert(r4.retryAfter >= 1);
});

Deno.test('rateLimit: refills tokens linearly', async () => {
  _resetBucketsForTests();
  const p = fakePrincipal({ userId: 'u-refill' });
  const limit = { capacity: 2, windowMs: 100 };
  rateLimit(p, 'create', limit);
  rateLimit(p, 'create', limit);
  assertEquals(rateLimit(p, 'create', limit).allowed, false);
  await new Promise((r) => setTimeout(r, 80));
  // After 80% of the window, ~1.6 tokens should have refilled — at least one allowed.
  assertEquals(rateLimit(p, 'create', limit).allowed, true);
});

Deno.test('rateLimit: separate buckets per route and per principal kind', () => {
  _resetBucketsForTests();
  const jwt = fakePrincipal({ userId: 'shared', via: 'jwt' });
  const key = fakePrincipal({ userId: 'shared', via: 'api_key', apiKeyId: 'k-1' });
  const limit = { capacity: 1, windowMs: 1_000 };
  assert(rateLimit(jwt, 'create', limit).allowed);
  // Same user via API key → independent bucket
  assert(rateLimit(key, 'create', limit).allowed);
  // Same principal, different route → independent bucket
  assert(rateLimit(jwt, 'status', limit).allowed);
  // But repeating jwt+create should now be denied
  assertEquals(rateLimit(jwt, 'create', limit).allowed, false);
});

Deno.test('rateLimitHeaders: emits Retry-After only when blocked', () => {
  _resetBucketsForTests();
  const p = fakePrincipal({ userId: 'h' });
  const limit = { capacity: 1, windowMs: 1_000 };
  const ok = rateLimit(p, 'list', limit);
  const okHeaders = rateLimitHeaders(ok, limit);
  assertEquals(okHeaders['X-RateLimit-Limit'], '1');
  assertEquals(okHeaders['Retry-After'], undefined);

  const blocked = rateLimit(p, 'list', limit);
  const blockedHeaders = rateLimitHeaders(blocked, limit);
  assert(Number(blockedHeaders['Retry-After']) >= 1);
});

Deno.test('ROUTE_LIMITS: every documented route has a write/read scope', () => {
  for (const [route, cfg] of Object.entries(ROUTE_LIMITS)) {
    assert(cfg.capacity > 0, `route ${route} needs capacity`);
    assert(cfg.windowMs > 0, `route ${route} needs windowMs`);
    assert(['jobs:read', 'jobs:write'].includes(cfg.scope!), `route ${route} bad scope`);
  }
});

Deno.test('mintApiKey: returns prefixed raw + stable sha256 hash', async () => {
  const a = await mintApiKey();
  assert(a.raw.startsWith('sjk_'));
  assertEquals(a.hash.length, 64);
  assertEquals(a.prefix, a.raw.slice(0, 12));
  // Hashes should differ across calls.
  const b = await mintApiKey();
  assert(a.hash !== b.hash);
});
