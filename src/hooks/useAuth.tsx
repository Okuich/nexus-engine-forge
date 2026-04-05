import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { startSessionRefreshLoop, stopSessionRefreshLoop } from '@/lib/auth/authService';
import { createPermissionChecker, type PermissionChecker } from '@/lib/auth/authMiddleware';
import type { AppRole, Permission } from '@/lib/auth/rbac';
import type { User, Session } from '@supabase/supabase-js';
import type { Product } from '@/services/productBoundary';
import { canUsePermissionByProduct } from '@/services/productBoundary';
import { resolveEffectiveProducts, hasOrgPermission, type OrgPermission } from '@/services/accessControl';

interface TenantMembership {
  tenant_id: string;
  role: AppRole;
  tenant_name: string;
  tenant_slug: string;
  licensed_products: Product[];
}

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  tenants: TenantMembership[];
  activeTenantId: string | null;
  activeRole: AppRole | null;
  setActiveTenant: (id: string) => void;
  signOut: () => Promise<void>;
  // Legacy role checks
  hasRole: (role: string) => boolean;
  isAdmin: boolean;
  isOwner: boolean;
  // RBAC permission checker
  permissions: PermissionChecker;
  can: (permission: Permission) => boolean;
  // Product boundary
  licensedProducts: Product[];
  // Organization-level permissions
  canOrg: (permission: OrgPermission) => boolean;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<TenantMembership[]>([]);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(
    () => localStorage.getItem('activeTenantId')
  );

  const fetchTenants = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('tenant_members')
      .select('tenant_id, role, licensed_products, tenants:tenant_id(name, slug)')
      .eq('user_id', userId);

    if (data) {
      const memberships: TenantMembership[] = data.map((d: any) => ({
        tenant_id: d.tenant_id,
        role: d.role as AppRole,
        tenant_name: d.tenants?.name ?? '',
        tenant_slug: d.tenants?.slug ?? '',
        licensed_products: (d.licensed_products ?? ['midwater', 'fabrication_os']) as Product[],
      }));
      setTenants(memberships);
      if (memberships.length > 0 && !activeTenantId) {
        const stored = localStorage.getItem('activeTenantId');
        const valid = memberships.find(m => m.tenant_id === stored);
        setActiveTenantId(valid ? stored : memberships[0].tenant_id);
      }
    }
  }, [activeTenantId]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          setTimeout(() => fetchTenants(session.user.id), 0);
          startSessionRefreshLoop();
        } else {
          setTenants([]);
          setActiveTenantId(null);
          stopSessionRefreshLoop();
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchTenants(session.user.id);
        startSessionRefreshLoop();
      }
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
      stopSessionRefreshLoop();
    };
  }, [fetchTenants]);

  const activeMembership = tenants.find(t => t.tenant_id === activeTenantId);
  const activeRole: AppRole | null = activeMembership?.role ?? null;
  const licensedProducts: Product[] = activeMembership?.licensed_products ?? [];
  const permissions = createPermissionChecker(activeRole);

  const value: AuthState = {
    user,
    session,
    loading,
    tenants,
    activeTenantId,
    activeRole,
    setActiveTenant: (id: string) => {
      localStorage.setItem('activeTenantId', id);
      setActiveTenantId(id);
    },
    signOut: async () => {
      stopSessionRefreshLoop();
      await supabase.auth.signOut();
    },
    hasRole: (role: string) => activeMembership?.role === role,
    isAdmin: activeRole === 'admin' || activeRole === 'owner',
    isOwner: activeRole === 'owner',
    permissions,
    can: (permission: Permission) =>
      permissions.can(permission) && canUsePermissionByProduct(licensedProducts, permission),
    licensedProducts,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
