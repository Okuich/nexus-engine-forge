import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useCallback } from 'react';

export function useAuditLog() {
  const { user, activeTenantId } = useAuth();

  const log = useCallback(async (
    action: string,
    resourceType: string,
    resourceId?: string,
    metadata?: Record<string, unknown>
  ) => {
    if (!user) return;
    await supabase.from('audit_logs').insert({
      tenant_id: activeTenantId,
      user_id: user.id,
      action,
      resource_type: resourceType,
      resource_id: resourceId ?? null,
      metadata: metadata ?? {},
    });
  }, [user, activeTenantId]);

  return { log };
}
