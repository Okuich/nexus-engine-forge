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

// Supplier Matcher
export {
  matchSuppliers,
  recordFeedback,
  getFeedbackAggregates,
  applyLearnedAdjustments,
  getWeightAdjustmentHistory,
  resetFeedback,
  DEFAULT_MATCH_WEIGHTS,
} from './supplierMatcher';
export type {
  MatchRequest,
  MatchWeights,
  ScoredSupplier,
  MatchOutput,
  MatchFeedback,
  FeedbackOutcome,
} from './supplierMatcher';
