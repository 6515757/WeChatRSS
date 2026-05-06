import * as dotenv from 'dotenv';

dotenv.config();

export const config = {
  db: {
    path: process.env.DATABASE_PATH || './data/wechat-rss.db',
  },
  llm: {
    apiKey: process.env.LLM_API_KEY || '',
    baseURL: process.env.LLM_BASE_URL || 'https://api.ikuncode.cc/v1',
    model: process.env.LLM_MODEL || 'claude-sonnet-4-6',
    concurrency: parseInt(process.env.LLM_CONCURRENCY || '3', 10),
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
  },
  cron: {
    fetch: process.env.FETCH_CRON || '0 8,18 * * *',
    analyze: process.env.ANALYZE_CRON || '30 8,18 * * *',
    dailyReport: process.env.DAILY_REPORT_CRON || '0 20 * * *',
  },
  weMpRss: {
    url: process.env.WE_MP_RSS_URL || 'http://localhost:8001',
  },
  mail: {
    host: process.env.MAIL_HOST || 'smtp.qq.com',
    port: parseInt(process.env.MAIL_PORT || '465', 10),
    secure: process.env.MAIL_SECURE !== 'false',
    user: process.env.MAIL_USER || '',
    pass: process.env.MAIL_PASS || '',
    to: process.env.MAIL_TO || '',
  },
} as const;

export function validateConfig(): void {
  if (!config.llm.apiKey) {
    throw new Error('LLM_API_KEY is not set');
  }
}
