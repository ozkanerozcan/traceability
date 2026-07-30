import { api } from '../../../core/services/api';

// ─── Tipler ─────────────────────────────────────────────────────────────────

export type PlcProtocol = 'modbus_tcp' | 'modbus_rtu' | 'opcua';
export type RegisterType = 'holding' | 'input' | 'coil' | 'discrete';
export type TagDataType =
  | 'BOOL'
  | 'INT16'
  | 'UINT16'
  | 'INT32'
  | 'UINT32'
  | 'INT64'
  | 'UINT64'
  | 'FLOAT32'
  | 'FLOAT64'
  | 'STRING';
export type PlcWorkerStatus = 'online' | 'offline' | 'connecting' | 'stopped' | 'cert_pending';
export type AcquisitionMode = 'poll' | 'subscribe';

export type OpcUaSecurityMode = 'None' | 'Sign' | 'SignAndEncrypt';
export type OpcUaSecurityPolicy =
  | 'None'
  | 'Basic128Rsa15'
  | 'Basic256'
  | 'Basic256Sha256'
  | 'Aes128_Sha256_RsaOaep'
  | 'Aes256_Sha256_RsaPss';
export type OpcUaAuthType = 'anonymous' | 'username';

export interface PlcProfile {
  id: number;
  name: string;
  protocol: PlcProtocol;
  host: string | null;
  port: number;
  unitId: number;
  serialPort: string | null;
  baudRate: number;
  dataBits: number;
  stopBits: number;
  parity: string;
  // ─── OPC UA ───
  endpointUrl: string | null;
  securityMode: OpcUaSecurityMode;
  securityPolicy: OpcUaSecurityPolicy;
  authType: OpcUaAuthType;
  authUsername: string | null;
  hasPassword: boolean;
  sessionTimeoutMs: number;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  workerStatus?: PlcWorkerStatus;
  workerStatusMessage?: string;
}

export interface PlcProfileInput {
  name: string;
  protocol: PlcProtocol;
  host?: string | null;
  port?: number;
  unitId?: number;
  serialPort?: string | null;
  baudRate?: number;
  dataBits?: number;
  stopBits?: number;
  parity?: string;
  // ─── OPC UA ───
  endpointUrl?: string | null;
  securityMode?: OpcUaSecurityMode;
  securityPolicy?: OpcUaSecurityPolicy;
  authType?: OpcUaAuthType;
  authUsername?: string | null;
  /** Düz metin şifre — backend'de AES-256-GCM ile şifrelenerek saklanır */
  authPassword?: string;
  sessionTimeoutMs?: number;
  description?: string | null;
  isActive?: boolean;
}

export interface PlcTag {
  id: number;
  plcId: number;
  name: string;
  /** Modbus: '40001' | OPC UA: NodeId ('ns=2;s=...') */
  address: string;
  registerType: RegisterType;
  dataType: TagDataType;
  acquisitionMode: AcquisitionMode;
  pollingIntervalMs: number;
  unit: string | null;
  description: string | null;
  wordSwap: boolean;
  byteSwap: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TagInput {
  name: string;
  address: number | string;
  registerType?: RegisterType;
  dataType: TagDataType;
  acquisitionMode?: AcquisitionMode;
  pollingIntervalMs?: number;
  unit?: string | null;
  description?: string | null;
  wordSwap?: boolean;
  byteSwap?: boolean;
  isActive?: boolean;
}

export interface TestResult {
  success: boolean;
  message?: string;
  certPending?: boolean;
  thumbprint?: string;
}

export interface BrowseNode {
  nodeId: string;
  displayName: string;
  nodeClass: string;
  dataType?: TagDataType;
  hasChildren: boolean;
}

export interface ServerCert {
  id: number;
  thumbprint: string;
  subject: string | null;
  status: 'pending' | 'trusted' | 'rejected';
  firstSeenAt: string;
  decidedAt: string | null;
}

// ─── PLC API ────────────────────────────────────────────────────────────────

export const plcService = {
  list: () => api.get<{ plcs: PlcProfile[] }>('/api/plc'),
  get: (id: number) => api.get<{ plc: PlcProfile }>(`/api/plc/${id}`),
  create: (input: PlcProfileInput) => api.post<{ plc: PlcProfile }>('/api/plc', input),
  update: (id: number, input: Partial<PlcProfileInput>) =>
    api.put<{ plc: PlcProfile }>(`/api/plc/${id}`, input),
  remove: (id: number) => api.delete<{ success: boolean }>(`/api/plc/${id}`),
  test: (id: number) => api.post<TestResult>(`/api/plc/${id}/test`),
  testRaw: (input: PlcProfileInput) => api.post<TestResult>('/api/plc/test', input),
  start: (id: number) => api.post<{ success: boolean }>(`/api/plc/${id}/start`),
  stop: (id: number) => api.post<{ success: boolean }>(`/api/plc/${id}/stop`),
  status: (id: number) => api.get<{ status: PlcWorkerStatus; message?: string }>(`/api/plc/${id}/status`),
};

// ─── Tag API ────────────────────────────────────────────────────────────────

export const tagService = {
  list: (plcId: number) => api.get<{ tags: PlcTag[] }>(`/api/plc/${plcId}/tags`),
  create: (plcId: number, input: TagInput) => api.post<{ tag: PlcTag }>(`/api/plc/${plcId}/tags`, input),
  update: (id: number, input: Partial<TagInput>) => api.put<{ tag: PlcTag }>(`/api/tags/${id}`, input),
  remove: (id: number) => api.delete<{ success: boolean }>(`/api/tags/${id}`),
  read: (plcId: number, tagId: number) =>
    api.post<{ tagId: number; value: number | boolean | string | null; timestamp: string }>(
      '/api/tags/read',
      { plcId, tagId }
    ),
  write: (plcId: number, tagId: number, value: number | boolean | string) =>
    api.post<{ success: boolean }>('/api/tags/write', { plcId, tagId, value }),
};

// ─── OPC UA API (browse + sertifika yönetimi) ────────────────────────────────

export const opcuaService = {
  browse: (plcId: number, nodeId?: string) =>
    api.get<{ nodes: BrowseNode[] }>(
      `/api/plc/${plcId}/browse${nodeId ? `?nodeId=${encodeURIComponent(nodeId)}` : ''}`
    ),
  listCerts: (plcId: number) => api.get<{ certs: ServerCert[] }>(`/api/plc/${plcId}/certificates`),
  trustCert: (plcId: number, thumbprint: string) =>
    api.post<{ success: boolean }>(
      `/api/plc/${plcId}/certificates/${encodeURIComponent(thumbprint)}/trust`
    ),
  rejectCert: (plcId: number, thumbprint: string) =>
    api.post<{ success: boolean }>(
      `/api/plc/${plcId}/certificates/${encodeURIComponent(thumbprint)}/reject`
    ),
  clientCert: (plcId: number) => api.get<{ pem: string }>(`/api/plc/${plcId}/certificates/client`),
};
