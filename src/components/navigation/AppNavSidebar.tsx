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
import {
  Box,
  Brain,
  FlaskConical,
  Workflow,
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

const businessItems: NavItem[] = [
  { title: 'Marketplace', url: '/marketplace', icon: Store, permissions: ['rfq:view'] },
  { title: 'Prospects', url: '/prospects', icon: Users, permissions: ['crm:view'] },
  { title: 'CRM', url: '/crm', icon: UserCircle, permissions: ['crm:view'] },
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
  const { user, activeRole, signOut, tenants, activeTenantId } = useAuth();

  const activeTenant = tenants.find((t) => t.tenant_id === activeTenantId);
  const initials = user?.email?.slice(0, 2).toUpperCase() ?? '??';

  return (
    <Sidebar collapsible="icon" className="border-r border-border">
      <SidebarContent className="bg-card">
        <NavGroup label="Engineering" items={engineeringItems} collapsed={collapsed} />
        <NavGroup label="ML & AI" items={mlItems} collapsed={collapsed} />
        <NavGroup label="Business" items={businessItems} collapsed={collapsed} />
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
