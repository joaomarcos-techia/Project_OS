// Public surface of the `identity` context.
// Other contexts may only import from this file (enforced by eslint-plugin-boundaries).
//
// C3 exports:
//   - Schema entities: profiles, permissions, rolePermissions,
//     userPermissionOverrides, loginAttempts
//   - Enum: roleEnum
//   - Types: Role, Permission, RoleBundle (via types.ts)
//
// C4+ will add api.ts (cross-context calls — user lookup by id) and events.ts
// (outbox: internal.user.role_changed, internal.user.permissions_changed).
export {
  loginAttempts,
  permissions,
  profiles,
  roleEnum,
  rolePermissions,
  userPermissionOverrides,
} from './schema';
export type { Permission, Role } from './types';
