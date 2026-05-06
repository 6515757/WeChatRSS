import { initDatabase, getDb, saveDatabaseSync } from './src/db';
import { runMigrations } from './src/db/migrate';
import { WeMpRssSource } from './src/sources/wemp-rss-source';
import { feeds, articles } from './src/db/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

async function debug() {
  await initDatabase();
  await runMigrations();
  
  const db = getDb();
  
  // Create feed if not exists
  const existingFeeds = await db.select().from(feeds);
  let feedId: string;
  if (existingFeeds.length === 0) {
    feedId = uuidv4();
    await db.insert(feeds).values({
      id: feedId,
      name: 'zhongjinhongguan',
      url: 'http://localhost:8001/rss/MP_WXS_3541901739',
      sourceType: 'we-mp-rss',
      enabled: true,
      createdAt: new Date().toISOString(),
    });
    saveDatabaseSync();
    console.log('Created feed:', feedId);
  } else {
    feedId = existingFeeds[0].id;
    console.log('Using existing feed:', feedId);
  }
  
  // Parse RSS
  const source = new WeMpRssSource();
  const rawArticles = await source.fetchArticles('http://localhost:8001/rss/MP_WXS_3541901739');
  console.log('RSS parsed:', rawArticles.length, 'articles');
  
  // Insert articles using select-based dedup (not findFirst)
  let inserted = 0;
  for (const raw of rawArticles) {
    if (!raw.url) continue;
    
    const existingRows = await db
      .select({ id: articles.id })
      .from(articles)
      .where(eq(articles.url, raw.url))
      .limit(1);
    
    if (existingRows.length > 0) {
      console.log('  SKIP (exists):', raw.title.substring(0, 30));
      continue;
    }
    
    await db.insert(articles).values({
      id: uuidv4(),
      feedId,
      title: raw.title,
      url: raw.url,
      content: raw.content || null,
      author: raw.author || null,
      publishedAt: raw.publishedAt || null,
      fetchedAt: new Date().toISOString(),
    });
    inserted++;
    console.log('  INSERT:', raw.title.substring(0, 40));
  }
  
  saveDatabaseSync();
  
  const allArticles = await db.select().from(articles);
  console.log('\nTotal articles in DB:', allArticles.length, '(inserted:', inserted, ')');
}

debug().catch(console.error);
