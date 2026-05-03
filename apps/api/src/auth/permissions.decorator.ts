import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'requiredPermissions';
export const PERMISSIONS_MODE_KEY = 'requiredPermissionsMode';
export type PermissionsMode = 'all' | 'any';

/**
 * Restrict a route (or controller) to callers that hold the listed
 * permissions. Defaults to `all`-of semantics; pass `{ mode: 'any' }` to
 * allow callers that hold at least one.
 */
export function RequirePermissions(...permissions: string[]) {
  return (target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    SetMetadata(PERMISSIONS_KEY, permissions)(target, key as string, descriptor as PropertyDescriptor);
    if (!Reflect.getMetadata(PERMISSIONS_MODE_KEY, descriptor?.value ?? target)) {
      SetMetadata(PERMISSIONS_MODE_KEY, 'all')(target, key as string, descriptor as PropertyDescriptor);
    }
  };
}

export function RequireAnyPermission(...permissions: string[]) {
  return (target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    SetMetadata(PERMISSIONS_KEY, permissions)(target, key as string, descriptor as PropertyDescriptor);
    SetMetadata(PERMISSIONS_MODE_KEY, 'any')(target, key as string, descriptor as PropertyDescriptor);
  };
}
