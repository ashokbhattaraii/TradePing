export interface AuthUser {
  id: string;
  sub: string;
  email: string;
  name: string;
  picture: string | null;
}

export interface AuthSession {
  token: string;
  user: AuthUser;
  expiresAt: string;
}
