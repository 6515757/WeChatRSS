import { sql } from 'drizzle-orm';
import { initDatabase, getDb, saveDatabaseSync } from './index';
import * as fs from 'fs';
import * as path from 'path';

export async function runMigrations(): Promise<void> {
  console.log('正在运行数据库迁移...');

  const db = getDb();

  const migrationsDir = path.join(__dirname, '../../drizzle');
  if (!fs.existsSync(migrationsDir)) {
    console.log('没有找到迁移目录，跳过迁移');
    return;
  }

  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sqlContent = fs.readFileSync(filePath, 'utf-8');

    const statements = sqlContent
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      try {
        db.run(sql.raw(stmt));
      } catch (err: any) {
        if (err.message?.includes('already exists')) {
          continue;
        }
        throw err;
      }
    }
    console.log(`  已执行: ${file}`);
  }

  saveDatabaseSync();
  console.log('数据库迁移完成');
}

if (require.main === module) {
  initDatabase()
    .then(() => runMigrations())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('迁移失败:', err);
      process.exit(1);
    });
}
