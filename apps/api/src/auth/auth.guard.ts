import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import type { AuthUser } from './auth.types';
import { IS_PUBLIC_KEY } from './public.decorator';

export interface AuthenticatedRequest extends Request {
  authUser?: AuthUser;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);
    request.authUser = this.auth.verifySessionToken(token);
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
