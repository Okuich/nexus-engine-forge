/**
 * Enterprise Auth — Public API
 */

// RBAC
export {
  roleHasPermission,
  roleHasAllPermissions,
  roleHasAnyPermission,
  getPermissionsForRole,
  canAccessRoute,
  ROUTE_PERMISSIONS,
} from './rbac';
export type { AppRole, Permission } from './rbac';

// Auth Service
export {
  login,
  signup,
  logout,
  signInWithSSO,
  requestPasswordReset,
  updatePassword,
  getSessionInfo,
  refreshSessionIfNeeded,
  startSessionRefreshLoop,
  stopSessionRefreshLoop,
} from './authService';
export type { LoginCredentials, SignupData, AuthResult, SessionInfo, SSOProvider } from './authService';

// Middleware
export {
  evaluateRouteAccess,
  createPermissionChecker,
} from './authMiddleware';
export type { AuthContext, RouteGuardResult, PermissionChecker } from './authMiddleware';
