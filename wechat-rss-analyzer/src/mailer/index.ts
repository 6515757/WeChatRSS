import nodemailer from 'nodemailer';
import { eq, gte, desc } from 'drizzle-orm';
import { getDb } from '../db';
import { articles, analyses, feeds } from '../db/schema';
import { config } from '../config';
import { buildEmailHtml } from './template';

const transporter = nodemailer.createTransport({
  host: config.mail.host,
  port: config.mail.port,
  secure: config.mail.secure,
  auth: {
    user: config.mail.user,
    pass: config.mail.pass,
  },
});

interface ArticleWithAnalysis {
  title: string;
  url: string;
  feedName: string;
  summary: string;
  topics: string[];
  keyPoints: string[];
  keyData: string[];
  importanceScore: number;
}

async function getAnalyzedArticles(since: string): Promise<ArticleWithAnalysis[]> {
  const db = getDb();

  const rows = await db
    .select({
      title: articles.title,
      url: articles.url,
      feedName: feeds.name,
      summary: analyses.summary,
      topics: analyses.topics,
      keyPoints: analyses.keyPoints,
      keyData: analyses.keyData,
      importanceScore: analyses.importanceScore,
    })
    .from(analyses)
    .innerJoin(articles, eq(analyses.articleId, articles.id))
    .innerJoin(feeds, eq(articles.feedId, feeds.id))
    .where(gte(analyses.analyzedAt, since))
    .orderBy(desc(analyses.importanceScore));

  return rows.map((r) => ({
    title: r.title,
    url: r.url,
    feedName: r.feedName,
    summary: r.summary || '',
    topics: JSON.parse(r.topics || '[]'),
    keyPoints: JSON.parse(r.keyPoints || '[]'),
    keyData: JSON.parse(r.keyData || '[]'),
    importanceScore: r.importanceScore || 0,
  }));
}

export async function sendDailyEmail(): Promise<void> {
  // Get today's analyzed articles
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const since = today.toISOString();

  const articleList = await getAnalyzedArticles(since);

  if (articleList.length === 0) {
    console.log('[Mailer] No articles to send today');
    return;
  }

  // Group by feed
  const groupMap = new Map<string, ArticleWithAnalysis[]>();
  for (const a of articleList) {
    const list = groupMap.get(a.feedName) || [];
    list.push(a);
    groupMap.set(a.feedName, list);
  }

  const feedGroups = Array.from(groupMap.entries()).map(([feedName, arts]) => ({
    feedName,
    articles: arts,
  }));

  const dateStr = today.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const html = buildEmailHtml(
    dateStr,
    articleList.length,
    feedGroups.length,
    feedGroups
  );

  const subject = `微信公众号每日摘要 - ${dateStr} (${articleList.length}篇)`;

  try {
    await transporter.sendMail({
      from: `"WeChatRSS" <${config.mail.user}>`,
      to: config.mail.to,
      subject,
      html,
    });
    console.log('[Mailer] Email sent to ' + config.mail.to);
  } catch (err) {
    console.error('[Mailer] Send failed:', err);
    throw err;
  }
}

// Send email for all analyzed articles (not just today)
export async function sendAllAnalyzedEmail(): Promise<void> {
  const db = getDb();

  const rows = await db
    .select({
      title: articles.title,
      url: articles.url,
      feedName: feeds.name,
      summary: analyses.summary,
      topics: analyses.topics,
      keyPoints: analyses.keyPoints,
      keyData: analyses.keyData,
      importanceScore: analyses.importanceScore,
    })
    .from(analyses)
    .innerJoin(articles, eq(analyses.articleId, articles.id))
    .innerJoin(feeds, eq(articles.feedId, feeds.id))
    .orderBy(desc(analyses.importanceScore));

  const articleList: ArticleWithAnalysis[] = rows.map((r) => ({
    title: r.title,
    url: r.url,
    feedName: r.feedName,
    summary: r.summary || '',
    topics: JSON.parse(r.topics || '[]'),
    keyPoints: JSON.parse(r.keyPoints || '[]'),
    keyData: JSON.parse(r.keyData || '[]'),
    importanceScore: r.importanceScore || 0,
  }));

  if (articleList.length === 0) {
    console.log('[Mailer] No analyzed articles');
    return;
  }

  const groupMap = new Map<string, ArticleWithAnalysis[]>();
  for (const a of articleList) {
    const list = groupMap.get(a.feedName) || [];
    list.push(a);
    groupMap.set(a.feedName, list);
  }

  const feedGroups = Array.from(groupMap.entries()).map(([feedName, arts]) => ({
    feedName,
    articles: arts,
  }));

  const dateStr = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const html = buildEmailHtml(dateStr, articleList.length, feedGroups.length, feedGroups);
  const subject = `微信公众号每日摘要 - ${dateStr} (${articleList.length}篇)`;

  await transporter.sendMail({
    from: `"WeChatRSS" <${config.mail.user}>`,
    to: config.mail.to,
    subject,
    html,
  });
  console.log('[Mailer] Email sent to ' + config.mail.to);
}
