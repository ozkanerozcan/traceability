import type Database from 'better-sqlite3';
import { CORE_MODULE_IDS, MODULE_DISPLAY_NAMES } from '../../shared/constants/index.js';

interface Migration {
  id: number;
  name: string;
  up: (db: Database.Database) => void;
}

/**
 * Sıralı migration listesi. Yeni şema değişiklikleri listenin SONUNA eklenir,
 * mevcut migration'lar ASLA değiştirilmez.
 */
const migrations: Migration[] = [
  {
    id: 1,
    name: 'initial_schema',
    up: (db) => {
      db.exec(`
        -- ─── Core: Kullanıcılar ───
        CREATE TABLE users (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            username        TEXT UNIQUE NOT NULL,
            password_hash   TEXT NOT NULL,
            role            TEXT NOT NULL CHECK(role IN ('admin', 'supervisor', 'operator')),
            display_name    TEXT,
            language        TEXT DEFAULT 'tr',
            theme           TEXT DEFAULT 'dark',
            is_active       INTEGER DEFAULT 1,
            created_at      TEXT DEFAULT (datetime('now')),
            updated_at      TEXT DEFAULT (datetime('now'))
        );

        -- ─── Core: Sistem Ayarları ───
        CREATE TABLE system_settings (
            key         TEXT PRIMARY KEY,
            value       TEXT NOT NULL,
            category    TEXT NOT NULL,
            updated_at  TEXT DEFAULT (datetime('now'))
        );

        -- ─── Core: Modül Durumları ───
        CREATE TABLE modules (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            enabled     INTEGER DEFAULT 1,
            config      TEXT,
            updated_at  TEXT DEFAULT (datetime('now'))
        );

        -- ─── Core: Audit Trail ───
        CREATE TABLE audit_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER REFERENCES users(id),
            username    TEXT,
            action      TEXT NOT NULL,
            entity_type TEXT,
            entity_id   TEXT,
            details     TEXT,
            ip_address  TEXT,
            created_at  TEXT DEFAULT (datetime('now'))
        );

        -- ─── Core: Rol Yetkileri ───
        CREATE TABLE role_permissions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            role        TEXT NOT NULL,
            module_id   TEXT NOT NULL,
            permission  TEXT NOT NULL,
            granted     INTEGER DEFAULT 0,
            UNIQUE(role, module_id, permission)
        );

        -- ─── PLC Gateway: PLC Profilleri ───
        CREATE TABLE plc_profiles (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT UNIQUE NOT NULL,
            protocol        TEXT NOT NULL CHECK(protocol IN ('modbus_tcp', 'modbus_rtu')),
            host            TEXT,
            port            INTEGER DEFAULT 502,
            unit_id         INTEGER DEFAULT 1,
            serial_port     TEXT,
            baud_rate       INTEGER DEFAULT 9600,
            data_bits       INTEGER DEFAULT 8,
            stop_bits       INTEGER DEFAULT 1,
            parity          TEXT DEFAULT 'none',
            description     TEXT,
            is_active       INTEGER DEFAULT 1,
            created_at      TEXT DEFAULT (datetime('now')),
            updated_at      TEXT DEFAULT (datetime('now'))
        );

        -- ─── PLC Gateway: Tag Tanımları ───
        CREATE TABLE plc_tags (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            plc_id              INTEGER NOT NULL REFERENCES plc_profiles(id) ON DELETE CASCADE,
            name                TEXT NOT NULL,
            address             INTEGER NOT NULL,
            register_type       TEXT DEFAULT 'holding'
                                CHECK(register_type IN ('holding', 'input', 'coil', 'discrete')),
            data_type           TEXT NOT NULL
                                CHECK(data_type IN ('BOOL','INT16','UINT16','INT32','UINT32','FLOAT32','FLOAT64')),
            polling_interval_ms INTEGER NOT NULL DEFAULT 1000,
            unit                TEXT,
            description         TEXT,
            word_swap           INTEGER DEFAULT 0,
            byte_swap           INTEGER DEFAULT 0,
            is_active           INTEGER DEFAULT 1,
            created_at          TEXT DEFAULT (datetime('now')),
            updated_at          TEXT DEFAULT (datetime('now')),
            UNIQUE(plc_id, name)
        );

        -- ─── Reçeteler ───
        CREATE TABLE recipes (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            name              TEXT UNIQUE NOT NULL,
            description       TEXT,
            dashboard_layout  TEXT,
            created_at        TEXT DEFAULT (datetime('now')),
            updated_at        TEXT DEFAULT (datetime('now'))
        );

        -- ─── Reçete ↔ Tag Eşleştirmesi ───
        CREATE TABLE recipe_tags (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id    INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
            tag_id       INTEGER NOT NULL REFERENCES plc_tags(id),
            display_name TEXT,
            widget_type  TEXT DEFAULT 'numeric',
            sort_order   INTEGER DEFAULT 0,
            created_at   TEXT DEFAULT (datetime('now')),
            UNIQUE(recipe_id, tag_id)
        );

        -- ─── İş Emirleri ───
        CREATE TABLE work_orders (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            order_number    TEXT UNIQUE NOT NULL,
            recipe_id       INTEGER NOT NULL REFERENCES recipes(id),
            status          TEXT NOT NULL DEFAULT 'draft'
                            CHECK(status IN ('draft', 'active', 'paused', 'completed', 'archived')),
            started_at      TEXT,
            paused_at       TEXT,
            completed_at    TEXT,
            created_by      INTEGER REFERENCES users(id),
            started_by      INTEGER REFERENCES users(id),
            completed_by    INTEGER REFERENCES users(id),
            notes           TEXT,
            created_at      TEXT DEFAULT (datetime('now')),
            updated_at      TEXT DEFAULT (datetime('now'))
        );

        -- ─── Veri Kaydı (Zaman Serisi) ───
        CREATE TABLE data_log (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp       TEXT NOT NULL,
            work_order_id   INTEGER NOT NULL,
            tag_id          INTEGER NOT NULL,
            value           REAL
        );

        -- ─── Performans İndeksleri ───
        CREATE INDEX idx_data_log_ts ON data_log(timestamp);
        CREATE INDEX idx_data_log_wo ON data_log(work_order_id);
        CREATE INDEX idx_data_log_wo_tag_ts ON data_log(work_order_id, tag_id, timestamp);
        CREATE INDEX idx_audit_log_created ON audit_log(created_at);
        CREATE INDEX idx_audit_log_user ON audit_log(user_id);
        CREATE INDEX idx_plc_tags_plc ON plc_tags(plc_id);
        CREATE INDEX idx_recipe_tags_recipe ON recipe_tags(recipe_id);
        CREATE INDEX idx_work_orders_status ON work_orders(status);
      `);

      // Varsayılan modül kayıtları
      const insertModule = db.prepare(
        'INSERT OR IGNORE INTO modules (id, name, enabled) VALUES (?, ?, 1)'
      );
      for (const id of CORE_MODULE_IDS) {
        insertModule.run(id, MODULE_DISPLAY_NAMES[id]);
      }

      // Varsayılan sistem ayarları
      const insertSetting = db.prepare(
        'INSERT OR IGNORE INTO system_settings (key, value, category) VALUES (?, ?, ?)'
      );
      insertSetting.run('company_name', 'OE', 'branding');
      insertSetting.run('logo_path', '', 'branding');
      insertSetting.run('powered_by_visible', 'true', 'branding');
      insertSetting.run('session_timeout_minutes', '720', 'security');
      insertSetting.run('default_language', 'tr', 'general');
      insertSetting.run('default_theme', 'dark', 'general');
    },
  },
  {
    id: 2,
    name: 'opcua_support',
    up: (db) => {
      // NOT: Bu migration tablo yeniden kurulumu (rebuild) yapar; foreign_keys
      // runMigrations tarafından migration döngüsü öncesinde kapatılır.

      // ─── plc_profiles: protokol CHECK'ine 'opcua' ekle + OPC UA kolonları ───
      db.exec(`
        CREATE TABLE plc_profiles_new (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT UNIQUE NOT NULL,
            protocol        TEXT NOT NULL CHECK(protocol IN ('modbus_tcp', 'modbus_rtu', 'opcua')),
            host            TEXT,
            port            INTEGER DEFAULT 502,
            unit_id         INTEGER DEFAULT 1,
            serial_port     TEXT,
            baud_rate       INTEGER DEFAULT 9600,
            data_bits       INTEGER DEFAULT 8,
            stop_bits       INTEGER DEFAULT 1,
            parity          TEXT DEFAULT 'none',
            -- OPC UA ayarları
            endpoint_url        TEXT,
            security_mode       TEXT DEFAULT 'None'
                                CHECK(security_mode IN ('None', 'Sign', 'SignAndEncrypt')),
            security_policy     TEXT DEFAULT 'None'
                                CHECK(security_policy IN ('None', 'Basic128Rsa15', 'Basic256',
                                      'Basic256Sha256', 'Aes128_Sha256_RsaOaep', 'Aes256_Sha256_RsaPss')),
            auth_type           TEXT DEFAULT 'anonymous'
                                CHECK(auth_type IN ('anonymous', 'username', 'certificate')),
            auth_username       TEXT,
            auth_password_enc   TEXT,
            session_timeout_ms  INTEGER DEFAULT 30000,
            description     TEXT,
            is_active       INTEGER DEFAULT 1,
            created_at      TEXT DEFAULT (datetime('now')),
            updated_at      TEXT DEFAULT (datetime('now'))
        );

        INSERT INTO plc_profiles_new
          (id, name, protocol, host, port, unit_id, serial_port, baud_rate, data_bits,
           stop_bits, parity, description, is_active, created_at, updated_at)
         SELECT id, name, protocol, host, port, unit_id, serial_port, baud_rate, data_bits,
                stop_bits, parity, description, is_active, created_at, updated_at
         FROM plc_profiles;

        DROP TABLE plc_profiles;
        ALTER TABLE plc_profiles_new RENAME TO plc_profiles;
      `);

      // ─── plc_tags: TEXT adres + subscribe modu + genişletilmiş veri tipleri ───
      db.exec(`
        CREATE TABLE plc_tags_new (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            plc_id              INTEGER NOT NULL REFERENCES plc_profiles(id) ON DELETE CASCADE,
            name                TEXT NOT NULL,
            -- Modbus: '40001' | OPC UA: NodeId ('ns=2;s=...')
            address             TEXT NOT NULL,
            register_type       TEXT DEFAULT 'holding'
                                CHECK(register_type IN ('holding', 'input', 'coil', 'discrete')),
            data_type           TEXT NOT NULL
                                CHECK(data_type IN ('BOOL','INT16','UINT16','INT32','UINT32',
                                                    'INT64','UINT64','FLOAT32','FLOAT64','STRING')),
            acquisition_mode    TEXT DEFAULT 'poll'
                                CHECK(acquisition_mode IN ('poll', 'subscribe')),
            polling_interval_ms INTEGER NOT NULL DEFAULT 1000,
            unit                TEXT,
            description         TEXT,
            word_swap           INTEGER DEFAULT 0,
            byte_swap           INTEGER DEFAULT 0,
            is_active           INTEGER DEFAULT 1,
            created_at          TEXT DEFAULT (datetime('now')),
            updated_at          TEXT DEFAULT (datetime('now')),
            UNIQUE(plc_id, name)
        );

        INSERT INTO plc_tags_new
          (id, plc_id, name, address, register_type, data_type, acquisition_mode,
           polling_interval_ms, unit, description, word_swap, byte_swap, is_active,
           created_at, updated_at)
         SELECT id, plc_id, name, CAST(address AS TEXT), register_type, data_type, 'poll',
                polling_interval_ms, unit, description, word_swap, byte_swap, is_active,
                created_at, updated_at
         FROM plc_tags;

        DROP TABLE plc_tags;
        ALTER TABLE plc_tags_new RENAME TO plc_tags;
        CREATE INDEX idx_plc_tags_plc ON plc_tags(plc_id);
      `);

      // ─── OPC UA sunucu sertifikası güven yönetimi ───
      db.exec(`
        CREATE TABLE opcua_trusted_certs (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            plc_id          INTEGER NOT NULL REFERENCES plc_profiles(id) ON DELETE CASCADE,
            thumbprint      TEXT NOT NULL,
            subject         TEXT,
            pem             TEXT NOT NULL,
            status          TEXT NOT NULL DEFAULT 'pending'
                            CHECK(status IN ('pending', 'trusted', 'rejected')),
            first_seen_at   TEXT DEFAULT (datetime('now')),
            decided_at      TEXT,
            decided_by      INTEGER REFERENCES users(id),
            UNIQUE(plc_id, thumbprint)
        );
      `);

      // ─── data_log: kalite + metin değer (OPC UA) ───
      db.exec(`
        ALTER TABLE data_log ADD COLUMN value_text TEXT;
        ALTER TABLE data_log ADD COLUMN quality TEXT DEFAULT 'good';
      `);
    },
  },
  {
    id: 3,
    name: 'traceability_schema',
    up: (db) => {
      db.exec(`
        -- ─── İstasyonlar (konfigüre edilebilir) ───
        CREATE TABLE trace_stations (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            key          TEXT UNIQUE NOT NULL,        -- 'qr_generator', 'filling', ...
            name         TEXT NOT NULL,
            type         TEXT NOT NULL DEFAULT 'generic',
            sort_order   INTEGER DEFAULT 0,
            is_active    INTEGER DEFAULT 1,
            capabilities TEXT NOT NULL DEFAULT '[]',  -- JSON: ['qr_generate','plc_acquire',...]
            config       TEXT NOT NULL DEFAULT '{}',  -- JSON: {plcId, plcTagId, waitHours, positions, ...}
            created_at   TEXT DEFAULT (datetime('now')),
            updated_at   TEXT DEFAULT (datetime('now'))
        );

        -- ─── Rotalar ───
        CREATE TABLE trace_routes (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT UNIQUE NOT NULL,
            is_active   INTEGER DEFAULT 1,
            created_at  TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE trace_route_steps (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            route_id    INTEGER NOT NULL REFERENCES trace_routes(id) ON DELETE CASCADE,
            station_id  INTEGER NOT NULL REFERENCES trace_stations(id) ON DELETE CASCADE,
            sequence    INTEGER NOT NULL,             -- 0'dan başlayan sıra
            UNIQUE(route_id, sequence)
        );

        -- ─── Arabalar (Trolley) ───
        CREATE TABLE trace_trolleys (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            code        TEXT UNIQUE NOT NULL,         -- trolley QR içeriği
            slot_count  INTEGER NOT NULL DEFAULT 20,
            is_active   INTEGER DEFAULT 1,
            created_at  TEXT DEFAULT (datetime('now'))
        );

        -- ─── Ürünler (Shell) ───
        CREATE TABLE trace_products (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id         TEXT UNIQUE NOT NULL,  -- 'SH-YYYYMMDD-NNNN'
            status             TEXT NOT NULL DEFAULT 'in_progress'
                               CHECK(status IN ('in_progress','completed','rejected')),
            route_id           INTEGER REFERENCES trace_routes(id),
            current_step_index INTEGER NOT NULL DEFAULT 0,
            qr_content         TEXT,                  -- QR içeriği (= product_id)
            created_at         TEXT DEFAULT (datetime('now')),
            updated_at         TEXT DEFAULT (datetime('now'))
        );

        -- ─── Trolley slot atamaları ───
        CREATE TABLE trace_trolley_slots (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            trolley_id   INTEGER NOT NULL REFERENCES trace_trolleys(id) ON DELETE CASCADE,
            slot_number  INTEGER NOT NULL,            -- 1..20
            product_id   TEXT NOT NULL,               -- trace_products.product_id
            assigned_at  TEXT DEFAULT (datetime('now')),
            released_at  TEXT,                        -- boşaldığında
            UNIQUE(trolley_id, slot_number, released_at)
        );

        -- ─── İstasyon işlem kayıtları ───
        CREATE TABLE trace_station_records (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id   TEXT NOT NULL,               -- trace_products.product_id
            station_id   INTEGER NOT NULL REFERENCES trace_stations(id) ON DELETE CASCADE,
            trolley_id   INTEGER REFERENCES trace_trolleys(id),
            status       TEXT,                        -- 'ok' | 'nok' | 'done' | 'rejected' | null
            data         TEXT NOT NULL DEFAULT '{}',  -- JSON: PLC değerleri, tork, sıcaklık, süre, ...
            batch_no     TEXT,
            operator_id  INTEGER REFERENCES users(id),
            created_at   TEXT DEFAULT (datetime('now'))
        );

        -- ─── Parti numaraları (malzeme + bileşen, rotadan bağımsız) ───
        CREATE TABLE trace_batches (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_no    TEXT UNIQUE NOT NULL,
            kind        TEXT NOT NULL DEFAULT 'material'
                        CHECK(kind IN ('material','component')),
            description TEXT,
            created_at  TEXT DEFAULT (datetime('now'))
        );

        -- ─── Alarmlar ───
        CREATE TABLE trace_alarms (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id     TEXT,
            trolley_id     INTEGER,
            station_id     INTEGER REFERENCES trace_stations(id),
            severity       TEXT NOT NULL DEFAULT 'warning'
                           CHECK(severity IN ('info','warning','critical')),
            message        TEXT NOT NULL,
            acknowledged   INTEGER DEFAULT 0,
            acknowledged_by INTEGER REFERENCES users(id),
            acknowledged_at TEXT,
            created_at     TEXT DEFAULT (datetime('now'))
        );

        -- ─── QR üretim günlüğü (yeniden yazdırma) ───
        CREATE TABLE trace_qr_logs (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id   TEXT NOT NULL,
            qr_content   TEXT NOT NULL,
            printed_at   TEXT DEFAULT (datetime('now')),
            printed_by   INTEGER REFERENCES users(id)
        );

        -- ─── İndeksler ───
        CREATE INDEX idx_trace_products_status ON trace_products(status);
        CREATE INDEX idx_trace_records_product ON trace_station_records(product_id);
        CREATE INDEX idx_trace_records_station ON trace_station_records(station_id);
        CREATE INDEX idx_trace_slots_trolley ON trace_trolley_slots(trolley_id);
        CREATE INDEX idx_trace_alarms_ack ON trace_alarms(acknowledged);
      `);

      // Modül kaydı (mevcut DB'lerde migration 1 çalışmadığı için burada eklenir)
      db.prepare(
        'INSERT OR IGNORE INTO modules (id, name, enabled) VALUES (?, ?, 1)'
      ).run('traceability', 'Product Traceability');

      // ─── Ön-tanımlı istasyonlar (capability + örnek config ile) ───
      const insertStation = db.prepare(
        `INSERT OR IGNORE INTO trace_stations (key, name, type, sort_order, capabilities, config)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      const stations: [string, string, string, number, string, string][] = [
        ['qr_generator', 'QR Kod Üretim', 'qr', 0,
          JSON.stringify(['qr_generate', 'printing']),
          JSON.stringify({})],
        ['trolley_assign', 'Araba Atama', 'trolley', 1,
          JSON.stringify(['trolley_assign', 'plc_acquire']),
          JSON.stringify({ torqueTagKey: 'torque' })],
        ['filling', 'Dolum', 'plc', 2,
          JSON.stringify(['plc_acquire', 'batch_assign']),
          JSON.stringify({ positions: 20, groupSize: 4, positionTagKey: 'trolley_position' })],
        ['probing', 'Problama', 'plc', 3,
          JSON.stringify(['plc_acquire']),
          JSON.stringify({ positions: 20 })],
        ['conditioning', 'Kondisyonlama', 'wait', 4,
          JSON.stringify(['wait_control', 'ok_nok']),
          JSON.stringify({ waitHours: 24 })],
        ['drilling', 'Delme', 'check', 5,
          JSON.stringify(['ok_nok']),
          JSON.stringify({})],
        ['xray', 'X-Ray', 'check', 6,
          JSON.stringify(['ok_nok']),
          JSON.stringify({})],
        ['painting', 'Boya', 'check', 7,
          JSON.stringify(['ok_nok']),
          JSON.stringify({})],
        ['manual_workstation', 'Manuel Montaj', 'assembly', 8,
          JSON.stringify(['batch_assign', 'ok_nok', 'operator_confirm']),
          JSON.stringify({ componentKind: 'component' })],
      ];
      for (const s of stations) insertStation.run(...s);

      // ─── Varsayılan rota: tüm istasyonlar sırayla ───
      db.prepare('INSERT OR IGNORE INTO trace_routes (id, name, is_active) VALUES (1, ?, 1)')
        .run('Varsayılan Rota');
      const stationIds = db
        .prepare('SELECT id FROM trace_stations ORDER BY sort_order')
        .all() as { id: number }[];
      const insertStep = db.prepare(
        'INSERT OR IGNORE INTO trace_route_steps (route_id, station_id, sequence) VALUES (1, ?, ?)'
      );
      stationIds.forEach((st, i) => insertStep.run(st.id, i));
    },
  },
  {
    id: 4,
    name: 'traceability_capability_rename',
    up: (db) => {
      // printing kaldırıldı (qr_generate yazdırmayı zaten içerir);
      // trolley_assign → trolley_read (Araba Okuma) olarak yeniden adlandırıldı.
      const rows = db
        .prepare('SELECT id, capabilities FROM trace_stations')
        .all() as { id: number; capabilities: string }[];
      const update = db.prepare('UPDATE trace_stations SET capabilities = ? WHERE id = ?');
      for (const row of rows) {
        let caps: string[] = [];
        try {
          caps = JSON.parse(row.capabilities) as string[];
        } catch {
          caps = [];
        }
        const next = caps
          .filter((c) => c !== 'printing')
          .map((c) => (c === 'trolley_assign' ? 'trolley_read' : c));
        // Olası yinelemeleri temizle (hem trolley_assign hem trolley_read varsa)
        const dedup = [...new Set(next)];
        if (JSON.stringify(dedup) !== row.capabilities) {
          update.run(JSON.stringify(dedup), row.id);
        }
      }
    },
  },
  {
    id: 5,
    name: 'recipe_tags_cascade_delete',
    up: (db) => {
      db.exec(`
        CREATE TABLE recipe_tags_new (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id    INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
            tag_id       INTEGER NOT NULL REFERENCES plc_tags(id) ON DELETE CASCADE,
            display_name TEXT,
            widget_type  TEXT DEFAULT 'numeric',
            sort_order   INTEGER DEFAULT 0,
            created_at   TEXT DEFAULT (datetime('now')),
            UNIQUE(recipe_id, tag_id)
        );

        INSERT INTO recipe_tags_new
          (id, recipe_id, tag_id, display_name, widget_type, sort_order, created_at)
         SELECT id, recipe_id, tag_id, display_name, widget_type, sort_order, created_at
         FROM recipe_tags;

        DROP TABLE recipe_tags;
        ALTER TABLE recipe_tags_new RENAME TO recipe_tags;
        CREATE INDEX idx_recipe_tags_recipe ON recipe_tags(recipe_id);
      `);
    },
  },
  {
    id: 6,
    name: 'traceability_simplified_2tables',
    up: (db) => {
      db.exec(`
        -- Physical 2-table model: trolleys & shells
        CREATE TABLE IF NOT EXISTS trolleys (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            trolley_id  TEXT UNIQUE NOT NULL,
            capacity    INTEGER NOT NULL DEFAULT 20,
            is_active   INTEGER DEFAULT 1,
            created_at  TEXT DEFAULT (datetime('now'))
        );

        INSERT OR IGNORE INTO trolleys (id, trolley_id, capacity, is_active, created_at)
        SELECT id, code, slot_count, is_active, created_at FROM trace_trolleys;

        CREATE TABLE IF NOT EXISTS shells (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            shell_id           TEXT UNIQUE NOT NULL,
            trolley_id         TEXT REFERENCES trolleys(trolley_id),
            slot_number        INTEGER,
            status             TEXT NOT NULL DEFAULT 'in_progress'
                               CHECK(status IN ('in_progress','completed','rejected')),
            route_id           INTEGER REFERENCES trace_routes(id),
            current_step_index INTEGER NOT NULL DEFAULT 0,
            qr_content         TEXT,
            history            TEXT NOT NULL DEFAULT '[]',
            created_at         TEXT DEFAULT (datetime('now')),
            updated_at         TEXT DEFAULT (datetime('now'))
        );

        INSERT OR IGNORE INTO shells (id, shell_id, status, route_id, current_step_index, qr_content, created_at, updated_at)
        SELECT id, product_id, status, route_id, current_step_index, qr_content, created_at, updated_at FROM trace_products;

        -- Migrasyon: eski slot ilişkilerini aktar (varsa)
        UPDATE shells
        SET trolley_id = (
            SELECT t.code FROM trace_trolley_slots s JOIN trace_trolleys t ON t.id = s.trolley_id
            WHERE s.product_id = shells.shell_id AND s.released_at IS NULL LIMIT 1
        ),
        slot_number = (
            SELECT s.slot_number FROM trace_trolley_slots s
            WHERE s.product_id = shells.shell_id AND s.released_at IS NULL LIMIT 1
        )
        WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='trace_trolley_slots');

        -- Eski tabloları temizle
        DROP TABLE IF EXISTS trace_trolley_slots;
        DROP TABLE IF EXISTS trace_station_records;
        DROP TABLE IF EXISTS trace_qr_logs;
        DROP TABLE IF EXISTS trace_products;
        DROP TABLE IF EXISTS trace_trolleys;

        -- İndeksler
        CREATE INDEX IF NOT EXISTS idx_shells_status ON shells(status);
        CREATE INDEX IF NOT EXISTS idx_shells_trolley ON shells(trolley_id);

        -- Geriye dönük sorgu uyumluluğu için görünümler (VIEW)
        CREATE VIEW IF NOT EXISTS trace_products AS
        SELECT id, shell_id AS product_id, status, route_id, current_step_index, qr_content, trolley_id AS trolley_code, slot_number, '' AS plc_data, history, created_at, updated_at
        FROM shells;

        CREATE VIEW IF NOT EXISTS trace_trolleys AS
        SELECT id, trolley_id AS code, capacity AS slot_count, is_active, created_at
        FROM trolleys;
      `);
    },
  },
  {
    id: 7,
    name: 'traceability_shells_trolleys_tables',
    up: (db) => {
      // Güvenli silme: nesne VIEW ise DROP VIEW, TABLE ise DROP TABLE çalıştırır
      const dropObject = (name: string) => {
        const row = db.prepare(`SELECT type FROM sqlite_master WHERE name = ?`).get(name) as { type: string } | undefined;
        if (row) {
          if (row.type === 'view') {
            db.exec(`DROP VIEW IF EXISTS "${name}"`);
          } else if (row.type === 'table') {
            db.exec(`DROP TABLE IF EXISTS "${name}"`);
          }
        }
      };

      // 1. Yeni shells_new tablosunu oluştur
      db.exec(`
        CREATE TABLE IF NOT EXISTS shells_new (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            shell_id           TEXT UNIQUE NOT NULL,
            trolley_id         TEXT,
            slot_number        INTEGER,
            status             TEXT NOT NULL DEFAULT 'in_progress'
                               CHECK(status IN ('in_progress','completed','rejected')),
            route_id           INTEGER REFERENCES trace_routes(id),
            current_step_index INTEGER NOT NULL DEFAULT 0,
            qr_content         TEXT,
            history            TEXT NOT NULL DEFAULT '[]',
            created_at         TEXT DEFAULT (datetime('now')),
            updated_at         TEXT DEFAULT (datetime('now'))
        );
      `);

      // Varsa eski trace_products veya shells verilerini güvenle aktar
      const hasTraceProducts = db.prepare(`SELECT type FROM sqlite_master WHERE name = 'trace_products'`).get() as { type: string } | undefined;
      if (hasTraceProducts && hasTraceProducts.type === 'table') {
        db.exec(`
          INSERT OR IGNORE INTO shells_new (id, shell_id, status, route_id, current_step_index, qr_content, trolley_id, slot_number, history, created_at, updated_at)
          SELECT id, product_id, status, route_id, current_step_index, qr_content, trolley_code, slot_number, history, created_at, updated_at
          FROM trace_products;
        `);
      }

      const hasShells = db.prepare(`SELECT type FROM sqlite_master WHERE name = 'shells'`).get() as { type: string } | undefined;
      if (hasShells && hasShells.type === 'table') {
        const cols = db.prepare(`PRAGMA table_info(shells)`).all() as { name: string }[];
        const colNames = cols.map((c) => c.name);
        const routeIdCol = colNames.includes('route_id') ? 'route_id' : 'NULL AS route_id';
        const shellIdCol = colNames.includes('shell_id') ? 'shell_id' : colNames.includes('product_id') ? 'product_id' : 'NULL AS shell_id';
        const trolleyIdCol = colNames.includes('trolley_id') ? 'trolley_id' : colNames.includes('trolley_code') ? 'trolley_code' : 'NULL AS trolley_id';
        const historyCol = colNames.includes('history') ? 'history' : "'[]' AS history";

        db.exec(`
          INSERT OR IGNORE INTO shells_new (id, shell_id, status, route_id, current_step_index, qr_content, trolley_id, slot_number, history, created_at, updated_at)
          SELECT id, ${shellIdCol}, status, ${routeIdCol}, current_step_index, qr_content, ${trolleyIdCol}, slot_number, ${historyCol}, created_at, updated_at
          FROM shells;
        `);
      }

      // Eski nesneleri type kontrolü ile güvenle kaldır
      dropObject('shells');
      dropObject('trace_products');
      dropObject('trolleys');
      dropObject('trace_trolleys');
      dropObject('trace_trolley_slots');
      dropObject('trace_station_records');
      dropObject('trace_qr_logs');

      // shells_new -> shells olarak adlandır
      db.exec(`ALTER TABLE shells_new RENAME TO shells;`);

      // 2. Trolleys tablosunu oluştur
      db.exec(`
        CREATE TABLE IF NOT EXISTS trolleys_new (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            trolley_id  TEXT UNIQUE NOT NULL,
            capacity    INTEGER NOT NULL DEFAULT 20,
            is_active   INTEGER DEFAULT 1,
            created_at  TEXT DEFAULT (datetime('now'))
        );
      `);
      db.exec(`ALTER TABLE trolleys_new RENAME TO trolleys;`);

      // 3. İndeksler ve Görünümler
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_shells_status ON shells(status);
        CREATE INDEX IF NOT EXISTS idx_shells_trolley ON shells(trolley_id);

        CREATE VIEW IF NOT EXISTS trace_products AS
        SELECT id, shell_id AS product_id, status, route_id, current_step_index, qr_content, trolley_id AS trolley_code, slot_number, '' AS plc_data, history, created_at, updated_at
        FROM shells;

        CREATE VIEW IF NOT EXISTS trace_trolleys AS
        SELECT id, trolley_id AS code, capacity AS slot_count, is_active, created_at
        FROM trolleys;
      `);
    },
  },
  {
    id: 8,
    name: 'traceability_station_rename_trolley_shell',
    up: (db) => {
      // "Araba Atama" istasyonu → "Trolley - Shell Eşleştirme" olarak yeniden adlandırıldı.
      db.prepare(`UPDATE trace_stations SET name = ? WHERE key = ?`).run('Trolley - Shell Eşleştirme', 'trolley_assign');
    },
  },
  {
    id: 9,
    name: 'traceability_station_split_funnel_trolley',
    up: (db) => {
      // "Trolley - Shell Eşleştirme" istasyonu ikiye bölündü:
      //   1) Funnel Sıkma (funnel_sikma): trolley_read + plc_acquire  → ÖNCE çalışır
      //   2) Trolley Yükleme (trolley_assign): trolley_read + trolley_assign → SONRA çalışır
      const station = db
        .prepare(`SELECT id, config FROM trace_stations WHERE key = 'trolley_assign'`)
        .get() as { id: number; config: string } | undefined;
      if (!station) return;

      // 1. Diğer istasyonların sırasını kaydır (filling ve sonrası +1)
      db.prepare(`UPDATE trace_stations SET sort_order = sort_order + 1 WHERE sort_order >= 2 AND key != 'trolley_assign'`).run();

      // 2. Mevcut istasyon → "Trolley Yükleme" (trolley_read + trolley_assign), sıra 2
      db.prepare(
        `UPDATE trace_stations SET name = ?, capabilities = ?, sort_order = 2 WHERE key = 'trolley_assign'`
      ).run('Trolley Yükleme', JSON.stringify(['trolley_read', 'trolley_assign']));

      // 3. Yeni istasyon → "Funnel Sıkma" (trolley_read + plc_acquire), sıra 1
      //    PLC konfigürasyonu mevcut istasyondan miras alınır (tag'ler UI'dan düzenlenebilir)
      db.prepare(
        `INSERT OR IGNORE INTO trace_stations (key, name, type, sort_order, capabilities, config)
         VALUES (?, ?, ?, 1, ?, ?)`
      ).run('funnel_sikma', 'Funnel Sıkma', 'trolley', JSON.stringify(['trolley_read', 'plc_acquire']), station.config);

      const funnel = db
        .prepare(`SELECT id FROM trace_stations WHERE key = 'funnel_sikma'`)
        .get() as { id: number } | undefined;
      if (!funnel) return;

      // 4. Rota adımları: trolley_assign'ı içeren her rotada Funnel Sıkma'yı
      //    Trolley Yükleme'nin HEMEN ÖNÜNE ekle (önce mevcut adımları kaydır).
      const routes = db
        .prepare(`SELECT route_id, sequence FROM trace_route_steps WHERE station_id = ?`)
        .all(station.id) as { route_id: number; sequence: number }[];
      for (const r of routes) {
        // İki fazlı kaydırma: UNIQUE(route_id, sequence) ihlalini önlemek için
        // önce negatife çek, sonra geri al (seq+1 sonucu pozitif olur).
        db.prepare(`UPDATE trace_route_steps SET sequence = -(sequence + 1) WHERE route_id = ? AND sequence >= ?`)
          .run(r.route_id, r.sequence);
        db.prepare(`UPDATE trace_route_steps SET sequence = -sequence WHERE route_id = ? AND sequence < 0`)
          .run(r.route_id);
        db.prepare(`INSERT INTO trace_route_steps (route_id, station_id, sequence) VALUES (?, ?, ?)`)
          .run(r.route_id, funnel.id, r.sequence);
      }
    },
  },
  {
    id: 10,
    name: 'mes_bridge_module_removed',
    up: (db) => {
      // NOT: mes-bridge (MES'in OPC UA Server olması) yaklaşımı KALDIRILDI —
      // mimari: PLC = OPC UA Server, MES backend = OPC UA Client. Daha önce
      // uygulanmış olabilecek köprü kayıtları temizlenir.
      db.prepare(`DELETE FROM modules WHERE id = 'mes-bridge'`).run();
      db.prepare(`DELETE FROM system_settings WHERE key IN ('bridge_enabled', 'bridge_port')`).run();
    },
  },
  {
    id: 11,
    name: 'traceability_station_types',
    up: (db) => {
      // ═══════════════════════════════════════════════════════════════════════
      // BÜYÜK YENİDEN YAPI: Yetenek (capability) sistemi + Rotalar KALDIRILDI.
      //
      // - Her istasyon sabit bir TİP'e sahiptir (kendi özel ayarlarıyla):
      //     qr_generate, trolley_read, funnel_screwing,
      //     trolley_shell_matching, filling, probing
      // - Standart PLC sözleşmesi (istasyon başına tag eşlemesi):
      //     ShellId, TrolleyId, SlotNumber, RowNumber, Trigger, Data/<tagAdı>
      //     Sonuç: Ack(bool), ErrorCode(int), ErrorMessage(string), Busy(bool)
      // - Ölçümler artık düzenlenebilir/silinebilir `trace_measurements`
      //   tablosunda (web arayüzünden manuel giriş de desteklenir).
      // - Son okunan araba `trace_station_runtime` tablosunda DB'de saklanır
      //   (Trolley-Shell eşleştirme istasyonu bunu kullanır; restart'ta kaybolmaz).
      // ═══════════════════════════════════════════════════════════════════════

      const dropObject = (name: string) => {
        const row = db.prepare(`SELECT type FROM sqlite_master WHERE name = ?`).get(name) as { type: string } | undefined;
        if (row?.type === 'view') db.exec(`DROP VIEW IF EXISTS "${name}"`);
        else if (row?.type === 'table') db.exec(`DROP TABLE IF EXISTS "${name}"`);
      };

      // ─── 1) Yeni tablolar: ölçümler + istasyon runtime ───
      db.exec(`
        CREATE TABLE IF NOT EXISTS trace_measurements (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            shell_id    TEXT NOT NULL REFERENCES shells(shell_id) ON DELETE CASCADE,
            station_key TEXT NOT NULL,             -- istasyon anahtarı (slug)
            field       TEXT NOT NULL,             -- 'Funnel Torque', 'Shell Temperature', ...
            tag_id      INTEGER,                   -- kaynak PLC tag (silinse bile ölçüm kalır)
            value_num   REAL,
            value_text  TEXT,
            source      TEXT NOT NULL DEFAULT 'plc' CHECK(source IN ('plc','manual')),
            created_at  TEXT DEFAULT (datetime('now')),
            updated_at  TEXT DEFAULT (datetime('now')),
            UNIQUE(shell_id, station_key, field)   -- tekrar tetikte UPSERT (üzerine yazar)
        );
        CREATE INDEX IF NOT EXISTS idx_trace_measurements_shell ON trace_measurements(shell_id);
        CREATE INDEX IF NOT EXISTS idx_trace_measurements_station ON trace_measurements(station_key);

        CREATE TABLE IF NOT EXISTS trace_station_runtime (
            station_id   INTEGER PRIMARY KEY REFERENCES trace_stations(id) ON DELETE CASCADE,
            trolley_id   TEXT,                     -- son okunan/aktif araba kodu
            last_capture TEXT,                     -- JSON: son yakalanan veri (UI gösterimi)
            updated_at   TEXT DEFAULT (datetime('now'))
        );
      `);

      // ─── 1b) Eski görünümleri ÖNCE kaldır — shells rebuild sırasında
      //         bağımlı view doğrulaması (route_id içeren eski view) patlamasın ───
      dropObject('trace_products');
      dropObject('trace_trolleys');

      // ─── 2) trace_stations rebuild (capabilities kolonu kalkar) ───
      interface OldStation {
        id: number; key: string; name: string; type: string;
        sort_order: number; is_active: number; capabilities: string; config: string;
        created_at?: string; updated_at?: string;
      }
      const oldStations = db.prepare('SELECT * FROM trace_stations').all() as OldStation[];

      // Eski istasyon → yeni sabit tip eşlemesi
      const mapType = (s: OldStation, caps: string[]): { type: string; active: number } => {
        const k = s.key.toLowerCase();
        if (caps.includes('qr_generate')) return { type: 'qr_generate', active: s.is_active };
        if (k.includes('funnel')) return { type: 'funnel_screwing', active: s.is_active };
        if (caps.includes('trolley_assign') || k.includes('matching') || k.includes('eslestirme'))
          return { type: 'trolley_shell_matching', active: s.is_active };
        if (k === 'filling' || k === 'dolum') return { type: 'filling', active: s.is_active };
        if (k === 'probing' || k === 'problama') return { type: 'probing', active: s.is_active };
        // Tanınmayan eski istasyonlar (conditioning, drilling, xray, painting,
        // manual...) PASİFLEŞTİRİLİR — silinmez, ileride yeni tip eklenebilir.
        return { type: 'legacy', active: 0 };
      };

      // Eski config JSON → yeni standart PLC sözleşmesi
      const KEEP_KEYS = [
        'plcId', 'triggerTagId', 'dataTagIds', 'shellIdTagId', 'trolleyIdTagId',
        'slotTagId', 'rowTagId', 'ackTagId', 'errorMessageTagId',
        'labelWidth', 'labelHeight', 'clearOnRead',
      ];
      const convertConfig = (raw: string): string => {
        let old: Record<string, unknown> = {};
        try { old = JSON.parse(raw) as Record<string, unknown>; } catch { old = {}; }
        const next: Record<string, unknown> = {};
        for (const key of KEEP_KEYS) {
          if (old[key] !== undefined) next[key] = old[key];
        }
        return JSON.stringify(next);
      };

      db.exec(`
        CREATE TABLE trace_stations_new (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            key          TEXT UNIQUE NOT NULL,
            name         TEXT NOT NULL,
            type         TEXT NOT NULL DEFAULT 'legacy',
            sort_order   INTEGER DEFAULT 0,
            is_active    INTEGER DEFAULT 1,
            config       TEXT NOT NULL DEFAULT '{}',
            created_at   TEXT DEFAULT (datetime('now')),
            updated_at   TEXT DEFAULT (datetime('now'))
        );
      `);

      const TYPE_ORDER: Record<string, number> = {
        qr_generate: 0,
        trolley_read: 1,
        funnel_screwing: 2,
        trolley_shell_matching: 3,
        filling: 4,
        probing: 5,
      };

      const insertStation = db.prepare(
        `INSERT INTO trace_stations_new (id, key, name, type, sort_order, is_active, config, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      const mapped: { id: number; key: string; name: string; type: string; sort: number; active: number; config: string; created_at?: string; updated_at?: string }[] = [];
      for (const s of oldStations) {
        let caps: string[] = [];
        try { caps = JSON.parse(s.capabilities) as string[]; } catch { caps = []; }
        const { type, active } = mapType(s, caps);
        mapped.push({
          id: s.id, key: s.key, name: s.name, type,
          sort: TYPE_ORDER[type] ?? 90 + s.sort_order,
          active, config: convertConfig(s.config),
          created_at: s.created_at, updated_at: s.updated_at,
        });
      }

      // Trolley Okuma istasyonu yoksa ekle (QR'den hemen sonra)
      if (!mapped.some((s) => s.type === 'trolley_read')) {
        mapped.push({
          id: 0, // yeni kayıt — AUTOINCREMENT
          key: 'trolley_read', name: 'Trolley Okuma', type: 'trolley_read',
          sort: 1, active: 1, config: '{}',
        });
      }

      for (const s of mapped) {
        if (s.id) {
          insertStation.run(s.id, s.key, s.name, s.type, s.sort, s.active, s.config, s.created_at ?? null, s.updated_at ?? null);
        } else {
          db.prepare(
            `INSERT INTO trace_stations_new (key, name, type, sort_order, is_active, config) VALUES (?, ?, ?, ?, ?, ?)`
          ).run(s.key, s.name, s.type, s.sort, s.active, s.config);
        }
      }

      dropObject('trace_stations');
      db.exec(`ALTER TABLE trace_stations_new RENAME TO trace_stations;`);

      // ─── 3) shells rebuild (route_id + current_step_index kalkar) ───
      db.exec(`
        CREATE TABLE shells_new (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            shell_id    TEXT UNIQUE NOT NULL,
            trolley_id  TEXT,
            slot_number INTEGER,
            status      TEXT NOT NULL DEFAULT 'in_progress'
                        CHECK(status IN ('in_progress','completed','rejected')),
            qr_content  TEXT,
            history     TEXT NOT NULL DEFAULT '[]',
            created_at  TEXT DEFAULT (datetime('now')),
            updated_at  TEXT DEFAULT (datetime('now'))
        );
        INSERT OR IGNORE INTO shells_new (id, shell_id, trolley_id, slot_number, status, qr_content, history, created_at, updated_at)
          SELECT id, shell_id, trolley_id, slot_number, status, qr_content, history, created_at, updated_at FROM shells;
      `);
      dropObject('shells');
      db.exec(`ALTER TABLE shells_new RENAME TO shells;`);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_shells_status ON shells(status);
        CREATE INDEX IF NOT EXISTS idx_shells_trolley ON shells(trolley_id);
      `);

      // ─── 4) Rota yapısı tamamen kaldırılır ───
      dropObject('trace_route_steps');
      dropObject('trace_routes');

      // ─── 5) Geriye dönük görünümler (yeni şemaya göre yeniden oluştur) ───
      db.exec(`
        CREATE VIEW IF NOT EXISTS trace_products AS
        SELECT id, shell_id AS product_id, status, qr_content, trolley_id AS trolley_code, slot_number, '' AS plc_data, history, created_at, updated_at
        FROM shells;

        CREATE VIEW IF NOT EXISTS trace_trolleys AS
        SELECT id, trolley_id AS code, capacity AS slot_count, is_active, created_at
        FROM trolleys;
      `);

      // ─── 6) Mevcut history JSON'undaki PLC verilerini trace_measurements'a taşı (best-effort) ───
      const tagRows = db.prepare('SELECT id, name FROM plc_tags').all() as { id: number; name: string }[];
      const tagNameById = new Map(tagRows.map((r) => [r.id, r.name]));
      const stationIdToKey = new Map(mapped.filter((s) => s.id).map((s) => [s.id, s.key]));

      const insertMeasurement = db.prepare(
        `INSERT OR IGNORE INTO trace_measurements (shell_id, station_key, field, tag_id, value_num, value_text, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'plc', ?, ?)`
      );

      const shellRows = db.prepare('SELECT shell_id, history FROM shells').all() as { shell_id: string; history: string }[];
      for (const shell of shellRows) {
        let history: Record<string, unknown>[] = [];
        try { history = JSON.parse(shell.history) as Record<string, unknown>[]; } catch { continue; }
        for (const rec of history) {
          const data = rec?.data as Record<string, unknown> | undefined;
          if (!data || typeof data !== 'object') continue;
          const stationKey =
            (rec.station_key as string) ??
            (rec.stationKey as string) ??
            stationIdToKey.get(Number(rec.station_id ?? rec.stationId)) ??
            null;
          if (!stationKey) continue;
          const at = (rec.created_at as string) ?? (rec.createdAt as string) ?? null;
          for (const [k, v] of Object.entries(data)) {
            if (v === null || v === undefined) continue;
            const m = /^tag_(\d+)$/.exec(k);
            const tagId = m ? Number(m[1]) : null;
            const field = m ? (tagNameById.get(tagId!) ?? k) : k;
            const num = typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : null;
            const text = typeof v === 'number' ? null : String(v);
            insertMeasurement.run(shell.shell_id, stationKey, field, tagId, num, text, at, at);
          }
        }
      }
    },
  },
];

/**
 * Bekleyen migration'ları sırayla uygular.
 * schema_migrations tablosu ile hangi migration'ların uygulandığını takip eder.
 */
export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  TEXT DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as { id: number }[]).map((r) => r.id)
  );

  const insertMigration = db.prepare('INSERT INTO schema_migrations (id, name) VALUES (?, ?)');

  // Tablo yeniden kurulumu içeren migration'lar (örn. 2_opcua_support) FK
  // kısıtlarına takılmamalı. PRAGMA foreign_keys transaction içinde no-op
  // olduğundan döngü DIŞINDA (transaction'lar arasında) kapatılıp açılır.
  db.pragma('foreign_keys = OFF');

  try {
    for (const migration of migrations) {
      if (applied.has(migration.id)) continue;

      const apply = db.transaction(() => {
        migration.up(db);
        insertMigration.run(migration.id, migration.name);
      });

      apply();
      console.log(`[db] Migration uygulandı: ${migration.id}_${migration.name}`);
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }
}
