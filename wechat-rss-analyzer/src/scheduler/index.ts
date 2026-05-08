import cron from 'node-cron';
import { config } from '../config';
import { fetchAllFeeds } from '../fetcher';
import { analyzeUnprocessedArticles } from '../analyzer/analyzer';
import { sendDailyEmail } from '../mailer';
import { refreshAllMps, syncFeedsFromWeMpRss } from '../sources/wemp-refresh';

export function startScheduler(): void {
  // 1. 触发 we-mp-rss 刷新文章（8:30）
  cron.schedule(config.cron.refreshRss, async () => {
    console.log('[Scheduler] Refresh RSS started ' + new Date().toISOString());
    try {
      await refreshAllMps();
    } catch (err) {
      console.error('[Scheduler] Refresh RSS failed:', err);
    }
  });

  // 2. 从 RSS 拉取文章到本地（8:55）
  cron.schedule(config.cron.fetch, async () => {
    console.log('[Scheduler] Fetch started ' + new Date().toISOString());
    try {
      // 先同步订阅源
      await syncFeedsFromWeMpRss();
      await fetchAllFeeds();
    } catch (err) {
      console.error('[Scheduler] Fetch failed:', err);
    }
  });

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
  });

  // 4. 补漏抓取（10:00）：对于首次 fetch 时 we-mp-rss 尚未补全正文的文章，
  //    此时 content:encoded 通常已就绪，fetcher 会自动回填 content；
  //    fetch 后再跑一次 analyze，处理因正文过短跳过的文章。
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
  });

  console.log('Scheduler started:');
  console.log('  Refresh:          ' + config.cron.refreshRss);
  console.log('  Fetch:            ' + config.cron.fetch);
  console.log('  Analyze + Email:  ' + config.cron.analyze);
  console.log('  Backfill (fetch+analyze): ' + config.cron.fetchBackfill);
}
