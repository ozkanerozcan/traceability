/**
 * Protokol Adaptör Arayüzü: tüm PLC protokol adaptörleri (Modbus TCP, Modbus RTU,
 * ileride OPC UA) bu arayüzü implement eder. Worker thread yalnızca bu arayüzü bilir.
 */
export interface IProtocolAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  /** Holding register oku (fonksiyon 0x03). address: 0-bazlı Modbus adresi. */
  readHoldingRegisters(address: number, length: number): Promise<number[]>;
  /** Input register oku (fonksiyon 0x04). */
  readInputRegisters(address: number, length: number): Promise<number[]>;
  /** Coil oku (fonksiyon 0x01). */
  readCoils(address: number, length: number): Promise<boolean[]>;
  /** Discrete input oku (fonksiyon 0x02). */
  readDiscreteInputs(address: number, length: number): Promise<boolean[]>;

  /** Tek holding register yaz (fonksiyon 0x06). */
  writeRegister(address: number, value: number): Promise<void>;
  /** Çoklu holding register yaz (fonksiyon 0x10). */
  writeRegisters(address: number, values: number[]): Promise<void>;
  /** Coil yaz (fonksiyon 0x05). */
  writeCoil(address: number, value: boolean): Promise<void>;

  /** Bağlantıyı hızlıca doğrular (connect + disconnect). */
  testConnection(): Promise<boolean>;
}