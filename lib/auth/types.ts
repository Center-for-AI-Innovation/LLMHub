export interface AuthUser {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  emailVerified?: boolean;
  apiKeyHash?: string | null;
  apiKeyExpiresAt?: Date | null;
}

export interface AuthSessionData {
  id: string;
  userId: string;
  expiresAt: Date;
  token: string;
  createdAt: Date;
  updatedAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuthSession {
  user: AuthUser;
  session: AuthSessionData;
}
