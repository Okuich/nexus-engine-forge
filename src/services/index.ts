/**
 * Services — Public API
 */

// Product Boundary
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

// Access Control
export {
  ROLE_PRODUCT_LOCK,
  ROLE_ALIASES,
  resolveEffectiveProducts,
  canAccessProduct,
  hasOrgPermission,
  getOrgPermissions,
  resolveRole,
  enforceAccess,
  enforceOrgPermission,
} from './accessControl';
export type { OrgPermission, AccessContext } from './accessControl';
