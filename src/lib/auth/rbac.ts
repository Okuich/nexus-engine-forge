/**
 * Enterprise RBAC — Role-Based Access Control
 *
 * Defines a permission matrix mapping roles to granular actions.
 * Used by both UI (conditional rendering) and middleware (route guards).
 */

export type AppRole = 'owner' | 'admin' | 'engineer' | 'procurement' | 'supplier' | 'member' | 'viewer';

export type Permission =
  // CAD / Engineering
  | 'cad:view'
  | 'cad:edit'
  | 'cad:upload'
  | 'cad:analyze'
  // ML / Models
  | 'ml:view'
  | 'ml:train'
  | 'ml:deploy'
  | 'ml:evaluate'
  // (Fabrication permissions removed — Fabrication OS is a separate platform)
  // Marketplace / RFQs
  | 'rfq:view'
  | 'rfq:create'
  | 'rfq:quote'
  | 'rfq:accept'
  // Orders & Payments
  | 'order:view'
  | 'order:create'
  | 'order:manage'
  | 'payment:view'
  | 'payment:process'
  // Suppliers
  | 'supplier:view'
  | 'supplier:manage'
  | 'supplier:review'
  // Pricing
  | 'pricing:view'
  | 'pricing:manage'
  // Admin
  | 'admin:users'
  | 'admin:tenants'
  | 'admin:audit'
  | 'admin:settings'
  // Prospects / CRM
  | 'crm:view'
  | 'crm:manage';

/**
 * Permission matrix — each role maps to a set of allowed permissions.
 * Owner inherits all admin permissions.
 */
const ROLE_PERMISSIONS: Record<AppRole, ReadonlySet<Permission>> = {
  owner: new Set<Permission>([
    'cad:view', 'cad:edit', 'cad:upload', 'cad:analyze',
    'ml:view', 'ml:train', 'ml:deploy', 'ml:evaluate',
    'rfq:view', 'rfq:create', 'rfq:quote', 'rfq:accept',
    'order:view', 'order:create', 'order:manage',
    'payment:view', 'payment:process',
    'supplier:view', 'supplier:manage', 'supplier:review',
    'pricing:view', 'pricing:manage',
    'admin:users', 'admin:tenants', 'admin:audit', 'admin:settings',
    'crm:view', 'crm:manage',
  ]),

  admin: new Set<Permission>([
    'cad:view', 'cad:edit', 'cad:upload', 'cad:analyze',
    'ml:view', 'ml:train', 'ml:deploy', 'ml:evaluate',
    'rfq:view', 'rfq:create', 'rfq:quote', 'rfq:accept',
    'order:view', 'order:create', 'order:manage',
    'payment:view', 'payment:process',
    'supplier:view', 'supplier:manage', 'supplier:review',
    'pricing:view', 'pricing:manage',
    'admin:users', 'admin:audit', 'admin:settings',
    'crm:view', 'crm:manage',
  ]),

  engineer: new Set<Permission>([
    'cad:view', 'cad:edit', 'cad:upload', 'cad:analyze',
    'ml:view', 'ml:train', 'ml:evaluate',
    'rfq:view',
    'order:view',
    'supplier:view',
    'pricing:view',
  ]),

  procurement: new Set<Permission>([
    'cad:view',
    'rfq:view', 'rfq:create', 'rfq:accept',
    'order:view', 'order:create', 'order:manage',
    'payment:view', 'payment:process',
    'supplier:view', 'supplier:review',
    'pricing:view', 'pricing:manage',
    'crm:view', 'crm:manage',
  ]),

  supplier: new Set<Permission>([
    'rfq:view', 'rfq:quote',
    'order:view',
    'payment:view',
    'supplier:view', 'supplier:manage',
  ]),

  member: new Set<Permission>([
    'cad:view',
    'ml:view',
    'rfq:view',
    'order:view',
    'supplier:view',
    'pricing:view',
    'crm:view',
  ]),

  viewer: new Set<Permission>([
    'cad:view',
    'rfq:view',
    'order:view',
    'supplier:view',
  ]),
};

/** Check if a role has a specific permission */
export function roleHasPermission(role: AppRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

/** Check if a role has ALL of the given permissions */
export function roleHasAllPermissions(role: AppRole, permissions: Permission[]): boolean {
  return permissions.every(p => roleHasPermission(role, p));
}

/** Check if a role has ANY of the given permissions */
export function roleHasAnyPermission(role: AppRole, permissions: Permission[]): boolean {
  return permissions.some(p => roleHasPermission(role, p));
}

/** Get all permissions for a role */
export function getPermissionsForRole(role: AppRole): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

/** Route-to-permission mapping for automatic route protection */
export const ROUTE_PERMISSIONS: Record<string, Permission[]> = {
  '/': ['cad:view'],
  '/ml': ['ml:view'],
  '/pipeline': ['ml:train'],
  '/ml/evaluation': ['ml:evaluate'],
  
  '/marketplace': ['rfq:view'],
  '/prospects': ['crm:view'],
  '/crm': ['crm:view'],
  '/admin': ['admin:settings'],
};

/** Check if a role can access a given route */
export function canAccessRoute(role: AppRole, route: string): boolean {
  const required = ROUTE_PERMISSIONS[route];
  if (!required || required.length === 0) return true;
  return roleHasAnyPermission(role, required);
}
