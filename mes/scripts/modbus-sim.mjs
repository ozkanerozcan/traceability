// Modbus TCP simülasyon sunucusu — Faz 2 doğrulaması için.
// 40001-40002: FLOAT32 sıcaklık (25.5 sabit)
// 40003-40004: UINT32 sayaç (her saniye artar)
// Coil 1: true
// Kullanım: node scripts/modbus-sim.mjs
import ModbusRTU from 'modbus-serial';

const registers = new Array(100).fill(0);
const coils = new Array(100).fill(false);

// FLOAT32 25.5 → 40001-40002
const fbuf = Buffer.alloc(4);
fbuf.writeFloatBE(25.5, 0);
registers[0] = fbuf.readUInt16BE(0);
registers[1] = fbuf.readUInt16BE(2);

coils[0] = true;

let counter = 0;
setInterval(() => {
  counter = (counter + 1) % 100000;
  registers[2] = (counter >> 16) & 0xffff;
  registers[3] = counter & 0xffff;
}, 1000);

const vector = {
  getInputRegister: (addr) => Promise.resolve(registers[addr]),
  getHoldingRegister: (addr) => Promise.resolve(registers[addr]),
  getCoil: (addr) => Promise.resolve(coils[addr]),
  setRegister: (addr, value) => {
    registers[addr] = value;
    return Promise.resolve();
  },
  setCoil: (addr, value) => {
    coils[addr] = value;
    return Promise.resolve();
  },
};

new ModbusRTU.ServerTCP(vector, { host: '127.0.0.1', port: 1502, debug: false });
console.log('Modbus simülasyon sunucusu çalışıyor: 127.0.0.1:1502 (unit 1)');