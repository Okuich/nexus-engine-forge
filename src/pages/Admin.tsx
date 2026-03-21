import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Shield, Users, Settings, UserPlus, Loader2, Search, Clock, Activity } from 'lucide-react';
import { toast } from 'sonner';
import type { Database } from '@/integrations/supabase/types';

type AppRole = Database['public']['Enums']['app_role'];
const ROLES: AppRole[] = ['owner', 'admin', 'engineer', 'procurement', 'supplier', 'member', 'viewer'];

const roleBadgeClass: Record<AppRole, string> = {
  owner: 'bg-primary/20 text-primary border-primary/30',
  admin: 'bg-destructive/20 text-destructive border-destructive/30',
  engineer: 'bg-accent/20 text-accent border-accent/30',
  procurement: 'bg-[hsl(var(--warning))]/20 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/30',
  supplier: 'bg-[hsl(var(--info))]/20 text-[hsl(var(--info))] border-[hsl(var(--info))]/30',
  member: 'bg-secondary text-secondary-foreground border-border',
  viewer: 'bg-muted text-muted-foreground border-border',
};

// ─── Members Tab ─────────────────────────────────────────────
function MembersTab() {
  const { activeTenantId } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<AppRole>('member');

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['admin-members', activeTenantId],
    queryFn: async () => {
      if (!activeTenantId) return [];
      const { data, error } = await supabase
        .from('tenant_members')
        .select('id, user_id, role, invited_at, joined_at')
        .eq('tenant_id', activeTenantId);
      if (error) throw error;

      // Fetch profiles for each member
      const userIds = data.map((m: any) => m.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, email, full_name, avatar_url')
        .in('id', userIds);

      const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
      return data.map((m: any) => ({
        ...m,
        profile: profileMap.get(m.user_id) ?? { email: 'unknown', full_name: '' },
      }));
    },
    enabled: !!activeTenantId,
  });

  const updateRole = useMutation({
    mutationFn: async ({ memberId, newRole }: { memberId: string; newRole: AppRole }) => {
      const { error } = await supabase
        .from('tenant_members')
        .update({ role: newRole })
        .eq('id', memberId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-members'] });
      toast.success('Role updated');
    },
    onError: (e) => toast.error(e.message),
  });

  const removeMember = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase
        .from('tenant_members')
        .delete()
        .eq('id', memberId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-members'] });
      toast.success('Member removed');
    },
    onError: (e) => toast.error(e.message),
  });

  const filtered = members.filter((m: any) => {
    const q = search.toLowerCase();
    return (
      m.profile.email?.toLowerCase().includes(q) ||
      m.profile.full_name?.toLowerCase().includes(q) ||
      m.role?.includes(q)
    );
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search members..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={() => setInviteOpen(true)} size="sm">
          <UserPlus className="w-4 h-4 mr-1.5" />
          Invite Member
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    No members found
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((m: any) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="bg-primary/10 text-primary text-xs">
                            {(m.profile.full_name || m.profile.email || '??').slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium text-foreground">{m.profile.full_name || '—'}</p>
                          <p className="text-xs text-muted-foreground">{m.profile.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={m.role}
                        onValueChange={(val) => updateRole.mutate({ memberId: m.id, newRole: val as AppRole })}
                      >
                        <SelectTrigger className="w-[130px] h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((r) => (
                            <SelectItem key={r} value={r}>
                              <Badge variant="outline" className={`${roleBadgeClass[r]} text-xs`}>
                                {r}
                              </Badge>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground font-mono">
                        {m.joined_at
                          ? new Date(m.joined_at).toLocaleDateString()
                          : 'Pending'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 text-xs"
                        onClick={() => removeMember.mutate(m.id)}
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Invite Dialog — placeholder for invite-by-email flow */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Team Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Email address</Label>
              <Input
                type="email"
                placeholder="colleague@company.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as AppRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.filter((r) => r !== 'owner').map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                toast.info('Invite system coming soon — member invite requires email integration.');
                setInviteOpen(false);
              }}
            >
              Send Invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Audit Log Tab ───────────────────────────────────────────
function AuditLogTab() {
  const { activeTenantId } = useAuth();

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['admin-audit', activeTenantId],
    queryFn: async () => {
      if (!activeTenantId) return [];
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('tenant_id', activeTenantId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    enabled: !!activeTenantId,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="w-4 h-4 text-muted-foreground" />
          Recent Activity
        </CardTitle>
        <CardDescription>Last 50 audit events for this organization</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Action</TableHead>
              <TableHead>Resource</TableHead>
              <TableHead>Timestamp</TableHead>
              <TableHead>IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                  No audit logs yet
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log: any) => (
                <TableRow key={log.id}>
                  <TableCell>
                    <Badge variant="outline" className="text-xs font-mono">
                      {log.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {log.resource_type}
                    {log.resource_id && <span className="font-mono ml-1 text-xs">#{log.resource_id.slice(0, 8)}</span>}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {new Date(log.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {log.ip_address ?? '—'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Tenant Settings Tab ─────────────────────────────────────
function TenantSettingsTab() {
  const { activeTenantId, tenants } = useAuth();
  const queryClient = useQueryClient();
  const activeTenant = tenants.find((t) => t.tenant_id === activeTenantId);

  const [name, setName] = useState(activeTenant?.tenant_name ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!activeTenantId) return;
    setSaving(true);
    const { error } = await supabase
      .from('tenants')
      .update({ name, updated_at: new Date().toISOString() })
      .eq('id', activeTenantId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Settings saved');
      queryClient.invalidateQueries({ queryKey: ['admin-members'] });
    }
  };

  return (
    <div className="space-y-6 max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Organization Details</CardTitle>
          <CardDescription>Manage your organization's name and settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Organization Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground">Slug</Label>
            <Input value={activeTenant?.tenant_slug ?? ''} disabled className="font-mono text-sm" />
            <p className="text-xs text-muted-foreground">Cannot be changed after creation</p>
          </div>
          <Separator />
          <Button onClick={handleSave} disabled={saving} size="sm">
            {saving && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}
            Save Changes
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="w-4 h-4 text-muted-foreground" />
            Organization Stats
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg bg-secondary/50 p-4">
              <p className="text-2xl font-bold text-foreground">{tenants.length}</p>
              <p className="text-xs text-muted-foreground">Your Organizations</p>
            </div>
            <div className="rounded-lg bg-secondary/50 p-4">
              <p className="text-2xl font-bold text-foreground">—</p>
              <p className="text-xs text-muted-foreground">Active Members</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Admin Page ─────────────────────────────────────────
export default function Admin() {
  const { isAdmin, activeRole } = useAuth();

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-2">
          <Shield className="w-10 h-10 text-muted-foreground mx-auto" />
          <h2 className="text-lg font-semibold text-foreground">Access Denied</h2>
          <p className="text-sm text-muted-foreground">
            You need admin or owner permissions to access this page.
            <br />
            Current role: <Badge variant="outline">{activeRole ?? 'none'}</Badge>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">Admin Dashboard</h1>
          <p className="text-sm text-muted-foreground">Manage users, roles, and organization settings</p>
        </div>

        <Tabs defaultValue="members">
          <TabsList className="bg-secondary/50">
            <TabsTrigger value="members" className="gap-1.5">
              <Users className="w-3.5 h-3.5" />
              Members
            </TabsTrigger>
            <TabsTrigger value="audit" className="gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              Audit Log
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5">
              <Settings className="w-3.5 h-3.5" />
              Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="members" className="mt-4">
            <MembersTab />
          </TabsContent>
          <TabsContent value="audit" className="mt-4">
            <AuditLogTab />
          </TabsContent>
          <TabsContent value="settings" className="mt-4">
            <TenantSettingsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
