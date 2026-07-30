// ─── PLC Gateway Modül Tipleri ───────────────────────────────────────────────

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
export type PlcStatus = 'online' | 'offline' | 'connecting' | 'stopped' | 'cert_pending';
export type AcquisitionMode = 'poll' | 'subscribe';
export type TagQuality = 'good' | 'uncertain' | 'bad';

// ─── OPC UA ──────────────────────────────────────────────────────────────────

export type OpcUaSecurityMode = 'None' | 'Sign' | 'SignAndEncrypt';
export type OpcUaSecurityPolicy =
  | 'None'
  | 'Basic128Rsa15'
  | 'Basic256'
  | 'Basic256Sha256'
  | 'Aes128_Sha256_RsaOaep'
  | 'Aes256_Sha256_RsaPss';
export type OpcUaAuthType = 'anonymous' | 'username' | 'certificate';

export interface OpcUaServerCertRow {
  id: number;
  plc_id: number;
  thumbprint: string;
  subject: string | null;
  pem: string;
  status: 'pending' | 'trusted' | 'rejected';
  first_seen_at: string;
  decided_at: string | null;
  decided_by: number | null;
}

export interface PlcProfileRow {
  id: number;
  name: string;
  protocol: PlcProtocol;
  host: string | null;
  port: number;
  unit_id: number;
  serial_port: string | null;
  baud_rate: number;
  data_bits: number;
  stop_bits: number;
  parity: string;
  // ─── OPC UA ayarları ───
  endpoint_url: string | null;
  security_mode: OpcUaSecurityMode | null;
  security_policy: OpcUaSecurityPolicy | null;
  auth_type: OpcUaAuthType | null;
  auth_username: string | null;
  auth_password_enc: string | null;
  session_timeout_ms: number | null;
  description: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface PlcTagRow {
  id: number;
  plc_id: number;
  name: string;
  /** Modbus: '40001' (mutlak register) | OPC UA: NodeId ('ns=2;s=...') */
  address: string;
  register_type: RegisterType;
  data_type: TagDataType;
  acquisition_mode: AcquisitionMode;
  polling_interval_ms: number;
  unit: string | null;
  description: string | null;
  word_swap: number;
  byte_swap: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

/** Worker'a gönderilen bağlantı konfigürasyonu */
export interface PlcConnectionConfig {
  protocol: PlcProtocol;
  host?: string;
  port?: number;
  unitId?: number;
  serialPort?: string;
  baudRate?: number;
  dataBits?: number;
  stopBits?: number;
  parity?: 'none' | 'even' | 'odd';
  // ─── OPC UA ───
  endpointUrl?: string;
  securityMode?: OpcUaSecurityMode;
  securityPolicy?: OpcUaSecurityPolicy;
  authType?: OpcUaAuthType;
  authUsername?: string;
  /** Çözülmüş düz metin şifre — yalnızca ana thread'den worker'a iletilir, DB'de asla saklanmaz */
  authPassword?: string;
  sessionTimeoutMs?: number;
}

/** Worker'a gönderilen tag konfigürasyonu */
export interface TagConfig {
  id: number;
  name: string;
  /** Modbus: '40001' | OPC UA: NodeId */
  address: string;
  registerType: RegisterType;
  dataType: TagDataType;
  acquisitionMode: AcquisitionMode;
  pollingIntervalMs: number;
  unit: string | null;
  wordSwap: boolean;
  byteSwap: boolean;
}

export interface WorkerInitData {
  plcId: number;
  connection: PlcConnectionConfig;
  tags: TagConfig[];
}

// ─── Ana Thread → Worker Mesajları ───────────────────────────────────────────

export type WorkerCommand =
  | { cmd: 'stop' }
  | { cmd: 'read'; requestId: number; tagId: number }
  | { cmd: 'write'; requestId: number; tagId: number; value: number | boolean | string }
  | { cmd: 'updateTags'; tags: TagConfig[] };

// ─── Worker → Ana Thread Mesajları ───────────────────────────────────────────

export interface TagValue {
  tagId: number;
  value: number | boolean | string | null;
  quality?: TagQuality;
  timestamp: string;
}

export type WorkerEvent =
  | { event: 'status'; status: PlcStatus; message?: string }
  | { event: 'data'; tags: TagValue[] }
  | { event: 'readResult'; requestId: number; value: number | boolean | string | null }
  | { event: 'writeResult'; requestId: number }
  | { event: 'errorResult'; requestId: number; message: string };
