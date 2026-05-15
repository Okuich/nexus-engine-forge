import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from '@/components/ui/sidebar';
import { NavLink } from '@/components/NavLink';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import type { Permission } from '@/lib/auth/rbac';
import type { AppRole } from '@/lib/auth/rbac';
import { isNavGroupVisible } from '@/services/productBoundary';
import {
  Box,
  Brain,
  Building2,
  Check,
  ChevronsUpDown,
  FlaskConical,
  Workflow,
  ShieldCheck,
  Store,
  Users,
  UserCircle,
  LogOut,
  Shield,
  ChevronUp,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

interface NavItem {
  title: string;
  url: string;
  icon: React.ElementType;
  permissions: Permission[];
}

const engineeringItems: NavItem[] = [
  { title: 'CAD Workspace', url: '/', icon: Box, permissions: ['cad:view'] },
];

const mlItems: NavItem[] = [
  { title: 'ML Dashboard', url: '/ml', icon: Brain, permissions: ['ml:view'] },
  { title: 'Training Pipeline', url: '/pipeline', icon: Workflow, permissions: ['ml:train'] },
  { title: 'Evaluation', url: '/ml/evaluation', icon: FlaskConical, permissions: ['ml:evaluate'] },
];

const fabricationItems: NavItem[] = [
  { title: 'Fabrication', url: '/fabrication', icon: Factory, permissions: ['fab:view'] },
];

const businessItems: NavItem[] = [
  { title: 'Marketplace', url: '/marketplace', icon: Store, permissions: ['rfq:view'] },
  { title: 'Prospects', url: '/prospects', icon: Users, permissions: ['crm:view'] },
  { title: 'CRM', url: '/crm', icon: UserCircle, permissions: ['crm:view'] },
  { title: 'Admin', url: '/admin', icon: ShieldCheck, permissions: ['admin:settings'] },
];

interface NavGroupProps {
  label: string;
  items: NavItem[];
  collapsed: boolean;
}

function NavGroup({ label, items, collapsed }: NavGroupProps) {
  const { can } = useAuth();
  const location = useLocation();

  const visibleItems = items.filter(
    (item) => item.permissions.length === 0 || item.permissions.some((p) => can(p))
  );

  if (visibleItems.length === 0) return null;

  const isGroupActive = visibleItems.some((i) => location.pathname === i.url);

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="text-muted-foreground">{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {visibleItems.map((item) => (
            <SidebarMenuItem key={item.url}>
              <SidebarMenuButton asChild>
                <NavLink
                  to={item.url}
                  end
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md text-muted-foreground hover:bg-secondary/50 hover:text-foreground transition-colors"
                  activeClassName="bg-secondary text-primary font-medium"
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="text-sm">{item.title}</span>}
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function AppNavSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const { user, activeRole, signOut, tenants, activeTenantId, setActiveTenant, licensedProducts } = useAuth();

  const activeTenant = tenants.find((t) => t.tenant_id === activeTenantId);
  const initials = user?.email?.slice(0, 2).toUpperCase() ?? '??';
  const hasMultipleTenants = tenants.length > 1;

  return (
    <Sidebar collapsible="icon" className="border-r border-border">
      <SidebarContent className="bg-card">
        {/* Tenant switcher at top when multiple tenants */}
        {hasMultipleTenants && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-muted-foreground">Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md hover:bg-secondary/50 transition-colors text-left text-sm">
                    <Building2 className="h-4 w-4 shrink-0 text-primary" />
                    {!collapsed && (
                      <>
                        <span className="flex-1 truncate text-foreground font-medium">
                          {activeTenant?.tenant_name || 'Select workspace'}
                        </span>
                        <ChevronsUpDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      </>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="bottom" className="w-56">
                  <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                    Switch workspace
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {tenants.map((t) => (
                    <DropdownMenuItem
                      key={t.tenant_id}
                      onClick={() => setActiveTenant(t.tenant_id)}
                      className="flex items-center gap-2"
                    >
                      <Building2 className="h-3.5 w-3.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{t.tenant_name}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{t.role}</p>
                      </div>
                      {t.tenant_id === activeTenantId && (
                        <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {isNavGroupVisible(licensedProducts, 'Engineering') && (
          <NavGroup label="Engineering" items={engineeringItems} collapsed={collapsed} />
        )}
        {isNavGroupVisible(licensedProducts, 'ML & AI') && (
          <NavGroup label="ML & AI" items={mlItems} collapsed={collapsed} />
        )}
        {isNavGroupVisible(licensedProducts, 'Fabrication') && (
          <NavGroup label="Fabrication" items={fabricationItems} collapsed={collapsed} />
        )}
        {isNavGroupVisible(licensedProducts, 'Business') && (
          <NavGroup label="Business" items={businessItems} collapsed={collapsed} />
        )}
      </SidebarContent>

      <SidebarFooter className="bg-card border-t border-border">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 w-full px-2 py-2 rounded-md hover:bg-secondary/50 transition-colors text-left">
              <Avatar className="h-7 w-7 shrink-0">
                <AvatarFallback className="bg-primary/20 text-primary text-xs font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              {!collapsed && (
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{user?.email}</p>
                  <p className="text-[10px] text-muted-foreground font-mono flex items-center gap-1">
                    {activeRole && <Shield className="w-2.5 h-2.5" />}
                    {activeRole ?? 'no role'}
                    {activeTenant && ` · ${activeTenant.tenant_name}`}
                  </p>
                </div>
              )}
              {!collapsed && <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-48">
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">
              {activeRole ? `Role: ${activeRole}` : 'No role assigned'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut} className="text-destructive focus:text-destructive">
              <LogOut className="w-3.5 h-3.5 mr-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
