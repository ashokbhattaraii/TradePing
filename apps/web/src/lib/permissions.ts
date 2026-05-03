import type { AuthUser } from './api';

export const WILDCARD = '*';

export function userPermissions(user: AuthUser | null | undefined): Set<string> {
  return new Set(user?.permissions ?? []);
}

export function hasPermission(user: AuthUser | null | undefined, key: string): boolean {
  const set = userPermissions(user);
  return set.has(WILDCARD) || set.has(key);
}

export function hasAnyPermission(user: AuthUser | null | undefined, keys: string[]): boolean {
  const set = userPermissions(user);
  if (set.has(WILDCARD)) return true;
  return keys.some((k) => set.has(k));
}

export function isSuperAdmin(user: AuthUser | null | undefined): boolean {
  return userPermissions(user).has(WILDCARD);
}
