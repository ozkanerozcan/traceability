/**
 * OE MES — OPC UA Test Sunucu Simülatörü
 *
 * Gerçek PLC/SCADA olmadan OPC UA geliştirme ve testi için lokal sunucu.
 *
 * Kullanım:
 *   node scripts/opcua-sim.mjs                    # SecurityMode=None, anonymous
 *   node scripts/opcua-sim.mjs --secure           # SignAndEncrypt + Basic256Sha256
 *   node scripts/opcua-sim.mjs --auth test:test123  # Kullanıcı adı/şifre zorunlu
 *   node scripts/opcua-sim.mjs --port 4841        # Farklı port
 *
 * Test tag'leri (namespace ns=2):
 *   ns=2;s=Sim.Bool        BOOL     1 sn toggle
 *   ns=2;s=Sim.Counter     UINT16   artan sayaç (1 sn)
 *   ns=2;s=Sim.Temperature FLOAT64  20–80 °C sine (1 sn)
 *   ns=2;s=Sim.Pressure    FLOAT64  1–10 bar random (1 sn)
 *   ns=2;s=Sim.Status      STRING   RUNNING/STOPPED (5 sn)
 *   ns=2;s=Sim.Setpoint    FLOAT64  statik, YAZILABİLİR
 */

import {
  OPCUAServer,
  Variant,
  DataType,
  StatusCodes,
  MessageSecurityMode,
  SecurityPolicy,
  AccessLevelFlag,
} from 'node-opcua';

// ─── Argüman çözümleme ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
const secure = args.includes('--secure');
const portIdx = args.indexOf('--port');
const port = portIdx !== -1 ? Number(args[portIdx + 1]) : 4840;
const authIdx = args.indexOf('--auth');
const authUser = authIdx !== -1 ? String(args[authIdx + 1]) : null;

const readWrite = AccessLevelFlag.CurrentRead | AccessLevelFlag.CurrentWrite;

// ─── Simülasyon durumu ───────────────────────────────────────────────────────
let boolValue = false;
let counter = 0;
let temperature = 50;
let pressure = 5;
let statusText = 'RUNNING';
let setpoint = 42.0;
let rowNum = 0; // yazılabilir satır numarası (test için sabit)
let tick = 0;

setInterval(() => {
  tick += 1;
  boolValue = !boolValue;
  counter = (counter + 1) % 65536;
  temperature = 50 + 30 * Math.sin(tick / 10); // 20–80 °C sine
  pressure = 1 + Math.random() * 9; // 1–10 bar random
  if (tick % 5 === 0) {
    statusText = statusText === 'RUNNING' ? 'STOPPED' : 'RUNNING';
  }
}, 1000);

// ─── Sunucu ──────────────────────────────────────────────────────────────────
const serverOptions = {
  port,
  resourcePath: '/UA/OeMesSim',
  buildInfo: {
    productName: 'OE MES OPC UA Simulator',
    buildNumber: '1.0.0',
    manufacturerName: 'OE',
  },
  securityModes: secure ? [MessageSecurityMode.SignAndEncrypt] : [MessageSecurityMode.None],
  securityPolicies: secure ? [SecurityPolicy.Basic256Sha256] : [SecurityPolicy.None],
};

if (authUser) {
  const [expectedUser, expectedPass] = authUser.split(':');
  serverOptions.userManager = {
    isValidUser: (userName, password) => userName === expectedUser && password === expectedPass,
  };
}

const server = new OPCUAServer(serverOptions);

await server.initialize();

const addressSpace = server.engine.addressSpace;
const namespace = addressSpace.getOwnNamespace();

const simFolder = namespace.addObject({
  organizedBy: addressSpace.rootFolder.objects,
  browseName: 'Sim',
});

namespace.addVariable({
  componentOf: simFolder,
  browseName: 'Bool',
  nodeId: 's=Sim.Bool',
  dataType: 'Boolean',
  value: { get: () => new Variant({ dataType: DataType.Boolean, value: boolValue }) },
});

namespace.addVariable({
  componentOf: simFolder,
  browseName: 'Counter',
  nodeId: 's=Sim.Counter',
  dataType: 'UInt16',
  value: { get: () => new Variant({ dataType: DataType.UInt16, value: counter }) },
});

namespace.addVariable({
  componentOf: simFolder,
  browseName: 'Temperature',
  nodeId: 's=Sim.Temperature',
  dataType: 'Double',
  value: { get: () => new Variant({ dataType: DataType.Double, value: temperature }) },
});

namespace.addVariable({
  componentOf: simFolder,
  browseName: 'Pressure',
  nodeId: 's=Sim.Pressure',
  dataType: 'Double',
  value: { get: () => new Variant({ dataType: DataType.Double, value: pressure }) },
});

namespace.addVariable({
  componentOf: simFolder,
  browseName: 'Status',
  nodeId: 's=Sim.Status',
  dataType: 'String',
  value: { get: () => new Variant({ dataType: DataType.String, value: statusText }) },
});

namespace.addVariable({
  componentOf: simFolder,
  browseName: 'Setpoint',
  nodeId: 's=Sim.Setpoint',
  dataType: 'Double',
  accessLevel: readWrite,
  userAccessLevel: readWrite,
  value: {
    get: () => new Variant({ dataType: DataType.Double, value: setpoint }),
    set: (variant) => {
      setpoint = Number(variant.value);
      console.log(`[sim] ✍  Sim.Setpoint yazıldı → ${setpoint}`);
      return StatusCodes.Good;
    },
  },
});

// Yazılabilir satır numarası — trolley satır-bazlı eşleştirme testleri için sabit
namespace.addVariable({
  componentOf: simFolder,
  browseName: 'RowNum',
  nodeId: 's=Sim.RowNum',
  dataType: 'Int16',
  accessLevel: readWrite,
  userAccessLevel: readWrite,
  value: {
    get: () => new Variant({ dataType: DataType.Int16, value: rowNum }),
    set: (variant) => {
      rowNum = Number(variant.value);
      console.log(`[sim] ✍  Sim.RowNum yazıldı → ${rowNum}`);
      return StatusCodes.Good;
    },
  },
});

await server.start();

const endpoint = server.endpoints?.[0]?.endpointDescriptions?.()?.[0]?.endpointUrl
  ?? `opc.tcp://127.0.0.1:${port}/UA/OeMesSim`;

console.log('┌──────────────────────────────────────────────────────────┐');
console.log('│         OE MES — OPC UA Simülatörü çalışıyor             │');
console.log('└──────────────────────────────────────────────────────────┘');
console.log(`  Endpoint : ${endpoint}`);
console.log(`  Güvenlik : ${secure ? 'SignAndEncrypt / Basic256Sha256' : 'None'}`);
console.log(`  Kimlik   : ${authUser ? `username (${authUser.split(':')[0]})` : 'anonymous'}`);
console.log('  Tagler   : ns=2 altında Sim.Bool, Sim.Counter, Sim.Temperature,');
console.log('             Sim.Pressure, Sim.Status, Sim.Setpoint (yazılabilir)');
console.log('\n  Durdurmak için Ctrl+C\n');

process.on('SIGINT', async () => {
  console.log('\n[sim] Kapatılıyor...');
  await server.shutdown(500);
  process.exit(0);
});
