import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { startSessionRefreshLoop, stopSessionRefreshLoop } from '@/lib/auth/authService';
import { createPermissionChecker, type PermissionChecker } from '@/lib/auth/authMiddleware';
import type { AppRole, Permission } from '@/lib/auth/rbac';
import type { User, Session } from '@supabase/supabase-js';

interface TenantMembership {
  tenant_id: string;
  role: AppRole;
  tenant_name: string;
  tenant_slug: string;
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
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<TenantMembership[]>([]);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);

  const fetchTenants = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('tenant_members')
      .select('tenant_id, role, tenants:tenant_id(name, slug)')
      .eq('user_id', userId);

    if (data) {
      const memberships: TenantMembership[] = data.map((d: any) => ({
        tenant_id: d.tenant_id,
        role: d.role as AppRole,
        tenant_name: d.tenants?.name ?? '',
        tenant_slug: d.tenants?.slug ?? '',
      }));
      setTenants(memberships);
      if (memberships.length > 0 && !activeTenantId) {
        setActiveTenantId(memberships[0].tenant_id);
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
  const permissions = createPermissionChecker(activeRole);

  const value: AuthState = {
    user,
    session,
    loading,
    tenants,
    activeTenantId,
    activeRole,
    setActiveTenant: setActiveTenantId,
    signOut: async () => {
      stopSessionRefreshLoop();
      await supabase.auth.signOut();
    },
    hasRole: (role: string) => activeMembership?.role === role,
    isAdmin: activeRole === 'admin' || activeRole === 'owner',
    isOwner: activeRole === 'owner',
    permissions,
    can: (permission: Permission) => permissions.can(permission),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
