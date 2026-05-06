import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { drizzle } from 'drizzle-orm/sql-js';
import * as schema from './schema';
import { config } from '../config';
import * as fs from 'fs';
import * as path from 'path';

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: SqlJsDatabase | null = null;
let _saveTimer: ReturnType<typeof setTimeout> | null = null;

export async function initDatabase() {
  const dbDir = path.dirname(config.db.path);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const SQL = await initSqlJs();

  let sqliteDb: SqlJsDatabase;
  if (fs.existsSync(config.db.path)) {
    const buffer = fs.readFileSync(config.db.path);
    sqliteDb = new SQL.Database(buffer);
  } else {
    sqliteDb = new SQL.Database();
  }

  sqliteDb.run('PRAGMA foreign_keys = ON');

  _sqlite = sqliteDb;
  _db = drizzle(sqliteDb, { schema });

  return { db: _db, sqlite: _sqlite };
}

// 将数据库持久化到磁盘（防抖：100ms 内多次调用只写一次）
export function saveDatabase() {
  if (!_sqlite) return;

  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    if (!_sqlite) return;
    try {
      const data = _sqlite.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(config.db.path, buffer);
    } catch (err) {
      console.error('数据库持久化失败:', err);
    }
  }, 100);
}

// 立即同步保存（用于关闭前）
export function saveDatabaseSync() {
  if (!_sqlite) return;
  if (_saveTimer) clearTimeout(_saveTimer);
  try {
    const data = _sqlite.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(config.db.path, buffer);
  } catch (err) {
    console.error('数据库持久化失败:', err);
  }
}

export function getDb() {
  if (!_db) throw new Error('数据库未初始化，请先调用 initDatabase()');
  return _db;
}

export function getSqlite() {
  if (!_sqlite) throw new Error('数据库未初始化，请先调用 initDatabase()');
  return _sqlite;
}
