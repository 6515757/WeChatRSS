import nodemailer from 'nodemailer';
import { eq, gte, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getDb, saveDatabaseSync } from '../db';
import { articles, analyses, feeds, emailDigests, type NewEmailDigest } from '../db/schema';
import { config } from '../config';
import { buildEmailHtml } from './template';
import { getWxSessionStatus } from '../sources/wemp-status';

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
  articleId: string;
  title: string;
  url: string;
  feedName: string;
  summary: string;
  topics: string[];
  keyPoints: string[];
  keyData: string[];
  importanceScore: number;
}

async function queryAnalyzedArticles(since?: string): Promise<ArticleWithAnalysis[]> {
  const db = getDb();

  const base = db
    .select({
      articleId: articles.id,
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
    .innerJoin(feeds, eq(articles.feedId, feeds.id));

  const rows = since
    ? await base.where(gte(analyses.analyzedAt, since)).orderBy(desc(analyses.importanceScore))
    : await base.orderBy(desc(analyses.importanceScore));

  return rows.map((r) => ({
    articleId: r.articleId,
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

function groupByFeed(list: ArticleWithAnalysis[]) {
  const map = new Map<string, ArticleWithAnalysis[]>();
  for (const a of list) {
    const bucket = map.get(a.feedName) || [];
    bucket.push(a);
    map.set(a.feedName, bucket);
  }
  return Array.from(map.entries()).map(([feedName, arts]) => ({ feedName, articles: arts }));
}

// 「有意义的」分析：排除 Content unavailable / Analysis failed 的占位记录
function onlyMeaningful(list: ArticleWithAnalysis[]): ArticleWithAnalysis[] {
  return list.filter((a) => a.summary && a.summary !== 'Content unavailable' && a.summary !== 'Analysis failed');
}

async function sendAndArchive(options: {
  articleList: ArticleWithAnalysis[];
  dateStr: string;
}): Promise<void> {
  const { articleList, dateStr } = options;

  if (articleList.length === 0) {
    console.log('[Mailer] 无可发送内容');
    return;
  }

  const feedGroups = groupByFeed(articleList);
  let html = buildEmailHtml(dateStr, articleList.length, feedGroups.length, feedGroups);

  // 检查微信 session，快过期时在邮件顶部加警告
  try {
    const wxStatus = await getWxSessionStatus();
    if (wxStatus.remainingSeconds > 0 && wxStatus.remainingSeconds < 2 * 86400) {
      const warnHtml = `<div style="background:#ff4d4d;color:#fff;padding:12px 20px;font-size:14px;font-weight:600;text-align:center;border-radius:8px;margin:16px 20px 0;">⚠️ 微信登录 session 将在 ${wxStatus.remainingDays > 0 ? wxStatus.remainingDays + ' 天' : '数小时'}后过期（${wxStatus.expiryTime || ''}），请尽快去 <a href="https://rss.mustardnet.xyz" style="color:#fff;text-decoration:underline;">公众号管理</a> 重新扫码授权！</div>`;
      // 插入到 <!-- Content --> 之前
      html = html.replace('<!-- Content -->', warnHtml + '\n  <!-- Content -->');
      // 如果模板里没有 <!-- Content --> 注释，就插到 body 开头
      if (!html.includes(warnHtml)) {
        html = html.replace('<body', '<body').replace('</body>', warnHtml + '</body>');
      }
    }
  } catch (err) {
    // 查不到就不加，不影响发邮件
    console.warn('[Mailer] 检查微信 session 状态失败:', err);
  }

  const subject = `微信公众号每日摘要 - ${dateStr} (${articleList.length}篇)`;

  await transporter.sendMail({
    from: `"WeChatRSS" <${config.mail.user}>`,
    to: config.mail.to,
    subject,
    html,
  });
  console.log('[Mailer] Email sent to ' + config.mail.to);

  // 归档：发送成功后落一条
  try {
    const db = getDb();
    const digest: NewEmailDigest = {
      id: uuidv4(),
      subject,
      html,
      recipient: config.mail.to,
      articleCount: articleList.length,
      feedCount: feedGroups.length,
      articleIds: JSON.stringify(articleList.map((a) => a.articleId)),
      sentAt: new Date().toISOString(),
    };
    await db.insert(emailDigests).values(digest);
    saveDatabaseSync();
  } catch (err) {
    // 归档失败不影响已发送的结果
    console.error('[Mailer] 归档失败（邮件已发送）:', err);
  }
}

export async function sendDailyEmail(): Promise<void> {
  // Get today's analyzed articles
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const since = today.toISOString();

  const articleList = onlyMeaningful(await queryAnalyzedArticles(since));

  if (articleList.length === 0) {
    console.log('[Mailer] No articles to send today');
    return;
  }

  const dateStr = today.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  await sendAndArchive({ articleList, dateStr });
}

// Send email for all analyzed articles (not just today)
export async function sendAllAnalyzedEmail(): Promise<void> {
  const articleList = onlyMeaningful(await queryAnalyzedArticles());

  if (articleList.length === 0) {
    console.log('[Mailer] No analyzed articles');
    return;
  }

  const dateStr = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  await sendAndArchive({ articleList, dateStr });
}
