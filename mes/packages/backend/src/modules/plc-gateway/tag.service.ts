import { getDb } from '../../core/database/connection.js';
import type { AcquisitionMode, PlcTagRow, RegisterType, TagDataType } from './plc.types.js';

export interface TagInput {
  name: string;
  /** Modbus: sayısal mutlak adres (40001) | OPC UA: NodeId string ('ns=2;s=...') */
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

const VALID_REGISTER_TYPES: RegisterType[] = ['holding', 'input', 'coil', 'discrete'];
const VALID_DATA_TYPES: TagDataType[] = [
  'BOOL',
  'INT16',
  'UINT16',
  'INT32',
  'UINT32',
  'INT64',
  'UINT64',
  'FLOAT32',
  'FLOAT64',
  'STRING',
];
const VALID_ACQUISITION_MODES: AcquisitionMode[] = ['poll', 'subscribe'];

export function isValidRegisterType(v: string): v is RegisterType {
  return VALID_REGISTER_TYPES.includes(v as RegisterType);
}

export function isValidDataType(v: string): v is TagDataType {
  return VALID_DATA_TYPES.includes(v as TagDataType);
}

export function isValidAcquisitionMode(v: string): v is AcquisitionMode {
  return VALID_ACQUISITION_MODES.includes(v as AcquisitionMode);
}

export function listTags(plcId: number): PlcTagRow[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM plc_tags WHERE plc_id = ? ORDER BY id')
    .all(plcId) as PlcTagRow[];
}

export function getTag(id: number): PlcTagRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM plc_tags WHERE id = ?').get(id) as PlcTagRow | undefined;
}

export function createTag(plcId: number, input: TagInput): PlcTagRow {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO plc_tags
        (plc_id, name, address, register_type, data_type, acquisition_mode,
         polling_interval_ms, unit, description, word_swap, byte_swap, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      plcId,
      input.name,
      String(input.address),
      input.registerType ?? 'holding',
      input.dataType,
      input.acquisitionMode ?? 'poll',
      input.pollingIntervalMs ?? 1000,
      input.unit ?? null,
      input.description ?? null,
      input.wordSwap ? 1 : 0,
      input.byteSwap ? 1 : 0,
      input.isActive === false ? 0 : 1
    );

  return getTag(Number(result.lastInsertRowid))!;
}

export function updateTag(id: number, input: Partial<TagInput>): PlcTagRow | undefined {
  const db = getDb();
  const existing = getTag(id);
  if (!existing) return undefined;

  db.prepare(
    `UPDATE plc_tags SET
        name = ?, address = ?, register_type = ?, data_type = ?, acquisition_mode = ?,
        polling_interval_ms = ?, unit = ?, description = ?,
        word_swap = ?, byte_swap = ?, is_active = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    input.name ?? existing.name,
    input.address !== undefined ? String(input.address) : existing.address,
    input.registerType ?? existing.register_type,
    input.dataType ?? existing.data_type,
    input.acquisitionMode ?? existing.acquisition_mode,
    input.pollingIntervalMs ?? existing.polling_interval_ms,
    input.unit !== undefined ? input.unit : existing.unit,
    input.description !== undefined ? input.description : existing.description,
    input.wordSwap !== undefined ? (input.wordSwap ? 1 : 0) : existing.word_swap,
    input.byteSwap !== undefined ? (input.byteSwap ? 1 : 0) : existing.byte_swap,
    input.isActive !== undefined ? (input.isActive ? 1 : 0) : existing.is_active,
    id
  );

  return getTag(id);
}

export function deleteTag(id: number): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM plc_tags WHERE id = ?').run(id);
  return result.changes > 0;
}
