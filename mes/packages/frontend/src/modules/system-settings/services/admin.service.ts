import { api } from '../../../core/services/api';

// ─── Kullanıcılar ───────────────────────────────────────────────────────────

export interface AdminUser {
  id: number;
  username: string;
  role: 'admin' | 'supervisor' | 'operator';
  displayName: string | null;
  language: string;
  theme: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserInput {
  username: string;
  password?: string;
  role: AdminUser['role'];
  displayName?: string | null;
  isActive?: boolean;
}

export const userService = {
  list: () => api.get<{ users: AdminUser[] }>('/api/users'),
  create: (input: UserInput) => api.post<{ user: AdminUser }>('/api/users', input),
  update: (id: number, input: Partial<UserInput>) =>
    api.put<{ user: AdminUser }>(`/api/users/${id}`, input),
  remove: (id: number) => api.delete<{ success: boolean }>(`/api/users/${id}`),
};

// ─── Yetkiler ───────────────────────────────────────────────────────────────

export interface PermissionEntry {
  role: string;
  moduleId: string;
  permission: string;
  granted: boolean;
}

export const permissionService = {
  list: () =>
    api.get<{ permissions: PermissionEntry[]; modules: string[]; permissionTypes: string[] }>(
      '/api/permissions'
    ),
  set: (input: { role: string; moduleId: string; permission: string; granted: boolean }) =>
    api.put<{ success: boolean }>('/api/permissions', input),
};

// ─── Ayarlar ────────────────────────────────────────────────────────────────

export interface SettingEntry {
  key: string;
  value: string;
  category: string;
  updatedAt: string;
}

export const settingsService = {
  list: () => api.get<{ settings: SettingEntry[] }>('/api/settings'),
  update: (settings: Record<string, string>) =>
    api.put<{ success: boolean }>('/api/settings', { settings }),
};

// ─── Modüller ───────────────────────────────────────────────────────────────

export interface ModuleEntry {
  id: string;
  name: string;
  enabled: boolean;
  updatedAt: string;
}

export const moduleService = {
  list: () => api.get<{ modules: ModuleEntry[] }>('/api/modules'),
  setEnabled: (id: string, enabled: boolean) =>
    api.put<{ success: boolean; restartRequired: boolean }>(`/api/modules/${id}`, { enabled }),
};

// ─── Arşiv ──────────────────────────────────────────────────────────────────

export interface ArchiveStatus {
  sizeBytes: number;
  sizeMb: number;
  warnBytes: number;
  warnExceeded: boolean;
  activeWorkOrders: number;
  canArchive: boolean;
}

export const archiveService = {
  status: () => api.get<ArchiveStatus>('/api/archive'),
  run: () => api.post<{ success: boolean; deletedRows: number }>('/api/archive'),
};

// ─── Audit ──────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: number;
  userId: number | null;
  username: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

export const auditService = {
  list: (params?: { limit?: number; offset?: number; action?: string; entityType?: string }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    if (params?.action) qs.set('action', params.action);
    if (params?.entityType) qs.set('entityType', params.entityType);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return api.get<{ entries: AuditEntry[]; total: number; limit: number; offset: number }>(
      `/api/audit${suffix}`
    );
  },
};
