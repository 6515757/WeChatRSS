import cron from 'node-cron';
import { config } from '../config';
import { fetchAllFeeds } from '../fetcher';
import { analyzeUnprocessedArticles } from '../analyzer/analyzer';
import { generateReport } from '../reporter/reporter';
import { sendDailyEmail } from '../mailer';
import { refreshAllMps } from '../sources/wemp-refresh';

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

  // 2. 从 RSS 拉取文章到本地（8:35）
  cron.schedule(config.cron.fetch, async () => {
    console.log('[Scheduler] Fetch started ' + new Date().toISOString());
    try {
      await fetchAllFeeds();
    } catch (err) {
      console.error('[Scheduler] Fetch failed:', err);
    }
  });

  // 3. LLM 分析 + 发送邮件（8:40）
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

  // 4. 日报生成（20:00）
  cron.schedule(config.cron.dailyReport, async () => {
    console.log('[Scheduler] Report generation started ' + new Date().toISOString());
    try {
      await generateReport('daily');
    } catch (err) {
      console.error('[Scheduler] Report failed:', err);
    }
  });

  console.log('Scheduler started:');
  console.log('  Refresh: ' + config.cron.refreshRss);
  console.log('  Fetch:   ' + config.cron.fetch);
  console.log('  Analyze: ' + config.cron.analyze);
  console.log('  Report:  ' + config.cron.dailyReport);
}
