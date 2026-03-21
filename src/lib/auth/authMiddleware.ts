/**
 * Auth Middleware
 *
 * Route protection and role enforcement utilities for the React app.
 * Provides helpers that work with React Router and the RBAC system.
 */

import type { AppRole, Permission } from './rbac';
import { roleHasPermission, roleHasAnyPermission, canAccessRoute } from './rbac';

// ─── Types ──────────────────────────────────────────────────────

export interface AuthContext {
  isAuthenticated: boolean;
  userRole: AppRole | null;
  tenantId: string | null;
}

export interface RouteGuardResult {
  allowed: boolean;
  reason?: 'unauthenticated' | 'insufficient_role' | 'no_tenant' | 'route_denied';
  redirectTo?: string;
}

// ─── Route Guards ───────────────────────────────────────────────

/**
 * Evaluate whether the current auth context can access a route.
 * Returns a decision with redirect target.
 */
export function evaluateRouteAccess(
  ctx: AuthContext,
  route: string,
  options?: {
    requiredRole?: AppRole;
    requiredPermissions?: Permission[];
    requireTenant?: boolean;
  },
): RouteGuardResult {
  // Must be authenticated
  if (!ctx.isAuthenticated) {
    return { allowed: false, reason: 'unauthenticated', redirectTo: '/login' };
  }

  // Must have a tenant if required
  if (options?.requireTenant && !ctx.tenantId) {
    return { allowed: false, reason: 'no_tenant', redirectTo: '/login' };
  }

  if (!ctx.userRole) {
    return { allowed: false, reason: 'insufficient_role', redirectTo: '/login' };
  }

  // Check specific role requirement
  if (options?.requiredRole) {
    const roleHierarchy: AppRole[] = ['owner', 'admin', 'engineer', 'procurement', 'supplier', 'member', 'viewer'];
    const requiredIdx = roleHierarchy.indexOf(options.requiredRole);
    const userIdx = roleHierarchy.indexOf(ctx.userRole);
    if (userIdx > requiredIdx) {
      return { allowed: false, reason: 'insufficient_role' };
    }
  }

  // Check specific permissions
  if (options?.requiredPermissions && options.requiredPermissions.length > 0) {
    if (!roleHasAnyPermission(ctx.userRole, options.requiredPermissions)) {
      return { allowed: false, reason: 'route_denied' };
    }
  }

  // Check route-level permissions
  if (!canAccessRoute(ctx.userRole, route)) {
    return { allowed: false, reason: 'route_denied' };
  }

  return { allowed: true };
}

/**
 * Create a permission checker bound to a specific role.
 * Useful for UI conditional rendering.
 */
export function createPermissionChecker(role: AppRole | null) {
  return {
    can: (permission: Permission): boolean =>
      role ? roleHasPermission(role, permission) : false,

    canAny: (permissions: Permission[]): boolean =>
      role ? roleHasAnyPermission(role, permissions) : false,

    canRoute: (route: string): boolean =>
      role ? canAccessRoute(role, route) : false,

    role,
  };
}

export type PermissionChecker = ReturnType<typeof createPermissionChecker>;
