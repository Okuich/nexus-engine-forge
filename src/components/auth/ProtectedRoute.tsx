import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { evaluateRouteAccess } from '@/lib/auth/authMiddleware';
import type { AppRole, Permission } from '@/lib/auth/rbac';
import { canAccessRouteByProduct } from '@/services/productBoundary';
import { Loader2, ShieldAlert, PackageX } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  requiredRole?: AppRole;
  requiredPermissions?: Permission[];
  requireTenant?: boolean;
}

export function ProtectedRoute({ children, requiredRole, requiredPermissions, requireTenant }: Props) {
  const { user, loading, activeRole, activeTenantId, licensedProducts } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // Product boundary check
  if (!canAccessRouteByProduct(licensedProducts, location.pathname)) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <PackageX className="w-10 h-10 text-destructive mx-auto" />
          <p className="text-lg font-semibold text-foreground">Product Not Licensed</p>
          <p className="text-sm text-muted-foreground max-w-xs">
            This feature is not included in your current product license. Contact your administrator to upgrade.
          </p>
        </div>
      </div>
    );
  }

  const guard = evaluateRouteAccess(
    { isAuthenticated: !!user, userRole: activeRole, tenantId: activeTenantId },
    location.pathname,
    { requiredRole, requiredPermissions, requireTenant },
  );

  if (!guard.allowed) {
    if (guard.redirectTo) return <Navigate to={guard.redirectTo} replace />;

    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <ShieldAlert className="w-10 h-10 text-destructive mx-auto" />
          <p className="text-lg font-semibold text-foreground">Access Denied</p>
          <p className="text-sm text-muted-foreground max-w-xs">
            {guard.reason === 'insufficient_role'
              ? 'Your role does not have sufficient privileges for this page.'
              : guard.reason === 'route_denied'
              ? 'You don\'t have the required permissions.'
              : 'You need to be part of an organization to access this page.'}
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
