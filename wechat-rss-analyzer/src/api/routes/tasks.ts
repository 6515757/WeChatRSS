import { FastifyInstance } from 'fastify';
import { fetchAllFeeds, fetchFeed } from '../../fetcher';
import { analyzeUnprocessedArticles, analyzeArticle } from '../../analyzer/analyzer';
import { sendDailyEmail, sendAllAnalyzedEmail } from '../../mailer';

// 简单的任务状态追踪
const taskStatus = {
  fetch: { running: false, lastRun: null as string | null, lastResult: null as any },
  analyze: { running: false, lastRun: null as string | null, lastResult: null as any },
};

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  // 查看任务状态
  app.get('/tasks/status', async () => taskStatus);

  // 手动触发全量抓取
  app.post('/tasks/fetch', async (req, reply) => {
    if (taskStatus.fetch.running) {
      return reply.status(409).send({ error: '抓取任务正在运行中' });
    }

    taskStatus.fetch.running = true;
    taskStatus.fetch.lastRun = new Date().toISOString();

    // 异步执行，不阻塞响应
    fetchAllFeeds()
      .then((result) => {
        taskStatus.fetch.lastResult = result;
      })
      .catch((err) => {
        taskStatus.fetch.lastResult = { error: String(err) };
      })
      .finally(() => {
        taskStatus.fetch.running = false;
      });

    return { success: true, message: '抓取任务已启动' };
  });

  // 手动触发单个订阅源抓取
  app.post<{ Params: { feedId: string } }>('/tasks/fetch/:feedId', async (req, reply) => {
    try {
      const result = await fetchFeed(req.params.feedId);
      return { success: true, ...result };
    } catch (err) {
      return reply.status(500).send({ error: String(err) });
    }
  });

  // 手动触发分析
  app.post('/tasks/analyze', async (req, reply) => {
    if (taskStatus.analyze.running) {
      return reply.status(409).send({ error: '分析任务正在运行中' });
    }

    taskStatus.analyze.running = true;
    taskStatus.analyze.lastRun = new Date().toISOString();

    analyzeUnprocessedArticles()
      .then((result) => {
        taskStatus.analyze.lastResult = result;
      })
      .catch((err) => {
        taskStatus.analyze.lastResult = { error: String(err) };
      })
      .finally(() => {
        taskStatus.analyze.running = false;
      });

    return { success: true, message: '分析任务已启动' };
  });

  // 手动触发单篇文章分析
  app.post<{ Params: { articleId: string } }>('/tasks/analyze/:articleId', async (req, reply) => {
    try {
      await analyzeArticle(req.params.articleId);
      return { success: true };
    } catch (err) {
      return reply.status(500).send({ error: String(err) });
    }
  });

  // 手动发送邮件（今日分析结果）
  app.post('/tasks/email', async (req, reply) => {
    try {
      await sendDailyEmail();
      return { success: true, message: 'Daily email sent' };
    } catch (err) {
      return reply.status(500).send({ error: String(err) });
    }
  });

  // 手动发送邮件（所有已分析文章）
  app.post('/tasks/email/all', async (req, reply) => {
    try {
      await sendAllAnalyzedEmail();
      return { success: true, message: 'Email sent with all analyzed articles' };
    } catch (err) {
      return reply.status(500).send({ error: String(err) });
    }
  });
}
