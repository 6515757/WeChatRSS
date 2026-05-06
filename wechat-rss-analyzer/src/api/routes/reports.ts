import { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { getDb } from '../../db';
import { reports } from '../../db/schema';
import { generateReport } from '../../reporter/reporter';

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  // 报告列表
  app.get('/reports', async () => {
    const db = getDb();
    return db.query.reports.findMany({
      orderBy: (r, { desc }) => [desc(r.createdAt)],
      columns: {
        id: true,
        title: true,
        type: true,
        periodStart: true,
        periodEnd: true,
        createdAt: true,
      },
    });
  });

  // 报告详情
  app.get<{ Params: { id: string } }>('/reports/:id', async (req, reply) => {
    const db = getDb();
    const report = await db.query.reports.findFirst({
      where: eq(reports.id, req.params.id),
    });
    if (!report) return reply.status(404).send({ error: '报告不存在' });
    return report;
  });

  // 手动生成报告
  app.post<{
    Body: {
      type: 'daily' | 'weekly' | 'monthly';
      periodStart?: string;
      periodEnd?: string;
    };
  }>('/reports/generate', async (req, reply) => {
    const { type, periodStart, periodEnd } = req.body;

    if (!['daily', 'weekly', 'monthly'].includes(type)) {
      return reply.status(400).send({ error: 'type 必须是 daily/weekly/monthly' });
    }

    const content = await generateReport(type, periodStart, periodEnd);
    return { success: true, content };
  });
}
