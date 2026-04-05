/**
 * Product Boundary Enforcement
 *
 * Two products with distinct market positions:
 *
 *  • **midwater** — Demand monopoly. Aggregates buyers and procurement.
 *    Features: Marketplace, RFQs, Suppliers (from buyer POV), CRM, Prospects.
 *
 *  • **fabrication_os** — Supply monopoly. Aggregates suppliers and manufacturers.
 *    Features: CAD workspace, ML/AI pipelines, simulation, engineering tools.
 *
 * No feature may belong to both products (strict separation).
 *
 * Enforcement layers:
 *  1. Frontend routing  — ProtectedRoute checks product access
 *  2. Sidebar rendering — nav groups hidden for unlicensed products
 *  3. API / edge layer  — callers pass licensed_products; functions reject
 */

// ─── Product Definitions ────────────────────────────────────────

export const PRODUCTS = ['midwater', 'fabrication_os'] as const;
export type Product = (typeof PRODUCTS)[number];

export type MarketPosition = 'demand_monopoly' | 'supply_monopoly';

export interface ProductMeta {
  id: Product;
  name: string;
  position: MarketPosition;
  description: string;
}

export const PRODUCT_CATALOG: Record<Product, ProductMeta> = {
  midwater: {
    id: 'midwater',
    name: 'Midwater',
    position: 'demand_monopoly',
    description: 'Buyer aggregation platform — marketplace, RFQs, procurement, and CRM.',
  },
  fabrication_os: {
    id: 'fabrication_os',
    name: 'Fabrication OS',
    position: 'supply_monopoly',
    description: 'Supplier aggregation platform — CAD, ML pipelines, simulation, and engineering.',
  },
};

// ─── Feature → Product Mapping ─────────────────────────────────

/** Routes owned by each product (no overlap allowed) */
export const PRODUCT_ROUTES: Record<Product, readonly string[]> = {
  midwater: ['/marketplace', '/prospects', '/crm'],
  fabrication_os: ['/', '/ml', '/pipeline', '/ml/evaluation'],
};

/** Admin route is shared — accessible from either product */
export const SHARED_ROUTES: readonly string[] = ['/admin'];

/** Sidebar nav-group labels → product */
export const PRODUCT_NAV_GROUPS: Record<string, Product> = {
  Engineering: 'fabrication_os',
  'ML & AI': 'fabrication_os',
  Business: 'midwater',
};

/** Permission prefixes → product (for API-layer checks) */
export const PERMISSION_PRODUCT_MAP: Record<string, Product> = {
  cad: 'fabrication_os',
  ml: 'fabrication_os',
  rfq: 'midwater',
  order: 'midwater',
  payment: 'midwater',
  supplier: 'midwater',
  pricing: 'midwater',
  crm: 'midwater',
};

// ─── Enforcement Helpers ────────────────────────────────────────

/** Check if user has access to a specific product */
export function hasProduct(
  licensedProducts: Product[] | string[] | null | undefined,
  product: Product,
): boolean {
  if (!licensedProducts || licensedProducts.length === 0) return false;
  return (licensedProducts as string[]).includes(product);
}

/** Check if user has access to ANY of the given products */
export function hasAnyProduct(
  licensedProducts: Product[] | string[] | null | undefined,
  products: Product[],
): boolean {
  return products.some((p) => hasProduct(licensedProducts, p));
}

/** Resolve which product a route belongs to (or null for shared/unknown) */
export function getRouteProduct(route: string): Product | null {
  if ((SHARED_ROUTES as readonly string[]).includes(route)) return null;
  for (const [product, routes] of Object.entries(PRODUCT_ROUTES)) {
    if ((routes as readonly string[]).includes(route)) return product as Product;
  }
  return null;
}

/** Check if a user can access a route based on their licensed products */
export function canAccessRouteByProduct(
  licensedProducts: Product[] | string[] | null | undefined,
  route: string,
): boolean {
  const product = getRouteProduct(route);
  if (product === null) return true; // shared or unknown routes are allowed
  return hasProduct(licensedProducts, product);
}

/** Check if a permission is allowed by the user's licensed products */
export function canUsePermissionByProduct(
  licensedProducts: Product[] | string[] | null | undefined,
  permission: string,
): boolean {
  const prefix = permission.split(':')[0];
  const product = PERMISSION_PRODUCT_MAP[prefix];
  if (!product) return true; // admin permissions etc. are product-agnostic
  return hasProduct(licensedProducts, product);
}

/** Check if a sidebar nav group should be visible */
export function isNavGroupVisible(
  licensedProducts: Product[] | string[] | null | undefined,
  groupLabel: string,
): boolean {
  const product = PRODUCT_NAV_GROUPS[groupLabel];
  if (!product) return true; // unknown groups are visible
  return hasProduct(licensedProducts, product);
}

// ─── API-Layer Middleware (for edge functions) ──────────────────

/**
 * Validate product access in an edge function.
 * Throws an object with `status` and `message` when denied.
 */
export function enforceProductAccess(
  licensedProducts: string[] | null | undefined,
  requiredProduct: Product,
): void {
  if (!hasProduct(licensedProducts, requiredProduct)) {
    throw {
      status: 403,
      message: `Access denied: requires "${requiredProduct}" product license`,
    };
  }
}

// ─── Compile-time overlap guard ─────────────────────────────────
// Ensures no route appears in both products at build time.
(function validateNoOverlap() {
  const midwater = new Set(PRODUCT_ROUTES.midwater);
  for (const r of PRODUCT_ROUTES.fabrication_os) {
    if (midwater.has(r)) {
      throw new Error(`Product boundary violation: route "${r}" is in both products`);
    }
  }
})();
