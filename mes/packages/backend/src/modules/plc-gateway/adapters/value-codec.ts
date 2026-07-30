import type { RegisterType, TagDataType } from '../plc.types.js';

/**
 * Mutlak (absolute) Modbus adresini 0-bazlı register adresine çevirir.
 * Kullanıcı arayüzde 40001, 30001, 10001, 1 formatında girer;
 * adaptör arka planda register tipine göre offset çıkarır.
 *
 * - holding:  40001 → 0
 * - input:    30001 → 0
 * - discrete: 10001 → 0
 * - coil:     1     → 0
 *
 * Zaten 0-bazlı girilmiş adresler (örn. holding için 40001'den küçük)
 * savunmacı şekilde olduğu gibi döndürülür.
 */
export function toModbusAddress(absoluteAddress: number, registerType: RegisterType): number {
  const offsets: Record<RegisterType, number> = {
    holding: 40001,
    input: 30001,
    discrete: 10001,
    coil: 1,
  };
  const offset = offsets[registerType];
  return absoluteAddress >= offset ? absoluteAddress - offset : absoluteAddress;
}

/** Veri tipinin kapladığı register (16-bit word) sayısı. */
export function registerCount(dataType: TagDataType): number {
  switch (dataType) {
    case 'BOOL':
    case 'INT16':
    case 'UINT16':
      return 1;
    case 'INT32':
    case 'UINT32':
    case 'FLOAT32':
      return 2;
    case 'INT64':
    case 'UINT64':
    case 'FLOAT64':
      return 4;
    case 'STRING':
      throw new Error('STRING veri tipi Modbus ile desteklenmez — OPC UA kullanın');
  }
}

function applySwaps(registers: number[], wordSwap: boolean, byteSwap: boolean): number[] {
  let result = registers;
  if (wordSwap && result.length > 1) {
    result = [...result].reverse();
  }
  if (byteSwap) {
    result = result.map((w) => ((w & 0xff) << 8) | ((w >> 8) & 0xff));
  }
  return result;
}

function registersToBuffer(registers: number[]): Buffer {
  const buf = Buffer.alloc(registers.length * 2);
  registers.forEach((word, i) => buf.writeUInt16BE(word & 0xffff, i * 2));
  return buf;
}

/**
 * Register dizisini Tag konfigürasyonuna göre sayısal değere çözer.
 * Modbus standart sırası: word bazında big-endian, 32-bit değerlerde
 * yüksek word önce (AB CD). wordSwap → CD AB, byteSwap → word içi bayt takası.
 */
export function decodeRegisters(
  registers: number[],
  dataType: TagDataType,
  wordSwap: boolean,
  byteSwap: boolean
): number {
  const swapped = applySwaps(registers, wordSwap, byteSwap);
  const buf = registersToBuffer(swapped);

  switch (dataType) {
    case 'BOOL':
      return registers[0] !== 0 ? 1 : 0;
    case 'INT16':
      return buf.readInt16BE(0);
    case 'UINT16':
      return buf.readUInt16BE(0);
    case 'INT32':
      return buf.readInt32BE(0);
    case 'UINT32':
      return buf.readUInt32BE(0);
    case 'FLOAT32':
      return buf.readFloatBE(0);
    case 'FLOAT64':
      return buf.readDoubleBE(0);
    case 'INT64':
      return Number(buf.readBigInt64BE(0));
    case 'UINT64':
      return Number(buf.readBigUInt64BE(0));
    case 'STRING':
      throw new Error('STRING veri tipi Modbus ile desteklenmez — OPC UA kullanın');
  }
}

/** Sayısal değeri yazma için register dizisine çevirir. */
export function encodeValue(
  value: number,
  dataType: TagDataType,
  wordSwap: boolean,
  byteSwap: boolean
): number[] {
  const count = registerCount(dataType);
  const buf = Buffer.alloc(count * 2);

  switch (dataType) {
    case 'BOOL':
      return [value ? 1 : 0];
    case 'INT16':
      buf.writeInt16BE(Math.trunc(value), 0);
      break;
    case 'UINT16':
      buf.writeUInt16BE(Math.trunc(value) & 0xffff, 0);
      break;
    case 'INT32':
      buf.writeInt32BE(Math.trunc(value), 0);
      break;
    case 'UINT32':
      buf.writeUInt32BE(Math.trunc(value) >>> 0, 0);
      break;
    case 'FLOAT32':
      buf.writeFloatBE(value, 0);
      break;
    case 'FLOAT64':
      buf.writeDoubleBE(value, 0);
      break;
    case 'INT64':
      buf.writeBigInt64BE(BigInt(Math.trunc(value)), 0);
      break;
    case 'UINT64':
      buf.writeBigUInt64BE(BigInt(Math.trunc(value)), 0);
      break;
    case 'STRING':
      throw new Error('STRING veri tipi Modbus ile desteklenmez — OPC UA kullanın');
  }

  let registers: number[] = [];
  for (let i = 0; i < buf.length; i += 2) {
    registers.push(buf.readUInt16BE(i));
  }
  // decode'daki sıranın tersi: önce byte swap, sonra word swap
  if (byteSwap) {
    registers = registers.map((w) => ((w & 0xff) << 8) | ((w >> 8) & 0xff));
  }
  if (wordSwap && registers.length > 1) {
    registers = registers.reverse();
  }
  return registers;
}