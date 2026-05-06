import { eq, gte, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getDb, saveDatabaseSync } from '../db';
import { articles, analyses, feeds, reports, type NewReport } from '../db/schema';
import { llmClient } from '../analyzer/llm-client';
import { REPORT_GENERATION_SYSTEM, buildReportPrompt } from '../analyzer/prompts';

type ReportType = 'daily' | 'weekly' | 'monthly';

function getPeriod(type: ReportType): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString();

  let start: Date;
  if (type === 'daily') {
    start = new Date(now);
    start.setHours(0, 0, 0, 0);
  } else if (type === 'weekly') {
    start = new Date(now);
    start.setDate(now.getDate() - 7);
  } else {
    start = new Date(now);
    start.setMonth(now.getMonth() - 1);
  }

  return { start: start.toISOString(), end };
}

export async function generateReport(
  type: ReportType,
  periodStart?: string,
  periodEnd?: string
): Promise<string> {
  const db = getDb();

  const period = {
    start: periodStart || getPeriod(type).start,
    end: periodEnd || getPeriod(type).end,
  };

  const rows = await db
    .select({
      title: articles.title,
      url: articles.url,
      publishedAt: articles.publishedAt,
      feedName: feeds.name,
      summary: analyses.summary,
      topics: analyses.topics,
      keyPoints: analyses.keyPoints,
      importanceScore: analyses.importanceScore,
    })
    .from(analyses)
    .innerJoin(articles, eq(analyses.articleId, articles.id))
    .innerJoin(feeds, eq(articles.feedId, feeds.id))
    .where(gte(articles.fetchedAt, period.start))
    .orderBy(desc(analyses.importanceScore));

  if (rows.length === 0) {
    const emptyReport = `# ${type === 'daily' ? '日报' : type === 'weekly' ? '周报' : '月报'}\n\n> 本期暂无内容`;
    return emptyReport;
  }

  const articleData = rows.map((r) => ({
    title: r.title,
    feedName: r.feedName,
    summary: r.summary || '',
    topics: JSON.parse(r.topics || '[]') as string[],
    keyPoints: JSON.parse(r.keyPoints || '[]') as string[],
    importanceScore: r.importanceScore || 0,
    publishedAt: r.publishedAt || '',
  }));

  const prompt = buildReportPrompt(type, period.start, period.end, articleData);
  const content = await llmClient.chat(REPORT_GENERATION_SYSTEM, prompt, {
    maxTokens: 4096,
    temperature: 0.5,
  });

  const typeLabel = { daily: '日报', weekly: '周报', monthly: '月报' }[type];
  const title = `微信公众号${typeLabel} ${new Date().toLocaleDateString('zh-CN')}`;

  const newReport: NewReport = {
    id: uuidv4(),
    title,
    type,
    content,
    periodStart: period.start,
    periodEnd: period.end,
    createdAt: new Date().toISOString(),
  };

  await db.insert(reports).values(newReport);
  saveDatabaseSync();
  console.log(`报告生成完成: ${title}`);

  return content;
}
