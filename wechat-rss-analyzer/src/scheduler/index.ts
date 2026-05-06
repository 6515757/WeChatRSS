import cron from 'node-cron';
import { config } from '../config';
import { fetchAllFeeds } from '../fetcher';
import { analyzeUnprocessedArticles } from '../analyzer/analyzer';
import { generateReport } from '../reporter/reporter';
import { sendDailyEmail } from '../mailer';

export function startScheduler(): void {
  // Fetch articles
  cron.schedule(config.cron.fetch, async () => {
    console.log('[Scheduler] Fetch started ' + new Date().toISOString());
    try {
      await fetchAllFeeds();
    } catch (err) {
      console.error('[Scheduler] Fetch failed:', err);
    }
  });

  // Analyze + send email
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

  // Daily report (markdown)
  cron.schedule(config.cron.dailyReport, async () => {
    console.log('[Scheduler] Report generation started ' + new Date().toISOString());
    try {
      await generateReport('daily');
    } catch (err) {
      console.error('[Scheduler] Report failed:', err);
    }
  });

  console.log('Scheduler started:');
  console.log('  Fetch:   ' + config.cron.fetch);
  console.log('  Analyze: ' + config.cron.analyze);
  console.log('  Report:  ' + config.cron.dailyReport);
}
