import { X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { OPCUACertificateManager } from 'node-opcua';
import { getDb } from '../../../core/database/connection.js';
import type { OpcUaServerCertRow } from '../plc.types.js';

/**
 * OPC UA PKI ve sunucu sertifikası güven yönetimi (TOFU — Trust On First Use).
 *
 * Dizin yapısı (<DB dizini>/pki):
 *   own/certs/client_certificate.pem   → OE MES istemci sertifikası (otomatik üretilir)
 *   own/private/private_key.pem        → istemci özel anahtarı
 *   trusted/certs/                     → güvenilen sunucu sertifikaları (node-opcua yönetir)
 *   rejected/certs/                    → reddedilenler (node-opcua yönetir)
 *   server-certs/<thumbprint>.der      → bizim thumbprint indeksli depomuz (pending kayıtları için)
 */

export interface ServerCertInfo {
  thumbprint: string;
  subject: string;
  pem: string;
}

/** PKI kök dizini: DB_PATH'in bulunduğu dizin altında 'pki'. */
export function getPkiDir(): string {
  const dbPath = resolve(process.env.DB_PATH ?? './data/mes.db');
  return join(dirname(dbPath), 'pki');
}

function getServerCertStoreDir(): string {
  const dir = join(getPkiDir(), 'server-certs');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * node-opcua istemci sertifika yöneticisi.
 * İlk initialize() çağrısında self-signed istemci sertifikası otomatik üretilir.
 * autoAccept=false iken bilinmeyen sunucu sertifikaları rejected klasörüne düşer
 * ve bağlantı hata ile sonuçlanır (TOFU akışı).
 */
export async function createClientCertificateManager(
  autoAcceptUnknown: boolean
): Promise<OPCUACertificateManager> {
  const manager = new OPCUACertificateManager({
    automaticallyAcceptUnknownCertificate: autoAcceptUnknown,
    rootFolder: getPkiDir(),
  });
  await manager.initialize();
  return manager;
}

// ─── DER ↔ PEM dönüşümleri ──────────────────────────────────────────────────

export function derToPem(der: Buffer): string {
  const b64 = der.toString('base64');
  const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
  return `-----BEGIN CERTIFICATE-----\n${lines}\n-----END CERTIFICATE-----\n`;
}

export function pemToDer(pem: string): Buffer {
  const b64 = pem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
  return Buffer.from(b64, 'base64');
}

/** DER sertifikadan görüntüleme bilgilerini çıkarır (thumbprint SHA-1, subject). */
export function certInfoFromDer(der: Buffer): ServerCertInfo {
  const x509 = new X509Certificate(der);
  return {
    thumbprint: x509.fingerprint, // 'AA:BB:CC:...' formatında SHA-1
    subject: x509.subject.replace(/\n/g, ', '),
    pem: derToPem(der),
  };
}

// ─── DB + dosya deposu işlemleri ────────────────────────────────────────────

/** Sunucu sertifikasını 'pending' olarak kaydeder (varsa no-op). */
export function recordPendingServerCert(plcId: number, info: ServerCertInfo): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO opcua_trusted_certs (plc_id, thumbprint, subject, pem, status)
     VALUES (?, ?, ?, ?, 'pending')
     ON CONFLICT(plc_id, thumbprint) DO NOTHING`
  ).run(plcId, info.thumbprint, info.subject, info.pem);

  writeFileSync(
    join(getServerCertStoreDir(), `${info.thumbprint.replace(/:/g, '')}.der`),
    pemToDer(info.pem)
  );
}

export function listServerCerts(plcId: number): OpcUaServerCertRow[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM opcua_trusted_certs WHERE plc_id = ? ORDER BY first_seen_at DESC')
    .all(plcId) as OpcUaServerCertRow[];
}

function getCertRow(plcId: number, thumbprint: string): OpcUaServerCertRow | undefined {
  const db = getDb();
  return db
    .prepare('SELECT * FROM opcua_trusted_certs WHERE plc_id = ? AND thumbprint = ?')
    .get(plcId, thumbprint) as OpcUaServerCertRow | undefined;
}

/**
 * Sertifikaya güvenir: node-opcua trusted store'una ekler + DB durumunu günceller.
 * Sonraki bağlantılarda sertifika artık kabul edilir.
 */
export async function trustServerCert(
  plcId: number,
  thumbprint: string,
  userId?: number
): Promise<boolean> {
  const row = getCertRow(plcId, thumbprint);
  if (!row) return false;

  const manager = await createClientCertificateManager(false);
  await manager.trustCertificate(pemToDer(row.pem));

  const db = getDb();
  db.prepare(
    `UPDATE opcua_trusted_certs
     SET status = 'trusted', decided_at = datetime('now'), decided_by = ?
     WHERE plc_id = ? AND thumbprint = ?`
  ).run(userId ?? null, plcId, thumbprint);
  return true;
}

/** Sertifikayı reddeder: node-opcua rejected store'una taşır + DB durumunu günceller. */
export async function rejectServerCert(
  plcId: number,
  thumbprint: string,
  userId?: number
): Promise<boolean> {
  const row = getCertRow(plcId, thumbprint);
  if (!row) return false;

  const manager = await createClientCertificateManager(false);
  await manager.rejectCertificate(pemToDer(row.pem));

  const db = getDb();
  db.prepare(
    `UPDATE opcua_trusted_certs
     SET status = 'rejected', decided_at = datetime('now'), decided_by = ?
     WHERE plc_id = ? AND thumbprint = ?`
  ).run(userId ?? null, plcId, thumbprint);
  return true;
}

/** OE MES istemci sertifikası (varsa) — sunucu tarafına eklemek için indirilir. */
export function getClientCertificatePem(): string | null {
  const path = join(getPkiDir(), 'own', 'certs', 'client_certificate.pem');
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}
