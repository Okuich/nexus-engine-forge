/**
 * Product Boundary — Public API
 */
export {
  PRODUCTS,
  PRODUCT_ROUTES,
  SHARED_ROUTES,
  PRODUCT_NAV_GROUPS,
  PERMISSION_PRODUCT_MAP,
  hasProduct,
  hasAnyProduct,
  getRouteProduct,
  canAccessRouteByProduct,
  canUsePermissionByProduct,
  isNavGroupVisible,
  enforceProductAccess,
} from './productBoundary';

export type { Product } from './productBoundary';
