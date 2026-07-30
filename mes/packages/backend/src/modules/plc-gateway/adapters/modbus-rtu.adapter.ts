import ModbusRTU from 'modbus-serial';
import type { IProtocolAdapter } from './adapter.interface.js';
import type { PlcConnectionConfig } from '../plc.types.js';

const CONNECT_TIMEOUT_MS = 5000;
const REQUEST_TIMEOUT_MS = 3000;

/**
 * Modbus RTU adaptörü (seri port, buffered okuma).
 * Docker'da seri port erişimi için docker-compose.yml'deki devices
 * bölümünün açılması gerekir.
 */
export class ModbusRtuAdapter implements IProtocolAdapter {
  private client: ModbusRTU | null = null;
  private connected = false;

  constructor(private config: PlcConnectionConfig) {}

  async connect(): Promise<void> {
    await this.disconnect();

    const client = new ModbusRTU();
    client.setID(this.config.unitId ?? 1);
    client.setTimeout(REQUEST_TIMEOUT_MS);

    const serialPort = this.config.serialPort;
    if (!serialPort) {
      throw new Error('Seri port tanımlı değil');
    }

    await Promise.race([
      client.connectRTUBuffered(serialPort, {
        baudRate: this.config.baudRate ?? 9600,
        dataBits: this.config.dataBits ?? 8,
        stopBits: this.config.stopBits ?? 1,
        parity: this.config.parity ?? 'none',
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Seri port açma zaman aşımı (${serialPort})`)),
          CONNECT_TIMEOUT_MS
        )
      ),
    ]);

    this.client = client;
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.client) {
      const client = this.client;
      this.client = null;
      await new Promise<void>((resolve) => {
        try {
          client.close(() => resolve());
        } catch {
          resolve();
        }
      });
    }
  }

  isConnected(): boolean {
    return this.connected && this.client !== null && this.client.isOpen;
  }

  private ensureClient(): ModbusRTU {
    if (!this.client || !this.isConnected()) {
      throw new Error('PLC bağlantısı kapalı');
    }
    return this.client;
  }

  private markClosedOnError(err: unknown): never {
    this.connected = false;
    throw err;
  }

  async readHoldingRegisters(address: number, length: number): Promise<number[]> {
    try {
      const res = await this.ensureClient().readHoldingRegisters(address, length);
      return res.data;
    } catch (err) {
      this.markClosedOnError(err);
    }
  }

  async readInputRegisters(address: number, length: number): Promise<number[]> {
    try {
      const res = await this.ensureClient().readInputRegisters(address, length);
      return res.data;
    } catch (err) {
      this.markClosedOnError(err);
    }
  }

  async readCoils(address: number, length: number): Promise<boolean[]> {
    try {
      const res = await this.ensureClient().readCoils(address, length);
      return res.data;
    } catch (err) {
      this.markClosedOnError(err);
    }
  }

  async readDiscreteInputs(address: number, length: number): Promise<boolean[]> {
    try {
      const res = await this.ensureClient().readDiscreteInputs(address, length);
      return res.data;
    } catch (err) {
      this.markClosedOnError(err);
    }
  }

  async writeRegister(address: number, value: number): Promise<void> {
    try {
      await this.ensureClient().writeRegister(address, value);
    } catch (err) {
      this.markClosedOnError(err);
    }
  }

  async writeRegisters(address: number, values: number[]): Promise<void> {
    try {
      await this.ensureClient().writeRegisters(address, values);
    } catch (err) {
      this.markClosedOnError(err);
    }
  }

  async writeCoil(address: number, value: boolean): Promise<void> {
    try {
      await this.ensureClient().writeCoil(address, value);
    } catch (err) {
      this.markClosedOnError(err);
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.connect();
      return true;
    } catch {
      return false;
    } finally {
      await this.disconnect();
    }
  }
}