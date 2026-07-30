// ─── Sabitler ────────────────────────────────────────────────────────────────

export const DEFAULT_PORT = 3000;
export const DEFAULT_DB_PATH = './data/mes.db';

export const JWT_COOKIE_NAME = 'mes_token';
export const JWT_EXPIRES_IN = '12h';

export const ROLES = {
  ADMIN: 'admin',
  SUPERVISOR: 'supervisor',
  OPERATOR: 'operator',
} as const;

export const CORE_MODULE_IDS = [
  'plc-gateway',
  'recipe',
  'work-order',
  'dashboard',
  'user-management',
  'system-settings',
  'traceability',
] as const;

export type CoreModuleId = (typeof CORE_MODULE_IDS)[number];

export const MODULE_DISPLAY_NAMES: Record<CoreModuleId, string> = {
  'plc-gateway': 'PLC Gateway',
  recipe: 'Recipe Management',
  'work-order': 'Work Order Management',
  dashboard: 'Dashboard',
  'user-management': 'User Management',
  'system-settings': 'System Settings',
  traceability: 'Product Traceability',
};

/** DB boyutu bu eşiği aşarsa arşivleme uyarısı üretilir (2 GB) */
export const DB_SIZE_WARNING_BYTES = 2 * 1024 * 1024 * 1024;