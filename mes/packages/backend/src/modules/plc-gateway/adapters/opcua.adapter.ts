import {
  AttributeIds,
  ClientSession,
  ClientSubscription,
  DataType,
  MessageSecurityMode,
  NodeClass,
  OPCUAClient,
  SecurityPolicy,
  TimestampsToReturn,
  UserTokenType,
  type ClientMonitoredItem,
  type DataValue,
  type ReferenceDescription,
  type UserIdentityInfo,
} from 'node-opcua';
import type {
  OpcUaSecurityMode,
  OpcUaSecurityPolicy,
  PlcConnectionConfig,
  TagDataType,
  TagQuality,
} from '../plc.types.js';
import {
  certInfoFromDer,
  createClientCertificateManager,
  type ServerCertInfo,
} from './certificate.manager.js';

// ─── Dışa Açık Tipler ────────────────────────────────────────────────────────

export interface OpcUaReadResult {
  value: number | boolean | string | null;
  quality: TagQuality;
}

export interface OpcUaSubscribeTag {
  tagId: number;
  nodeId: string;
  samplingIntervalMs: number;
}

export interface BrowseNode {
  nodeId: string;
  displayName: string;
  nodeClass: string;
  dataType?: TagDataType;
  hasChildren: boolean;
}

/** Sunucu sertifikası güvenilmediğinde fırlatılır — TOFU akışını tetikler. */
export class OpcUaCertUntrustedError extends Error {
  constructor(
    public readonly certInfo: ServerCertInfo,
    message: string
  ) {
    super(message);
    this.name = 'OpcUaCertUntrustedError';
  }
}

// ─── Veri Tipi Eşleştirmeleri ────────────────────────────────────────────────

function toOpcDataType(t: TagDataType): DataType {
  switch (t) {
    case 'BOOL':
      return DataType.Boolean;
    case 'INT16':
      return DataType.Int16;
    case 'UINT16':
      return DataType.UInt16;
    case 'INT32':
      return DataType.Int32;
    case 'UINT32':
      return DataType.UInt32;
    case 'INT64':
      return DataType.Int64;
    case 'UINT64':
      return DataType.UInt64;
    case 'FLOAT32':
      return DataType.Float;
    case 'FLOAT64':
      return DataType.Double;
    case 'STRING':
      return DataType.String;
  }
}

/** OPC UA standart veri tipi NodeId numarası → TagDataType (browse sırasında kullanılır). */
const BUILTIN_TYPE_MAP: Record<number, TagDataType> = {
  1: 'BOOL', // Boolean
  2: 'INT16', // SByte
  3: 'UINT16', // Byte
  4: 'INT16', // Int16
  5: 'UINT16', // UInt16
  6: 'INT32', // Int32
  7: 'UINT32', // UInt32
  8: 'INT64', // Int64
  9: 'UINT64', // UInt64
  10: 'FLOAT32', // Float
  11: 'FLOAT64', // Double
  12: 'STRING', // String
};

function coerceReadValue(dv: DataValue): number | boolean | string | null {
  if (!dv.statusCode || !dv.statusCode.isGood()) return null;
  const raw = dv.value?.value;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') return raw;
  // Int64/UInt64: node-opcua [low, high] çifti döndürebilir
  if (Array.isArray(raw) && raw.length === 2 && raw.every((n) => typeof n === 'number')) {
    return raw[0] + raw[1] * 2 ** 32;
  }
  if (raw instanceof Date) return raw.toISOString();
  return String(raw);
}

function qualityOf(dv: DataValue): TagQuality {
  if (dv.statusCode?.isGood()) return 'good';
  const desc = dv.statusCode?.description?.toLowerCase() ?? '';
  return desc.includes('uncertain') ? 'uncertain' : 'bad';
}

function castForWrite(value: number | boolean | string, dataType: TagDataType): unknown {
  switch (dataType) {
    case 'BOOL':
      return value === true || value === 1 || value === '1' || value === 'true';
    case 'STRING':
      return String(value);
    case 'FLOAT32':
    case 'FLOAT64':
      return Number(value);
    default:
      return Math.trunc(Number(value));
  }
}

/**
 * OPC UA istemci adaptörü (node-opcua).
 * - SecurityMode=None → anonim/sertifikasız doğrudan bağlantı
 * - Sign/SignAndEncrypt → TOFU: bilinmeyen sunucu sertifikasında
 *   OpcUaCertUntrustedError fırlatılır (sertifika bilgisiyle birlikte)
 * - Subscription (MonitoredItem) + poll (session.read) veri toplama
 */
export class OpcUaAdapter {
  private client: OPCUAClient | null = null;
  private session: ClientSession | null = null;
  private subscription: ClientSubscription | null = null;
  private monitoredItems: ClientMonitoredItem[] = [];
  private connected = false;
  private stopping = false;

  /** Bağlantı koptuğunda worker'ı bilgilendirir (yeniden bağlanma tetiklenir). */
  public onDisconnect?: (message: string) => void;

  constructor(private config: PlcConnectionConfig) {}

  isConnected(): boolean {
    return this.connected && this.session !== null;
  }

  private mapSecurityMode(): MessageSecurityMode {
    const mode: OpcUaSecurityMode = this.config.securityMode ?? 'None';
    return MessageSecurityMode[mode];
  }

  private mapSecurityPolicy(): SecurityPolicy {
    const policy: OpcUaSecurityPolicy = this.config.securityPolicy ?? 'None';
    return SecurityPolicy[policy];
  }

  private get useSecurity(): boolean {
    return (this.config.securityMode ?? 'None') !== 'None';
  }

  async connect(): Promise<void> {
    await this.disconnect();
    this.stopping = false;

    const endpointUrl = this.config.endpointUrl;
    if (!endpointUrl) throw new Error('OPC UA endpoint URL tanımlı değil');

    // Security yoksa bilinmeyen sertifikayı otomatik kabul et (zararsız);
    // security varsa TOFU — bilinmeyen sertifika reddedilir ve yakalanır.
    const certManager = await createClientCertificateManager(!this.useSecurity);

    const client = OPCUAClient.create({
      applicationName: 'OE MES',
      endpointMustExist: false,
      securityMode: this.mapSecurityMode(),
      securityPolicy: this.mapSecurityPolicy(),
      clientCertificateManager: certManager,
      requestedSessionTimeout: this.config.sessionTimeoutMs ?? 30000,
      connectionStrategy: {
        initialDelay: 500,
        maxRetry: 1, // hızlı başarısızlık — yeniden bağlanmayı worker yönetir
        maxDelay: 5000,
      },
    });

    try {
      await client.connect(endpointUrl);
    } catch (err) {
      await client.disconnect().catch(() => undefined);
      if (this.useSecurity && this.isCertRelatedError(err)) {
        // Sunucu sertifikasını GetEndpoints (Security=None) ile alıp TOFU kaydı için ilet
        const certInfo = await this.fetchServerCertificate(endpointUrl);
        if (certInfo) {
          throw new OpcUaCertUntrustedError(
            certInfo,
            'Sunucu sertifikası güvenilenler listesinde değil — admin onayı gerekiyor'
          );
        }
      }
      throw new Error(this.describeError(err));
    }

    const session = await client.createSession(this.buildIdentity()).catch(async (err: unknown) => {
      await client.disconnect().catch(() => undefined);
      throw new Error(this.describeError(err));
    });

    this.client = client;
    this.session = session;
    this.connected = true;

    client.on('connection_lost', () => this.handleConnectionLost('OPC UA bağlantısı koptu'));
  }

  async disconnect(): Promise<void> {
    this.stopping = true;
    this.connected = false;

    for (const item of this.monitoredItems) {
      await item.terminate().catch(() => undefined);
    }
    this.monitoredItems = [];

    if (this.subscription) {
      await this.subscription.terminate().catch(() => undefined);
      this.subscription = null;
    }
    if (this.session) {
      await this.session.close(true).catch(() => undefined);
      this.session = null;
    }
    if (this.client) {
      await this.client.disconnect().catch(() => undefined);
      this.client = null;
    }
  }

  // ─── Okuma / Yazma ─────────────────────────────────────────────────────────

  async readValue(nodeId: string): Promise<OpcUaReadResult> {
    const session = this.ensureSession();
    const dv = await session.read({ nodeId, attributeId: AttributeIds.Value });
    return { value: coerceReadValue(dv), quality: qualityOf(dv) };
  }

  async writeValue(
    nodeId: string,
    value: number | boolean | string,
    dataType: TagDataType
  ): Promise<void> {
    const session = this.ensureSession();
    const status = await session.write({
      nodeId,
      attributeId: AttributeIds.Value,
      value: {
        value: {
          dataType: toOpcDataType(dataType),
          value: castForWrite(value, dataType),
        },
      },
    });
    if (!status.isGood()) {
      throw new Error(`Yazma reddedildi: ${status.toString()}`);
    }
  }

  // ─── Canlılık Sondası (kopma algılama) ─────────────────────────────────────

  /**
   * Sunucunun canlı olup olmadığını hafif bir okuma ile yoklar
   * (Server_ServerStatus_CurrentTime — her OPC UA sunucusunda vardır).
   * Cevap timeoutMs içinde gelmezse hata fırlatır → worker offline'a geçer.
   */
  async probe(timeoutMs = 5000): Promise<void> {
    const session = this.ensureSession();
    await Promise.race([
      session.read({ nodeId: 'ns=0;i=2258', attributeId: AttributeIds.Value }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Canlılık sondası zaman aşımına uğradı')), timeoutMs)
      ),
    ]);
  }

  // ─── Subscription ──────────────────────────────────────────────────────────

  async subscribe(
    tags: OpcUaSubscribeTag[],
    onData: (tagId: number, result: OpcUaReadResult) => void
  ): Promise<void> {
    const session = this.ensureSession();
    if (tags.length === 0) return;

    const minInterval = Math.max(100, Math.min(...tags.map((t) => t.samplingIntervalMs)));

    this.subscription = ClientSubscription.create(session, {
      requestedPublishingInterval: minInterval,
      requestedLifetimeCount: 100,
      requestedMaxKeepAliveCount: 20,
      maxNotificationsPerPublish: 100,
      publishingEnabled: true,
      priority: 10,
    });

    this.subscription.on('terminated', () => {
      // terminate() bizim tarafımızdan çağrıldıysa (stopping) kopma değildir
      if (!this.stopping) {
        this.handleConnectionLost('OPC UA subscription sonlandı');
      }
    });

    for (const tag of tags) {
      const item = await this.subscription.monitor(
        { nodeId: tag.nodeId, attributeId: AttributeIds.Value },
        {
          samplingInterval: Math.max(100, tag.samplingIntervalMs),
          discardOldest: true,
          queueSize: 1,
        },
        TimestampsToReturn.Both
      );

      const tagId = tag.tagId;
      item.on('changed', (dv: DataValue) => {
        onData(tagId, { value: coerceReadValue(dv), quality: qualityOf(dv) });
      });
      this.monitoredItems.push(item);
    }
  }

  // ─── Adres Alanı Gezinme (Browse) ──────────────────────────────────────────

  /**
   * Bir node'un TÜM referanslarını döner.
   * Siemens S7-1500 gibi sunucular referansları sayfalı (continuation point)
   * döndürür — browseNext ile tüm sayfalar toplanır, yoksa klasörler
   * eksik/boş görünür.
   */
  private async browseAllReferences(
    session: ClientSession,
    nodeId: string
  ): Promise<ReferenceDescription[]> {
    const all: ReferenceDescription[] = [];
    let result = await session.browse(nodeId);
    all.push(...(result.references ?? []));

    let guard = 0;
    while (result.continuationPoint && result.continuationPoint.length > 0 && guard < 100) {
      result = await session.browseNext(result.continuationPoint, false);
      all.push(...(result.references ?? []));
      guard += 1;
    }
    return all;
  }

  async browse(nodeId?: string): Promise<BrowseNode[]> {
    const session = this.ensureSession();
    const allRefs = await this.browseAllReferences(session, nodeId ?? 'ObjectsFolder');
    // Siemens S7 her klasöre anlamsız bir "Icon" property'si ekler — ağaçta gürültü olmasın
    const refs = allRefs.filter((ref) => ref.displayName?.text !== 'Icon');

    const nodes: BrowseNode[] = [];
    for (const ref of refs) {
      const node: BrowseNode = {
        nodeId: ref.nodeId.toString(),
        displayName: ref.displayName?.text ?? ref.browseName?.name ?? ref.nodeId.toString(),
        nodeClass: NodeClass[ref.nodeClass] ?? String(ref.nodeClass),
        hasChildren: await this.hasChildren(session, ref),
      };
      if (ref.nodeClass === NodeClass.Variable) {
        node.dataType = await this.readDataTypeAttribute(session, ref.nodeId.toString());
      }
      nodes.push(node);
    }
    return nodes;
  }

  private async hasChildren(session: ClientSession, ref: ReferenceDescription): Promise<boolean> {
    // Unspecified (S7 DB node'ları) dahil her node'un alt öğesi olabilir — denemek güvenli
    try {
      const children = await this.browseAllReferences(session, ref.nodeId.toString());
      // Icon property'si gerçek içerik sayılmaz
      return children.some((c) => c.displayName?.text !== 'Icon');
    } catch {
      return false;
    }
  }

  /** Variable node'un DataType attribute'unu okuyup TagDataType'a eşler. */
  private async readDataTypeAttribute(
    session: ClientSession,
    nodeId: string
  ): Promise<TagDataType | undefined> {
    try {
      const dv = await session.read({ nodeId, attributeId: AttributeIds.DataType });
      if (dv.statusCode.isGood() && dv.value?.value) {
        const typeNodeId = dv.value.value.toString?.() ?? '';
        const match = /i=(\d+)/.exec(typeNodeId);
        if (match) {
          const typeId = Number(match[1]);
          if (BUILTIN_TYPE_MAP[typeId]) return BUILTIN_TYPE_MAP[typeId];
        }
        if (/string|text|char|wstring/i.test(typeNodeId)) {
          return 'STRING';
        }
        // Custom DataType NodeId'sinin BrowseName'ini oku (Siemens S7 custom string/WString türleri)
        try {
          const nameDv = await session.read({ nodeId: typeNodeId, attributeId: AttributeIds.BrowseName });
          const nameText = nameDv.value?.value?.name?.toString() ?? nameDv.value?.value?.toString() ?? '';
          if (/string|wstring|char|text/i.test(nameText)) return 'STRING';
          if (/bool/i.test(nameText)) return 'BOOL';
          if (/int64/i.test(nameText)) return 'INT64';
          if (/int32|dint/i.test(nameText)) return 'INT32';
          if (/int16|int/i.test(nameText)) return 'INT16';
          if (/float|real/i.test(nameText)) return 'FLOAT32';
          if (/double/i.test(nameText)) return 'FLOAT64';
        } catch {
          // ignore
        }
      }

      // Fallback: Değişkenin o anki canlı değerinin (Value attribute) runtime tipini oku
      try {
        const valDv = await session.read({ nodeId, attributeId: AttributeIds.Value });
        if (valDv.statusCode?.isGood() && valDv.value?.value !== undefined && valDv.value?.value !== null) {
          const val = valDv.value.value;
          if (typeof val === 'string') return 'STRING';
          if (typeof val === 'boolean') return 'BOOL';
          if (typeof val === 'number') return Number.isInteger(val) ? 'INT32' : 'FLOAT32';
        }
      } catch {
        // ignore
      }

      return undefined;
    } catch {
      return undefined;
    }
  }

  // ─── Yardımcılar ───────────────────────────────────────────────────────────

  private ensureSession(): ClientSession {
    if (!this.session || !this.connected) {
      throw new Error('OPC UA oturumu kapalı');
    }
    return this.session;
  }

  private buildIdentity(): UserIdentityInfo {
    if (this.config.authType === 'username') {
      return {
        type: UserTokenType.UserName,
        userName: this.config.authUsername ?? '',
        password: this.config.authPassword ?? '',
      } as UserIdentityInfo;
    }
    return { type: UserTokenType.Anonymous } as UserIdentityInfo;
  }

  private isCertRelatedError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /certificate|BadSecurityChecksFailed|BadSecurityPolicyRejected|BadCertificateUntrusted|BadSecureChannelClosed/i.test(
      msg
    );
  }

  private describeError(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  /** Sunucu sertifikasını Security=None geçici bağlantıyla GetEndpoints üzerinden alır. */
  private async fetchServerCertificate(endpointUrl: string): Promise<ServerCertInfo | null> {
    const tmp = OPCUAClient.create({
      applicationName: 'OE MES (cert probe)',
      endpointMustExist: false,
      securityMode: MessageSecurityMode.None,
      securityPolicy: SecurityPolicy.None,
      connectionStrategy: { initialDelay: 500, maxRetry: 1, maxDelay: 3000 },
    });
    try {
      const endpoints = await tmp.getEndpoints({ endpointUrl });
      const withCert = endpoints.find(
        (e) => e.serverCertificate && e.serverCertificate.length > 0
      );
      if (!withCert?.serverCertificate) return null;
      return certInfoFromDer(Buffer.from(withCert.serverCertificate));
    } catch {
      return null;
    } finally {
      await tmp.disconnect().catch(() => undefined);
    }
  }

  private handleConnectionLost(message: string): void {
    if (this.stopping) return;
    this.connected = false;
    this.onDisconnect?.(message);
  }
}
