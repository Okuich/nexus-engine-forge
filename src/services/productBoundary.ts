/**
 * Product Boundary Enforcement
 *
 * Midwater is a buyer aggregation platform — marketplace, RFQs,
 * procurement, CRM, and supporting engineering tools (CAD, ML).
 *
 * Note: "Fabrication OS" used to be a co-bundled supplier product. It has
 * been split out and is sold separately as its own platform. Anything
 * Fabrication-OS-specific has been removed from this codebase.
 */

// ─── Product Definitions ────────────────────────────────────────

export const PRODUCTS = ['midwater'] as const;
export type Product = (typeof PRODUCTS)[number];

export type MarketPosition = 'demand_monopoly';

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
};

// ─── Feature → Product Mapping ─────────────────────────────────

/** Routes owned by each product */
export const PRODUCT_ROUTES: Record<Product, readonly string[]> = {
  midwater: ['/', '/ml', '/pipeline', '/ml/evaluation', '/marketplace', '/prospects', '/crm'],
};

/** Admin route is shared / product-agnostic */
export const SHARED_ROUTES: readonly string[] = ['/admin'];

/** Sidebar nav-group labels → product */
export const PRODUCT_NAV_GROUPS: Record<string, Product> = {
  Engineering: 'midwater',
  'ML & AI': 'midwater',
  Business: 'midwater',
};

/** Permission prefixes → product (for API-layer checks) */
export const PERMISSION_PRODUCT_MAP: Record<string, Product> = {
  cad: 'midwater',
  ml: 'midwater',
  rfq: 'midwater',
  order: 'midwater',
  payment: 'midwater',
  supplier: 'midwater',
  pricing: 'midwater',
  crm: 'midwater',
};

// ─── Enforcement Helpers ────────────────────────────────────────

export function hasProduct(
  licensedProducts: Product[] | string[] | null | undefined,
  product: Product,
): boolean {
  if (!licensedProducts || licensedProducts.length === 0) return false;
  return (licensedProducts as string[]).includes(product);
}

export function hasAnyProduct(
  licensedProducts: Product[] | string[] | null | undefined,
  products: Product[],
): boolean {
  return products.some((p) => hasProduct(licensedProducts, p));
}

export function getRouteProduct(route: string): Product | null {
  if ((SHARED_ROUTES as readonly string[]).includes(route)) return null;
  for (const [product, routes] of Object.entries(PRODUCT_ROUTES)) {
    if ((routes as readonly string[]).includes(route)) return product as Product;
  }
  return null;
}

export function canAccessRouteByProduct(
  licensedProducts: Product[] | string[] | null | undefined,
  route: string,
): boolean {
  const product = getRouteProduct(route);
  if (product === null) return true;
  return hasProduct(licensedProducts, product);
}

export function canUsePermissionByProduct(
  licensedProducts: Product[] | string[] | null | undefined,
  permission: string,
): boolean {
  const prefix = permission.split(':')[0];
  const product = PERMISSION_PRODUCT_MAP[prefix];
  if (!product) return true;
  return hasProduct(licensedProducts, product);
}

export function isNavGroupVisible(
  licensedProducts: Product[] | string[] | null | undefined,
  groupLabel: string,
): boolean {
  const product = PRODUCT_NAV_GROUPS[groupLabel];
  if (!product) return true;
  return hasProduct(licensedProducts, product);
}

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
