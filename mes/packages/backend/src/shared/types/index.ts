// ─── Ortak TypeScript Tipleri ────────────────────────────────────────────────

export type Role = 'admin' | 'supervisor' | 'operator';

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: Role;
  display_name: string | null;
  language: string;
  theme: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface SafeUser {
  id: number;
  username: string;
  role: Role;
  displayName: string | null;
  language: string;
  theme: string;
  isActive: boolean;
}

export interface JwtPayload {
  sub: number;
  username: string;
  role: Role;
}

export interface ModuleRow {
  id: string;
  name: string;
  enabled: number;
  config: string | null;
  updated_at: string;
}

export interface AuditLogEntry {
  userId?: number | null;
  username?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  details?: unknown;
  ipAddress?: string | null;
}

export interface SystemSettingRow {
  key: string;
  value: string;
  category: string;
  updated_at: string;
}

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
}