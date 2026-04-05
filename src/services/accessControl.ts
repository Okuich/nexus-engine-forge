/**
 * Role-Based Product Access Control
 *
 * Maps roles to their designated product and enforces organization-level
 * permissions. Works alongside productBoundary.ts (product → feature mapping)
 * and rbac.ts (role → permission matrix).
 *
 * Market positioning drives role locks:
 *  - `buyer` / `procurement` → midwater  (demand monopoly — buyer aggregation)
 *  - `supplier`              → fabrication_os (supply monopoly — supplier aggregation)
 *  - `owner` / `admin`       → both products (org-wide)
 *  - Other roles             → determined by their `licensed_products` membership field
 */

import type { AppRole } from '@/lib/auth/rbac';
import type { Product } from '@/services/productBoundary';
import { hasProduct } from '@/services/productBoundary';

// ─── Role → Product Mapping ────────────────────────────────────

/**
 * Roles that are hard-locked to a single product.
 * These override whatever `licensed_products` says on the membership.
 */
export const ROLE_PRODUCT_LOCK: Partial<Record<AppRole, Product>> = {
  supplier: 'fabrication_os',
  procurement: 'midwater',
};

/**
 * Alias map for domain-friendly role names used in this module.
 * "buyer" is the business term for `procurement` in the RBAC system.
 */
export const ROLE_ALIASES: Record<string, AppRole> = {
  buyer: 'procurement',
};

/** Roles that get access to all products regardless of licensing */
const ORG_WIDE_ROLES: ReadonlySet<AppRole> = new Set(['owner', 'admin']);

// ─── Organization-Level Permissions ─────────────────────────────

export type OrgPermission =
  | 'org:manage_members'
  | 'org:manage_billing'
  | 'org:manage_products'
  | 'org:view_audit_log'
  | 'org:manage_settings'
  | 'org:invite_users'
  | 'org:remove_users'
  | 'org:transfer_ownership';

const ORG_PERMISSION_MATRIX: Record<AppRole, ReadonlySet<OrgPermission>> = {
  owner: new Set([
    'org:manage_members',
    'org:manage_billing',
    'org:manage_products',
    'org:view_audit_log',
    'org:manage_settings',
    'org:invite_users',
    'org:remove_users',
    'org:transfer_ownership',
  ]),
  admin: new Set([
    'org:manage_members',
    'org:manage_billing',
    'org:manage_products',
    'org:view_audit_log',
    'org:manage_settings',
    'org:invite_users',
    'org:remove_users',
  ]),
  engineer: new Set(['org:view_audit_log']),
  procurement: new Set(['org:view_audit_log']),
  supplier: new Set<OrgPermission>(),
  member: new Set<OrgPermission>(),
  viewer: new Set<OrgPermission>(),
};

// ─── Access Resolution ──────────────────────────────────────────

export interface AccessContext {
  role: AppRole | null;
  licensedProducts: Product[] | string[];
}

/**
 * Resolve the effective product set for a user, considering role locks
 * and org-wide overrides.
 */
export function resolveEffectiveProducts(ctx: AccessContext): Product[] {
  if (!ctx.role) return [];

  // Org-wide roles get everything
  if (ORG_WIDE_ROLES.has(ctx.role)) {
    return ['midwater', 'fabrication_os'];
  }

  // Hard-locked roles ignore licensed_products
  const locked = ROLE_PRODUCT_LOCK[ctx.role];
  if (locked) return [locked];

  // Everyone else uses their membership's licensed_products
  return (ctx.licensedProducts ?? []) as Product[];
}

/**
 * Check if a user's role + license grants access to a specific product.
 */
export function canAccessProduct(ctx: AccessContext, product: Product): boolean {
  return resolveEffectiveProducts(ctx).includes(product);
}

/**
 * Check if a user has an organization-level permission.
 */
export function hasOrgPermission(role: AppRole | null, permission: OrgPermission): boolean {
  if (!role) return false;
  return ORG_PERMISSION_MATRIX[role]?.has(permission) ?? false;
}

/**
 * Get all organization permissions for a role.
 */
export function getOrgPermissions(role: AppRole | null): OrgPermission[] {
  if (!role) return [];
  return [...(ORG_PERMISSION_MATRIX[role] ?? [])];
}

/**
 * Resolve alias → canonical role name.
 */
export function resolveRole(roleOrAlias: string): AppRole {
  return ROLE_ALIASES[roleOrAlias] ?? (roleOrAlias as AppRole);
}

// ─── Enforcement ────────────────────────────────────────────────

/**
 * Enforce product access — throws on denial (for API layer use).
 */
export function enforceAccess(ctx: AccessContext, requiredProduct: Product): void {
  if (!canAccessProduct(ctx, requiredProduct)) {
    throw {
      status: 403,
      message: `Role "${ctx.role}" does not have access to the "${requiredProduct}" product`,
    };
  }
}

/**
 * Enforce organization permission — throws on denial.
 */
export function enforceOrgPermission(role: AppRole | null, permission: OrgPermission): void {
  if (!hasOrgPermission(role, permission)) {
    throw {
      status: 403,
      message: `Role "${role}" lacks organization permission "${permission}"`,
    };
  }
}

// ─── Guard: validate no product appears in multiple locked roles ─
(function validateRoleLocks() {
  const seen = new Map<Product, AppRole>();
  for (const [role, product] of Object.entries(ROLE_PRODUCT_LOCK)) {
    const prev = seen.get(product);
    if (prev) {
      throw new Error(
        `Access control violation: product "${product}" is locked to both "${prev}" and "${role}"`,
      );
    }
    seen.set(product, role as AppRole);
  }
})();
