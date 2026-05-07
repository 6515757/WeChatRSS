import { FastifyInstance } from 'fastify';
import { fetchAllFeeds, fetchFeed } from '../../fetcher';
import { analyzeUnprocessedArticles, analyzeArticle } from '../../analyzer/analyzer';
import { sendDailyEmail, sendAllAnalyzedEmail } from '../../mailer';
import { refreshAllMps, syncFeedsFromWeMpRss } from '../../sources/wemp-refresh';

// 简单的任务状态追踪
const taskStatus = {
  refresh: { running: false, lastRun: null as string | null, lastResult: null as any },
  fetch: { running: false, lastRun: null as string | null, lastResult: null as any },
  analyze: { running: false, lastRun: null as string | null, lastResult: null as any },
  pipeline: { running: false, lastRun: null as string | null, lastResult: null as any },
};

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  // 查看任务状态
  app.get('/tasks/status', async () => taskStatus);

  // 手动触发 we-mp-rss 刷新
  app.post('/tasks/refresh', async (req, reply) => {
    if (taskStatus.refresh.running) {
      return reply.status(409).send({ error: '刷新任务正在运行中' });
    }

    taskStatus.refresh.running = true;
    taskStatus.refresh.lastRun = new Date().toISOString();

    refreshAllMps()
      .then((result) => { taskStatus.refresh.lastResult = result; })
      .catch((err) => { taskStatus.refresh.lastResult = { error: String(err) }; })
      .finally(() => { taskStatus.refresh.running = false; });

    return { success: true, message: 'we-mp-rss 刷新任务已启动' };
  });

  // 手动触发全量抓取
  app.post('/tasks/fetch', async (req, reply) => {
    if (taskStatus.fetch.running) {
      return reply.status(409).send({ error: '抓取任务正在运行中' });
    }

    taskStatus.fetch.running = true;
    taskStatus.fetch.lastRun = new Date().toISOString();

    fetchAllFeeds()
      .then((result) => { taskStatus.fetch.lastResult = result; })
      .catch((err) => { taskStatus.fetch.lastResult = { error: String(err) }; })
      .finally(() => { taskStatus.fetch.running = false; });

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
      .then((result) => { taskStatus.analyze.lastResult = result; })
      .catch((err) => { taskStatus.analyze.lastResult = { error: String(err) }; })
      .finally(() => { taskStatus.analyze.running = false; });

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

  // 一键执行完整流水线：刷新 → 抓取 → 分析 → 邮件
  app.post('/tasks/pipeline', async (req, reply) => {
    if (taskStatus.pipeline.running) {
      return reply.status(409).send({ error: '流水线正在运行中' });
    }

    taskStatus.pipeline.running = true;
    taskStatus.pipeline.lastRun = new Date().toISOString();

    (async () => {
      const result: any = { steps: [] };
      try {
        // Step 1: 刷新 we-mp-rss
        console.log('[Pipeline] Step 1: 刷新 we-mp-rss');
        const refreshResult = await refreshAllMps();
        result.steps.push({ step: 'refresh', ...refreshResult });

        // 等待 30 秒让 we-mp-rss 完成采集
        console.log('[Pipeline] 等待 30 秒...');
        await new Promise((r) => setTimeout(r, 30000));

        // Step 2: 同步订阅源
        console.log('[Pipeline] Step 2: 同步订阅源');
        const syncResult = await syncFeedsFromWeMpRss();
        result.steps.push({ step: 'sync', ...syncResult });

        // Step 3: 抓取到本地
        console.log('[Pipeline] Step 3: 抓取文章');
        const fetchResult = await fetchAllFeeds();
        result.steps.push({ step: 'fetch', ...fetchResult });

        // Step 3: LLM 分析
        console.log('[Pipeline] Step 3: LLM 分析');
        const analyzeResult = await analyzeUnprocessedArticles();
        result.steps.push({ step: 'analyze', ...analyzeResult });

        // Step 4: 发送邮件（如果有新分析的文章）
        if (analyzeResult.success > 0) {
          console.log('[Pipeline] Step 4: 发送邮件');
          await sendDailyEmail();
          result.steps.push({ step: 'email', sent: true });
        }

        result.success = true;
        console.log('[Pipeline] 完成');
      } catch (err) {
        result.success = false;
        result.error = String(err);
        console.error('[Pipeline] 失败:', err);
      }
      taskStatus.pipeline.lastResult = result;
    })().finally(() => {
      taskStatus.pipeline.running = false;
    });

    return { success: true, message: '完整流水线已启动（刷新→抓取→分析→邮件）' };
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
