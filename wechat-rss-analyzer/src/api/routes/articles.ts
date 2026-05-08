import { FastifyInstance } from 'fastify';
import { eq, desc, like, and, sql } from 'drizzle-orm';
import { getDb } from '../../db';
import { articles, analyses, feeds } from '../../db/schema';

export async function articleRoutes(app: FastifyInstance): Promise<void> {
  // 文章列表（分页 + 筛选）
  app.get<{
    Querystring: {
      page?: string;
      pageSize?: string;
      feedId?: string;
      keyword?: string;
    };
  }>('/articles', async (req) => {
    const page = parseInt(req.query.page || '1', 10);
    const pageSize = Math.min(parseInt(req.query.pageSize || '20', 10), 100);
    const offset = (page - 1) * pageSize;

    const db = getDb();
    const conditions = [];
    if (req.query.feedId) {
      conditions.push(eq(articles.feedId, req.query.feedId));
    }
    if (req.query.keyword) {
      conditions.push(like(articles.title, `%${req.query.keyword}%`));
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db
      .select({
        id: articles.id,
        title: articles.title,
        url: articles.url,
        author: articles.author,
        publishedAt: articles.publishedAt,
        fetchedAt: articles.fetchedAt,
        feedId: articles.feedId,
        feedName: feeds.name,
        hasAnalysis: analyses.id,
        importanceScore: analyses.importanceScore,
        summary: analyses.summary,
      })
      .from(articles)
      .leftJoin(analyses, eq(articles.id, analyses.articleId))
      .innerJoin(feeds, eq(articles.feedId, feeds.id))
      .where(whereClause)
      .orderBy(desc(articles.fetchedAt))
      .limit(pageSize)
      .offset(offset);

    const totalRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(articles)
      .innerJoin(feeds, eq(articles.feedId, feeds.id))
      .where(whereClause);
    const total = Number(totalRows[0]?.count ?? 0);

    return {
      page,
      pageSize,
      total,
      data: rows.map((r) => ({
        ...r,
        hasAnalysis: !!r.hasAnalysis,
      })),
    };
  });

  // 文章详情（含分析结果）
  app.get<{ Params: { id: string } }>('/articles/:id', async (req, reply) => {
    const db = getDb();

    const articleRows = await db
      .select()
      .from(articles)
      .where(eq(articles.id, req.params.id))
      .limit(1);
    const article = articleRows[0];

    if (!article) return reply.status(404).send({ error: '文章不存在' });

    const analysisRows = await db
      .select()
      .from(analyses)
      .where(eq(analyses.articleId, article.id))
      .limit(1);
    const analysis = analysisRows[0];

    const feedRows = await db
      .select()
      .from(feeds)
      .where(eq(feeds.id, article.feedId))
      .limit(1);
    const feed = feedRows[0];

    return {
      ...article,
      feedName: feed?.name,
      analysis: analysis
        ? {
            ...analysis,
            topics: JSON.parse(analysis.topics || '[]'),
            keyPoints: JSON.parse(analysis.keyPoints || '[]'),
            keyData: JSON.parse(analysis.keyData || '[]'),
          }
        : null,
    };
  });
}
