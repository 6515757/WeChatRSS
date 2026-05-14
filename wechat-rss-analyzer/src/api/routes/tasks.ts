import { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { fetchAllFeeds, fetchFeed } from '../../fetcher';
import { analyzeUnprocessedArticles, analyzeArticle } from '../../analyzer/analyzer';
import { sendDailyEmail, sendAllAnalyzedEmail } from '../../mailer';
import { refreshAllMps, syncFeedsFromWeMpRss } from '../../sources/wemp-refresh';
import { getWxSessionStatus } from '../../sources/wemp-status';
import { getDb } from '../../db';
import { articles } from '../../db/schema';

// 一个文章算「正文齐」的阈值；跟 analyzer.ts 中的 MIN_CONTENT_LEN 保持一致
const MIN_CONTENT_LEN = 500;

// 查询「在 sinceIso 之后入库且 content < MIN_CONTENT_LEN」的文章数
async function countShortNewArticles(sinceIso: string): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(articles)
    .where(
      sql`${articles.fetchedAt} >= ${sinceIso} AND COALESCE(length(${articles.content}), 0) < ${MIN_CONTENT_LEN}`,
    );
  return Number(rows[0]?.count ?? 0);
}

interface PollFetchOptions {
  pipelineStartIso: string;
  maxWaitMs?: number;        // 硬上限，超了就不等
  intervalMs?: number;       // 每轮间隔
  noProgressRounds?: number; // 连续 N 轮「短文章数」没变化就认为源端到头了
}

/**
 * 轮询抓取直到所有新文章正文都足够长。
 * 返回累计 fetch 轮数 + 最终仍未齐的文章数。
 */
async function pollFetchUntilReady(opts: PollFetchOptions): Promise<{
  rounds: number;
  finalShort: number;
  totalNew: number;
  reason: 'all-ready' | 'no-progress' | 'timeout';
}> {
  const maxWait = opts.maxWaitMs ?? 8 * 60 * 1000; // 8 分钟
  const interval = opts.intervalMs ?? 30 * 1000;    // 30 秒
  const noProgressLimit = opts.noProgressRounds ?? 3;

  const startMs = Date.now();
  let rounds = 0;
  let totalNew = 0;
  let lastShort: number | null = null;
  let noProgressCount = 0;

  while (true) {
    rounds++;
    const result = await fetchAllFeeds();
    totalNew += result.newArticles;

    const short = await countShortNewArticles(opts.pipelineStartIso);
    console.log(
      `[Pipeline] fetch round ${rounds}: new=${result.newArticles}, 本轮后仍短的文章=${short}`,
    );

    if (short === 0) return { rounds, finalShort: 0, totalNew, reason: 'all-ready' };

    if (lastShort !== null && short === lastShort) noProgressCount++;
    else noProgressCount = 0;
    lastShort = short;

    if (noProgressCount >= noProgressLimit) {
      console.log(`[Pipeline] 连续 ${noProgressCount} 轮无进展，放弃等待`);
      return { rounds, finalShort: short, totalNew, reason: 'no-progress' };
    }

    if (Date.now() - startMs + interval > maxWait) {
      console.log('[Pipeline] 达到最大等待时长，停止轮询');
      return { rounds, finalShort: short, totalNew, reason: 'timeout' };
    }

    await new Promise((r) => setTimeout(r, interval));
  }
}

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

  // 微信 session 状态
  app.get('/tasks/wx-session', async () => {
    return await getWxSessionStatus();
  });

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
      const pipelineStartIso = new Date().toISOString();
      try {
        // Step 1: 刷新 we-mp-rss
        console.log('[Pipeline] Step 1: 刷新 we-mp-rss');
        const refreshResult = await refreshAllMps();
        result.steps.push({ step: 'refresh', ...refreshResult });

        // Step 2: 同步订阅源（一次就够，与正文无关）
        console.log('[Pipeline] Step 2: 同步订阅源');
        const syncResult = await syncFeedsFromWeMpRss();
        result.steps.push({ step: 'sync', ...syncResult });

        // Step 3: 轮询 fetch，直到全部新文章 content 达标、或无进展、或超时
        console.log('[Pipeline] Step 3: 轮询抓取直到正文齐');
        const pollRes = await pollFetchUntilReady({ pipelineStartIso });
        result.steps.push({
          step: 'fetch',
          newArticles: pollRes.totalNew,
          rounds: pollRes.rounds,
          stillShort: pollRes.finalShort,
          reason: pollRes.reason,
        });

        // Step 4: LLM 分析
        console.log('[Pipeline] Step 4: LLM 分析');
        const analyzeResult = await analyzeUnprocessedArticles();
        result.steps.push({ step: 'analyze', ...analyzeResult });

        // Step 5: 发送邮件（如果有新分析的文章）
        if (analyzeResult.success > 0) {
          console.log('[Pipeline] Step 5: 发送邮件');
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
