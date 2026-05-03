import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from './permissions.service';
import type { AuthSession, AuthUser } from './auth.types';

const HARDCODED_ADMINS = ['bhattaraiashok101@gmail.com'];

interface SessionPayload extends AuthUser {
  iss: 'tradeping';
  iat: number;
  exp: number;
}

function splitCsv(value?: string | null): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function parseJsonPart<T>(part: string): T {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as T;
  } catch {
    throw new UnauthorizedException('Invalid auth token');
  }
}

@Injectable()
export class AuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  async signInWithGoogle(credential: string): Promise<AuthSession> {
    if (!credential?.trim()) {
      throw new BadRequestException('Google credential is required');
    }

    const audiences = this.googleClientIds();
    if (audiences.length === 0) {
      throw new BadRequestException('Google OAuth is not configured on the API');
    }

    const client = new OAuth2Client(audiences[0]);
    const ticket = await client
      .verifyIdToken({
        idToken: credential,
        audience: audiences.length === 1 ? audiences[0] : audiences,
      })
      .catch(() => {
        throw new UnauthorizedException('Google credential could not be verified');
      });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      throw new UnauthorizedException('Google account payload is incomplete');
    }
    if (payload.email_verified === false) {
      throw new UnauthorizedException('Google account email is not verified');
    }

    const email = payload.email.toLowerCase();
    this.assertAllowedEmail(email);

    const adminByEmail = this.adminEmails().includes(email);
    // Look up first so we can decide whether to flip an INVITED row to ACTIVE
    // (first real login) versus a returning user.
    const existing = await this.prisma.user.findUnique({ where: { googleSub: payload.sub } });
    const existingByEmail = existing ? null : await this.prisma.user.findUnique({ where: { email } });

    const row = await this.prisma.user.upsert({
      where: { googleSub: payload.sub },
      update: {
        email,
        name: payload.name || email,
        picture: payload.picture ?? null,
        lastLoginAt: new Date(),
        // INVITED accounts are activated on first sign-in.
        ...(existing?.status === 'INVITED' ? { status: 'ACTIVE' } : {}),
        // Hardcoded admin promotion stays sticky as SUPER_ADMIN so the system
        // is always recoverable.
        ...(adminByEmail ? { role: 'SUPER_ADMIN' } : {}),
      },
      create: {
        googleSub: payload.sub,
        email,
        name: payload.name || email,
        picture: payload.picture ?? null,
        role: adminByEmail ? 'SUPER_ADMIN' : existingByEmail?.role ?? 'USER',
        status: existingByEmail?.status === 'INVITED' ? 'ACTIVE' : 'ACTIVE',
        permissionsGrant: existingByEmail?.permissionsGrant ?? [],
        permissionsRevoke: existingByEmail?.permissionsRevoke ?? [],
        lastLoginAt: new Date(),
      },
    });

    if (row.status === 'SUSPENDED') {
      throw new ForbiddenException('Your account has been suspended');
    }

    // Invalidate any cached snapshot (status flip from INVITED → ACTIVE etc.)
    // and resolve effective permissions so the client gets them immediately.
    this.permissions.invalidateUser(row.id);
    const resolved = await this.permissions.resolveUserPermissions(row.id);

    const user: AuthUser = {
      id: row.id,
      sub: payload.sub,
      email,
      name: row.name,
      picture: row.picture,
      role: row.role,
      status: row.status as AuthUser['status'],
      permissions: resolved ? Array.from(resolved.permissions) : [],
    };
    return this.issueSession(user);
  }

  private adminEmails(): string[] {
    return [
      ...HARDCODED_ADMINS,
      ...splitCsv(this.config.get<string>('ADMIN_EMAILS')),
    ].map((e) => e.toLowerCase());
  }

  issueSession(user: AuthUser): AuthSession {
    const now = Math.floor(Date.now() / 1000);
    const ttlDays = Number(this.config.get('AUTH_SESSION_DAYS') ?? 7);
    const expiresInSeconds = Math.max(1, ttlDays) * 24 * 60 * 60;
    const exp = now + expiresInSeconds;
    // Strip cached permissions/status from the JWT — they are resolved fresh
    // from the DB on every request so suspensions and role edits take effect.
    const { permissions: _omitPerms, status: _omitStatus, ...rest } = user;
    const payload: SessionPayload = {
      ...rest,
      iss: 'tradeping',
      iat: now,
      exp,
    };

    return {
      token: this.sign(payload),
      user,
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  verifySessionToken(token: string): AuthUser {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Invalid auth token');
    }

    const [headerPart, payloadPart, signature] = parts;
    const expected = this.signature(`${headerPart}.${payloadPart}`);
    if (!this.secureEqual(signature, expected)) {
      throw new UnauthorizedException('Invalid auth token signature');
    }

    const payload = parseJsonPart<SessionPayload>(payloadPart);
    const now = Math.floor(Date.now() / 1000);
    if (payload.iss !== 'tradeping' || !payload.id || !payload.sub || !payload.email || payload.exp <= now) {
      throw new UnauthorizedException('Auth token has expired');
    }

    return {
      id: payload.id,
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture ?? null,
      role: payload.role,
    };
  }

  private sign(payload: SessionPayload): string {
    const header = base64UrlJson({ alg: 'HS256', typ: 'JWT' });
    const body = base64UrlJson(payload);
    const signature = this.signature(`${header}.${body}`);
    return `${header}.${body}.${signature}`;
  }

  private signature(value: string): string {
    return createHmac('sha256', this.sessionSecret()).update(value).digest('base64url');
  }

  private secureEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private googleClientIds(): string[] {
    return splitCsv(this.config.get<string>('GOOGLE_CLIENT_ID'));
  }

  private sessionSecret(): string {
    const secret = this.config.get<string>('AUTH_SESSION_SECRET')?.trim();
    if (secret) return secret;
    if (process.env.NODE_ENV !== 'production') return 'tradeping-local-dev-auth-secret';
    throw new InternalServerErrorException('AUTH_SESSION_SECRET is required in production');
  }

  private assertAllowedEmail(email: string): void {
    const allowedEmails = splitCsv(this.config.get<string>('GOOGLE_ALLOWED_EMAILS')).map((item) =>
      item.toLowerCase(),
    );
    const allowedDomains = splitCsv(this.config.get<string>('GOOGLE_ALLOWED_DOMAINS')).map((item) =>
      item.toLowerCase(),
    );
    if (allowedEmails.length === 0 && allowedDomains.length === 0) return;

    const domain = email.split('@')[1] ?? '';
    if (allowedEmails.includes(email) || allowedDomains.includes(domain)) return;

    throw new UnauthorizedException('This Google account is not allowed');
  }
}
