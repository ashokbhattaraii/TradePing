import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { PermissionsService } from './permissions.service';
import {
  PERMISSIONS_KEY,
  PERMISSIONS_MODE_KEY,
  type PermissionsMode,
} from './permissions.decorator';
import type { AuthUser, UserStatus } from './auth.types';
import { IS_PUBLIC_KEY } from './public.decorator';

export interface AuthenticatedRequest extends Request {
  authUser?: AuthUser;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);
    const verified = this.auth.verifySessionToken(token);

    // Refresh status, role and permissions from DB so suspensions and role
    // edits take effect on the next request (within cache TTL).
    const resolved = await this.permissions.resolveUserPermissions(verified.id);
    if (!resolved) {
      throw new UnauthorizedException('User no longer exists');
    }
    if (resolved.status === 'SUSPENDED') {
      throw new ForbiddenException('Your account has been suspended');
    }

    const authUser: AuthUser = {
      ...verified,
      role: resolved.role,
      status: resolved.status as UserStatus,
      permissions: Array.from(resolved.permissions),
    };
    request.authUser = authUser;

    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required && required.length > 0) {
      const mode = (this.reflector.getAllAndOverride<PermissionsMode | undefined>(PERMISSIONS_MODE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'all');
      const ok =
        mode === 'any'
          ? this.permissions.hasAny(resolved.permissions, required)
          : this.permissions.hasAll(resolved.permissions, required);
      if (!ok) {
        throw new ForbiddenException(
          `Missing required permission${required.length > 1 ? 's' : ''}: ${required.join(', ')}`,
        );
      }
    }

    return true;
  }

  private extractToken(request: AuthenticatedRequest): string {
    const bearer = this.extractBearerToken(request.headers.authorization);
    if (bearer) return bearer;

    const queryToken = request.query.auth ?? request.query.access_token;
    if (typeof queryToken === 'string' && queryToken.trim()) return queryToken;
    if (Array.isArray(queryToken) && typeof queryToken[0] === 'string' && queryToken[0].trim()) {
      return queryToken[0];
    }

    throw new UnauthorizedException('Authentication required');
  }

  private extractBearerToken(header: string | undefined): string | null {
    const [type, token] = (header ?? '').split(' ');
    return type === 'Bearer' && token ? token : null;
  }
}
