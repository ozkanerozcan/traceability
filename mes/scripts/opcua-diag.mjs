/**
 * OPC UA Bağımsız Tanılama — MES backend'ini tamamen bypass eder.
 * Gerçek PLC'nin adres alanını doğrudan node-opcua ile inceler:
 *  - Namespace listesi
 *  - ns=3;s=DataBlocksGlobal tam referans dökümü (nodeClass, referenceType, continuationPoint)
 *  - ns=3;s=PLC ağacı (2 seviye)
 *
 * Kullanım: node scripts/opcua-diag.mjs [endpointUrl]
 * Örnek:    node scripts/opcua-diag.mjs opc.tcp://192.168.0.1:4840
 */
import { OPCUAClient, MessageSecurityMode, SecurityPolicy, AttributeIds, NodeClass } from 'node-opcua';

const endpointUrl = process.argv[2] ?? 'opc.tcp://192.168.0.1:4840';

const client = OPCUAClient.create({
  applicationName: 'OE-MES-Diag',
  endpointMustExist: false,
  securityMode: MessageSecurityMode.None,
  securityPolicy: SecurityPolicy.None,
  connectionStrategy: { initialDelay: 500, maxRetry: 1, maxDelay: 3000 },
});

async function fullBrowse(session, nodeId, label) {
  console.log(`\n─── ${label} (${nodeId}) ───`);
  const result = await session.browse(nodeId);
  const refs = result.references ?? [];
  console.log(`  statusCode      : ${result.statusCode?.toString()}`);
  console.log(`  continuationPoint: ${result.continuationPoint ? 'VAR (daha fazla referans var!)' : 'yok'}`);
  console.log(`  referans sayısı : ${refs.length}`);
  for (const ref of refs) {
    console.log(
      `   [${NodeClass[ref.nodeClass] ?? ref.nodeClass}] ${ref.displayName?.text} | ${ref.nodeId.toString()} | refType=${ref.referenceTypeId?.toString()} | forward=${ref.isForward}`
    );
  }
  return refs;
}

try {
  await client.connect(endpointUrl);
  console.log(`✓ Bağlandı: ${endpointUrl}`);
  const session = await client.createSession();
  console.log('✓ Oturum açıldı (anonymous)\n');

  // 1. Namespace listesi
  const nsArray = await session.read({ nodeId: 'ns=0;i=2255', attributeId: AttributeIds.Value });
  console.log('═══ NAMESPACES ═══');
  (nsArray.value?.value ?? []).forEach((uri, i) => console.log(`  ns=${i} → ${uri}`));

  // 2. DataBlocksGlobal tam döküm
  await fullBrowse(session, 'ns=3;s=DataBlocksGlobal', 'DataBlocksGlobal');

  // 3. DataBlocksInstance tam döküm
  await fullBrowse(session, 'ns=3;s=DataBlocksInstance', 'DataBlocksInstance');

  // 4. PLC kökü — referenceTypeId belirtmeden (tüm tipler)
  const plcRefs = await fullBrowse(session, 'ns=3;s=PLC', 'PLC kökü');

  // 5. Organizes referansıyla ayrıca dene (S7 DB'leri Organizes ile bağlı)
  console.log('\n─── DataBlocksGlobal (yalnız Organizes) ───');
  const org = await session.browse({
    nodeId: 'ns=3;s=DataBlocksGlobal',
    referenceTypeId: 'Organizes',
    includeSubtypes: true,
    browseDirection: 0,
  });
  console.log(`  referans sayısı: ${org.references?.length ?? 0}`);
  for (const ref of org.references ?? []) {
    console.log(`   [${NodeClass[ref.nodeClass]}] ${ref.displayName?.text} | ${ref.nodeId.toString()}`);
  }

  // 6. DeviceSet altı (ns=2) — başka bir yerde mi diye
  await fullBrowse(session, 'ns=2;i=5001', 'DeviceSet');

  await session.close();
  await client.disconnect();
  console.log('\n✓ Tanılama tamamlandı');
  process.exit(0);
} catch (err) {
  console.error('✗ HATA:', err.message);
  process.exit(1);
}
