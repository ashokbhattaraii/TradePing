export type UserRole = string;
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'INVITED';

export interface AuthUser {
  id: string;
  sub: string;
  email: string;
  name: string;
  picture: string | null;
  role: UserRole;
  /** Effective permissions resolved from role + per-user overrides. Populated by AuthGuard. */
  permissions?: string[];
  status?: UserStatus;
}

export interface AuthSession {
  token: string;
  user: AuthUser;
  expiresAt: string;
}
