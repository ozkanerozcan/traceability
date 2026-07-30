import bcrypt from 'bcryptjs';
import type Database from 'better-sqlite3';

/**
 * Varsayılan admin kullanıcısını oluşturur (yalnızca hiç kullanıcı yoksa).
 * İlk giriş: admin / admin — kullanıcıdan şifre değiştirmesi istenmelidir.
 */
export function seedDefaultAdmin(db: Database.Database): void {
  const count = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
  if (count > 0) return;

  const passwordHash = bcrypt.hashSync('admin', 10);
  db.prepare(
    `INSERT INTO users (username, password_hash, role, display_name, language, theme)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run('admin', passwordHash, 'admin', 'Administrator', 'tr', 'dark');

  console.log('[db] Varsayılan admin kullanıcı oluşturuldu (admin/admin)');
}

/** Veritabanı başlangıç rutini: migration + seed. */
export function initializeDatabase(db: Database.Database): void {
  seedDefaultAdmin(db);
}