import { describe, it, expect } from 'vitest';
import {
  PRODUCTS,
  PRODUCT_CATALOG,
  PRODUCT_ROUTES,
  SHARED_ROUTES,
  PRODUCT_NAV_GROUPS,
  PERMISSION_PRODUCT_MAP,
} from '@/services/productBoundary';
import {
  ROLE_PRODUCT_LOCK,
  resolveEffectiveProducts,
} from '@/services/accessControl';
import { ROUTE_PERMISSIONS, getPermissionsForRole, type AppRole } from '@/lib/auth/rbac';

const ROLES: AppRole[] = ['owner', 'admin', 'engineer', 'procurement', 'supplier', 'member', 'viewer'];

const FORBIDDEN_TOKENS = ['fabrication_os', 'fab:', '/fabrication'];

function assertNoForbidden(label: string, value: unknown) {
  const serialized = JSON.stringify(value);
  for (const token of FORBIDDEN_TOKENS) {
    expect(
      serialized.includes(token),
      `${label} contains forbidden token "${token}": ${serialized}`,
    ).toBe(false);
  }
}

describe('product boundary — midwater is the only product', () => {
  it('PRODUCTS contains only midwater', () => {
    expect([...PRODUCTS]).toEqual(['midwater']);
  });

  it('PRODUCT_CATALOG has no fabrication_os entry', () => {
    expect(Object.keys(PRODUCT_CATALOG)).toEqual(['midwater']);
    assertNoForbidden('PRODUCT_CATALOG', PRODUCT_CATALOG);
  });

  it('PRODUCT_ROUTES exposes no /fabrication route and only maps midwater', () => {
    expect(Object.keys(PRODUCT_ROUTES)).toEqual(['midwater']);
    for (const routes of Object.values(PRODUCT_ROUTES)) {
      expect(routes).not.toContain('/fabrication');
    }
    assertNoForbidden('PRODUCT_ROUTES', PRODUCT_ROUTES);
  });

  it('SHARED_ROUTES has no fabrication references', () => {
    assertNoForbidden('SHARED_ROUTES', SHARED_ROUTES);
  });

  it('PRODUCT_NAV_GROUPS contains no Fabrication group and maps only to midwater', () => {
    expect(Object.keys(PRODUCT_NAV_GROUPS)).not.toContain('Fabrication');
    for (const product of Object.values(PRODUCT_NAV_GROUPS)) {
      expect(product).toBe('midwater');
    }
  });

  it('PERMISSION_PRODUCT_MAP has no fab prefix and maps only to midwater', () => {
    expect(Object.keys(PERMISSION_PRODUCT_MAP)).not.toContain('fab');
    for (const product of Object.values(PERMISSION_PRODUCT_MAP)) {
      expect(product).toBe('midwater');
    }
  });
});

describe('RBAC — no fab:* permissions or /fabrication routes', () => {
  it('ROUTE_PERMISSIONS has no /fabrication entry', () => {
    expect(Object.keys(ROUTE_PERMISSIONS)).not.toContain('/fabrication');
    assertNoForbidden('ROUTE_PERMISSIONS', ROUTE_PERMISSIONS);
  });

  it.each(ROLES)('role "%s" has no fab:* permissions', (role) => {
    const perms = getPermissionsForRole(role);
    for (const p of perms) {
      expect(p.startsWith('fab:'), `role ${role} has forbidden permission ${p}`).toBe(false);
    }
  });
});

describe('access control — no fabrication_os in effective products', () => {
  it('ROLE_PRODUCT_LOCK never targets fabrication_os', () => {
    for (const product of Object.values(ROLE_PRODUCT_LOCK)) {
      expect(product).not.toBe('fabrication_os');
    }
  });

  it.each(ROLES)('resolveEffectiveProducts for "%s" returns only midwater (or empty)', (role) => {
    const effective = resolveEffectiveProducts({
      role,
      licensedProducts: ['midwater', 'fabrication_os'], // even if poisoned input is supplied
    });
    for (const p of effective) {
      expect(p).toBe('midwater');
    }
  });
});
