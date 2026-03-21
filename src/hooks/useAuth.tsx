import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User, Session } from '@supabase/supabase-js';

interface TenantMembership {
  tenant_id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  tenant_name: string;
  tenant_slug: string;
}

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  tenants: TenantMembership[];
  activeTenantId: string | null;
  setActiveTenant: (id: string) => void;
  signOut: () => Promise<void>;
  hasRole: (role: string) => boolean;
  isAdmin: boolean;
  isOwner: boolean;
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
        role: d.role,
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
        } else {
          setTenants([]);
          setActiveTenantId(null);
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchTenants(session.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [fetchTenants]);

  const activeMembership = tenants.find(t => t.tenant_id === activeTenantId);

  const value: AuthState = {
    user,
    session,
    loading,
    tenants,
    activeTenantId,
    setActiveTenant: setActiveTenantId,
    signOut: async () => { await supabase.auth.signOut(); },
    hasRole: (role: string) => activeMembership?.role === role,
    isAdmin: activeMembership?.role === 'admin' || activeMembership?.role === 'owner',
    isOwner: activeMembership?.role === 'owner',
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
