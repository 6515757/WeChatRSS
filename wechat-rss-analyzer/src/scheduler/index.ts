import cron from 'node-cron';
import { config } from '../config';
import { fetchAllFeeds } from '../fetcher';
import { analyzeUnprocessedArticles } from '../analyzer/analyzer';
import { sendDailyEmail } from '../mailer';
import { refreshAllMps, syncFeedsFromWeMpRss } from '../sources/wemp-refresh';

export function startScheduler(): void {
  // 强制使用上海时区，避免容器 TZ 未就绪时 cron 按 UTC 触发
  const cronOpts = { timezone: 'Asia/Shanghai' } as const;

  // 1. 触发 we-mp-rss 刷新文章（8:30）
  cron.schedule(config.cron.refreshRss, async () => {
    console.log('[Scheduler] Refresh RSS started ' + new Date().toISOString());
    try {
      await refreshAllMps();
    } catch (err) {
      console.error('[Scheduler] Refresh RSS failed:', err);
    }
  }, cronOpts);

  // 2. 从 RSS 拉取文章到本地（8:55）
  cron.schedule(config.cron.fetch, async () => {
    console.log('[Scheduler] Fetch started ' + new Date().toISOString());
    try {
      await syncFeedsFromWeMpRss();
      await fetchAllFeeds();
    } catch (err) {
      console.error('[Scheduler] Fetch failed:', err);
    }
  }, cronOpts);

  // 3. LLM 分析 + 发送邮件（9:00）
  cron.schedule(config.cron.analyze, async () => {
    console.log('[Scheduler] Analyze started ' + new Date().toISOString());
    try {
      const result = await analyzeUnprocessedArticles();
      if (result.success > 0 && config.mail.user && config.mail.to) {
        console.log('[Scheduler] Sending daily email...');
        await sendDailyEmail();
      }
    } catch (err) {
      console.error('[Scheduler] Analyze/email failed:', err);
    }
  }, cronOpts);

  // 4. 补漏抓取（10:00）
  cron.schedule(config.cron.fetchBackfill, async () => {
    console.log('[Scheduler] Backfill fetch started ' + new Date().toISOString());
    try {
      await fetchAllFeeds();
      const result = await analyzeUnprocessedArticles();
      if (result.success > 0 && config.mail.user && config.mail.to) {
        console.log('[Scheduler] Sending email for backfilled articles...');
        await sendDailyEmail();
      }
    } catch (err) {
      console.error('[Scheduler] Backfill failed:', err);
    }
  }, cronOpts);

  console.log('Scheduler started (TZ=Asia/Shanghai):');
  console.log('  Refresh:          ' + config.cron.refreshRss);
  console.log('  Fetch:            ' + config.cron.fetch);
  console.log('  Analyze + Email:  ' + config.cron.analyze);
  console.log('  Backfill (fetch+analyze): ' + config.cron.fetchBackfill);
}
