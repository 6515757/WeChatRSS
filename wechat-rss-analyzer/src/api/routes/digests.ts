import { FastifyInstance } from 'fastify';
import { eq, desc, sql } from 'drizzle-orm';
import { getDb } from '../../db';
import { emailDigests } from '../../db/schema';

export async function digestRoutes(app: FastifyInstance): Promise<void> {
  // 列表：分页，按发送时间倒序。不带 html 字段以减小响应体积
  app.get<{ Querystring: { page?: string; pageSize?: string } }>('/digests', async (req) => {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = Math.min(parseInt(req.query.pageSize || '20', 10), 100);
    const offset = (page - 1) * pageSize;

    const db = getDb();
    const rows = await db
      .select({
        id: emailDigests.id,
        subject: emailDigests.subject,
        recipient: emailDigests.recipient,
        articleCount: emailDigests.articleCount,
        feedCount: emailDigests.feedCount,
        sentAt: emailDigests.sentAt,
      })
      .from(emailDigests)
      .orderBy(desc(emailDigests.sentAt))
      .limit(pageSize)
      .offset(offset);

    const totalRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(emailDigests);
    const total = Number(totalRows[0]?.count ?? 0);

    return { page, pageSize, total, data: rows };
  });

  // 详情（JSON，不含 html，避免前端渲染期间样式污染）
  app.get<{ Params: { id: string } }>('/digests/:id', async (req, reply) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(emailDigests)
      .where(eq(emailDigests.id, req.params.id))
      .limit(1);
    const row = rows[0];
    if (!row) return reply.status(404).send({ error: '邮件归档不存在' });
    const { html, articleIds, ...rest } = row;
    return {
      ...rest,
      articleIds: JSON.parse(articleIds || '[]'),
      hasHtml: !!html,
    };
  });

  // 直接返回邮件 HTML，用于 iframe 渲染
  app.get<{ Params: { id: string } }>('/digests/:id/html', async (req, reply) => {
    const db = getDb();
    const rows = await db
      .select({ html: emailDigests.html })
      .from(emailDigests)
      .where(eq(emailDigests.id, req.params.id))
      .limit(1);
    const row = rows[0];
    if (!row) return reply.status(404).send('not found');
    reply.header('Content-Type', 'text/html; charset=utf-8');
    // 防止被当成站内资源缓存
    reply.header('Cache-Control', 'no-store');
    return row.html;
  });
}
