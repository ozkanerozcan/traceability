import type { IProtocolAdapter } from './adapter.interface.js';
import type { PlcConnectionConfig } from '../plc.types.js';
import { ModbusTcpAdapter } from './modbus-tcp.adapter.js';
import { ModbusRtuAdapter } from './modbus-rtu.adapter.js';

export type { IProtocolAdapter } from './adapter.interface.js';
export { OpcUaAdapter, OpcUaCertUntrustedError } from './opcua.adapter.js';

/** Protokol konfigürasyonuna göre uygun Modbus adaptörü oluşturur. */
export function createAdapter(config: PlcConnectionConfig): IProtocolAdapter {
  switch (config.protocol) {
    case 'modbus_tcp':
      return new ModbusTcpAdapter(config);
    case 'modbus_rtu':
      return new ModbusRtuAdapter(config);
    default:
      throw new Error(`Desteklenmeyen protokol: ${String(config.protocol)}`);
  }
}
