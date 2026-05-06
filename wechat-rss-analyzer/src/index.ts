import { validateConfig } from './config';
import { initDatabase } from './db';
import { runMigrations } from './db/migrate';
import { startServer } from './api';
import { startScheduler } from './scheduler';

async function main() {
  console.log('🔧 微信公众号文章分析系统启动中...');

  // 1. 校验配置
  validateConfig();

  // 2. 初始化数据库
  await initDatabase();

  // 3. 运行数据库迁移
  await runMigrations();

  // 4. 启动 HTTP 服务
  const app = await startServer();

  // 5. 启动定时任务
  startScheduler();

  // 优雅关闭
  const shutdown = async (signal: string) => {
    console.log(`\n收到 ${signal} 信号，正在关闭...`);
    const { saveDatabaseSync } = await import('./db');
    saveDatabaseSync();
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
