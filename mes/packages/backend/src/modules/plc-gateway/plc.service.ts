import { getDb } from '../../core/database/connection.js';
import { encryptSecret } from '../../core/crypto/secret.service.js';
import { createAdapter } from './adapters/index.js';
import { OpcUaAdapter, OpcUaCertUntrustedError } from './adapters/opcua.adapter.js';
import { recordPendingServerCert } from './adapters/certificate.manager.js';
import { buildConnectionConfig } from './workers/worker.manager.js';
import type {
  OpcUaAuthType,
  OpcUaSecurityMode,
  OpcUaSecurityPolicy,
  PlcConnectionConfig,
  PlcProfileRow,
  PlcProtocol,
} from './plc.types.js';

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
  /** Düz metin şifre — kaydedilmeden önce AES-256-GCM ile şifrelenir */
  authPassword?: string;
  sessionTimeoutMs?: number;
  description?: string | null;
  isActive?: boolean;
}

export interface TestConnectionResult {
  success: boolean;
  message?: string;
  /** OPC UA: sunucu sertifikası admin onayı bekliyor */
  certPending?: boolean;
  thumbprint?: string;
}

export function listPlcs(): PlcProfileRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM plc_profiles ORDER BY id').all() as PlcProfileRow[];
}

export function getPlc(id: number): PlcProfileRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM plc_profiles WHERE id = ?').get(id) as
    | PlcProfileRow
    | undefined;
}

export function createPlc(input: PlcProfileInput): PlcProfileRow {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO plc_profiles
        (name, protocol, host, port, unit_id, serial_port, baud_rate, data_bits, stop_bits, parity,
         endpoint_url, security_mode, security_policy, auth_type, auth_username, auth_password_enc,
         session_timeout_ms, description, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.name,
      input.protocol,
      input.host ?? null,
      input.port ?? 502,
      input.unitId ?? 1,
      input.serialPort ?? null,
      input.baudRate ?? 9600,
      input.dataBits ?? 8,
      input.stopBits ?? 1,
      input.parity ?? 'none',
      input.endpointUrl ?? null,
      input.securityMode ?? 'None',
      input.securityPolicy ?? 'None',
      input.authType ?? 'anonymous',
      input.authUsername ?? null,
      input.authPassword ? encryptSecret(input.authPassword) : null,
      input.sessionTimeoutMs ?? 30000,
      input.description ?? null,
      input.isActive === false ? 0 : 1
    );

  return getPlc(Number(result.lastInsertRowid))!;
}

export function updatePlc(id: number, input: Partial<PlcProfileInput>): PlcProfileRow | undefined {
  const db = getDb();
  const existing = getPlc(id);
  if (!existing) return undefined;

  const merged = { ...existing, ...input };

  // Şifre: yeni değer geldiyse şifrele; boş string/undefined gelirse mevcutu koru
  const passwordEnc = input.authPassword
    ? encryptSecret(input.authPassword)
    : existing.auth_password_enc;

  db.prepare(
    `UPDATE plc_profiles SET
        name = ?, protocol = ?, host = ?, port = ?, unit_id = ?,
        serial_port = ?, baud_rate = ?, data_bits = ?, stop_bits = ?, parity = ?,
        endpoint_url = ?, security_mode = ?, security_policy = ?,
        auth_type = ?, auth_username = ?, auth_password_enc = ?, session_timeout_ms = ?,
        description = ?, is_active = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    merged.name,
    merged.protocol,
    merged.host ?? null,
    merged.port ?? 502,
    merged.unitId ?? merged.unit_id ?? 1,
    merged.serialPort ?? merged.serial_port ?? null,
    merged.baudRate ?? merged.baud_rate ?? 9600,
    merged.dataBits ?? merged.data_bits ?? 8,
    merged.stopBits ?? merged.stop_bits ?? 1,
    merged.parity ?? 'none',
    merged.endpointUrl ?? merged.endpoint_url ?? null,
    merged.securityMode ?? merged.security_mode ?? 'None',
    merged.securityPolicy ?? merged.security_policy ?? 'None',
    merged.authType ?? merged.auth_type ?? 'anonymous',
    merged.authUsername ?? merged.auth_username ?? null,
    passwordEnc,
    merged.sessionTimeoutMs ?? merged.session_timeout_ms ?? 30000,
    merged.description ?? null,
    (merged.isActive ?? (merged.is_active === 1)) ? 1 : 0,
    id
  );

  return getPlc(id);
}

export function deletePlc(id: number): boolean {
  const db = getDb();
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM recipe_tags WHERE tag_id IN (SELECT id FROM plc_tags WHERE plc_id = ?)').run(id);
    const result = db.prepare('DELETE FROM plc_profiles WHERE id = ?').run(id);
    return result.changes > 0;
  });
  return transaction();
}

export function setPlcActive(id: number, active: boolean): void {
  const db = getDb();
  db.prepare("UPDATE plc_profiles SET is_active = ?, updated_at = datetime('now') WHERE id = ?").run(
    active ? 1 : 0,
    id
  );
}

/** Input nesnesinden bağlantı konfigürasyonu üretir (kaydedilmemiş profil testi için). */
function buildConfigFromInput(input: PlcProfileInput): PlcConnectionConfig {
  return {
    protocol: input.protocol,
    host: input.host ?? undefined,
    port: input.port ?? 502,
    unitId: input.unitId ?? 1,
    serialPort: input.serialPort ?? undefined,
    baudRate: input.baudRate ?? 9600,
    dataBits: input.dataBits ?? 8,
    stopBits: input.stopBits ?? 1,
    parity: (input.parity as 'none' | 'even' | 'odd') ?? 'none',
    endpointUrl: input.endpointUrl ?? undefined,
    securityMode: input.securityMode ?? 'None',
    securityPolicy: input.securityPolicy ?? 'None',
    authType: input.authType ?? 'anonymous',
    authUsername: input.authUsername ?? undefined,
    authPassword: input.authPassword || undefined,
    sessionTimeoutMs: input.sessionTimeoutMs ?? 30000,
  };
}

/** OPC UA bağlantı testi; certPending bilgisini de döndürür. */
async function testOpcUaConnection(
  config: PlcConnectionConfig,
  plcId?: number
): Promise<TestConnectionResult> {
  const adapter = new OpcUaAdapter(config);
  try {
    await adapter.connect();
    return { success: true };
  } catch (err) {
    if (err instanceof OpcUaCertUntrustedError) {
      // Kayıtlı profilse pending kaydı oluştur (sertifika paneli buradan beslenir)
      if (plcId !== undefined) {
        recordPendingServerCert(plcId, err.certInfo);
      }
      return {
        success: false,
        certPending: true,
        thumbprint: err.certInfo.thumbprint,
        message:
          plcId !== undefined
            ? 'Sunucu sertifikası güven onayı bekliyor — Sertifikalar panelinden onaylayın'
            : `Sunucu sertifikası güvenilmedi (${err.certInfo.thumbprint}) — önce profili kaydedip sertifikaya güvenmeniz gerekir`,
      };
    }
    return { success: false, message: err instanceof Error ? err.message : 'Bağlantı hatası' };
  } finally {
    await adapter.disconnect().catch(() => undefined);
  }
}

/** Geçici adaptörle bağlantı testi (worker'dan bağımsız). */
export async function testConnection(id: number): Promise<TestConnectionResult> {
  const plc = getPlc(id);
  if (!plc) {
    return { success: false, message: 'PLC bulunamadı' };
  }

  if (plc.protocol === 'opcua') {
    return testOpcUaConnection(buildConnectionConfig(plc), id);
  }

  const adapter = createAdapter(buildConnectionConfig(plc));
  try {
    await adapter.connect();
    return { success: true };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : 'Bağlantı hatası' };
  } finally {
    await adapter.disconnect().catch(() => undefined);
  }
}

/** Henüz DB'ye kaydedilmemiş bir profil için bağlantı testi. */
export async function testConnectionRaw(input: PlcProfileInput): Promise<TestConnectionResult> {
  const config = buildConfigFromInput(input);

  if (input.protocol === 'opcua') {
    return testOpcUaConnection(config);
  }

  const adapter = createAdapter(config);
  try {
    await adapter.connect();
    return { success: true };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : 'Bağlantı hatası' };
  } finally {
    await adapter.disconnect().catch(() => undefined);
  }
}
