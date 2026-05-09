import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import path from 'path';
import { config } from '../config';
import { feedRoutes } from './routes/feeds';
import { articleRoutes } from './routes/articles';
import { reportRoutes } from './routes/reports';
import { taskRoutes } from './routes/tasks';
import { digestRoutes } from './routes/digests';
import { searchRoutes } from './routes/search';

export async function createServer() {
  const app = Fastify({
    logger: {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    },
  });

  // CORS
  await app.register(cors, { origin: true });

  // 静态文件（UI）
  await app.register(staticPlugin, {
    root: path.join(__dirname, '../public'),
    prefix: '/',
  });

  // 健康检查
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  // 注册路由（统一 /api 前缀）
  await app.register(feedRoutes, { prefix: '/api' });
  await app.register(articleRoutes, { prefix: '/api' });
  await app.register(reportRoutes, { prefix: '/api' });
  await app.register(taskRoutes, { prefix: '/api' });
  await app.register(digestRoutes, { prefix: '/api' });
  await app.register(searchRoutes, { prefix: '/api' });

  return app;
}

export async function startServer() {
  const app = await createServer();

  await app.listen({
    port: config.server.port,
    host: config.server.host,
  });

  console.log(`🚀 服务已启动: http://localhost:${config.server.port}`);
  return app;
}
