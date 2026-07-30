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
