import { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getDb, saveDatabaseSync } from '../../db';
import { feeds, type NewFeed } from '../../db/schema';

export async function feedRoutes(app: FastifyInstance): Promise<void> {
  app.get('/feeds', async () => {
    const db = getDb();
    return db.select().from(feeds);
  });

  app.post<{
    Body: { name: string; url: string; sourceType?: string };
  }>('/feeds', async (req, reply) => {
    const { name, url, sourceType = 'generic' } = req.body;
    if (!name || !url) {
      return reply.status(400).send({ error: 'name and url required' });
    }

    const db = getDb();
    const newFeed: NewFeed = {
      id: uuidv4(),
      name,
      url,
      sourceType,
      enabled: true,
      createdAt: new Date().toISOString(),
    };

    await db.insert(feeds).values(newFeed);
    saveDatabaseSync();
    return reply.status(201).send(newFeed);
  });

  app.put<{
    Params: { id: string };
    Body: { name?: string; url?: string; enabled?: boolean; sourceType?: string };
  }>('/feeds/:id', async (req, reply) => {
    const { id } = req.params;
    const updates = req.body;

    const db = getDb();
    const rows = await db.select().from(feeds).where(eq(feeds.id, id)).limit(1);
    if (rows.length === 0) return reply.status(404).send({ error: 'feed not found' });

    await db.update(feeds).set(updates).where(eq(feeds.id, id));
    saveDatabaseSync();
    return { ...rows[0], ...updates };
  });

  app.delete<{ Params: { id: string } }>('/feeds/:id', async (req, reply) => {
    const { id } = req.params;
    const db = getDb();
    const rows = await db.select().from(feeds).where(eq(feeds.id, id)).limit(1);
    if (rows.length === 0) return reply.status(404).send({ error: 'feed not found' });

    await db.delete(feeds).where(eq(feeds.id, id));
    saveDatabaseSync();
    return { success: true };
  });
}
