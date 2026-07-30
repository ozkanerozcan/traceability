import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Kimlik bilgisi şifreleme servisi (AES-256-GCM).
 *
 * OPC UA / PLC kullanıcı şifreleri DB'de asla düz metin saklanmaz.
 * Anahtar önceliği:
 *   1. ENCRYPTION_KEY ortam değişkeni (64 hex karakter = 32 byte)
 *   2. JWT_SECRET'tan scrypt ile türetme (uyarı loglanır)
 *
 * Saklama formatı: enc:v1:<iv>:<authTag>:<ciphertext>  (tüm parçalar base64)
 */

const PREFIX = 'enc:v1';
let warnedFallback = false;

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) {
    return Buffer.from(hex, 'hex');
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('ENCRYPTION_KEY veya JWT_SECRET ortam değişkeni tanımlı olmalı');
  }

  if (!warnedFallback) {
    warnedFallback = true;
    console.warn(
      '[secret] ENCRYPTION_KEY tanımlı değil — JWT_SECRET\'tan anahtar türetiliyor. ' +
        'Production için ENCRYPTION_KEY (64 hex) tanımlayın.'
    );
  }
  return scryptSync(secret, 'oe-mes-secret-salt', 32);
}

/** Düz metni AES-256-GCM ile şifreler. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/** encryptSecret çıktısını çözer. */
export function decryptSecret(payload: string): string {
  if (!isEncrypted(payload)) {
    throw new Error('Geçersiz şifreli veri formatı');
  }
  const parts = payload.split(':');
  // enc : v1 : iv : tag : data  → 5 parça
  const [, , ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Değer encryptSecret formatında mı? */
export function isEncrypted(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith(`${PREFIX}:`);
}
