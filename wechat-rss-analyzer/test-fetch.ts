import { initDatabase, getDb, saveDatabase } from './src/db';
import { config } from './src/config';
import { WeMpRssSource } from './src/sources/wemp-rss-source';
import { feeds, articles } from './src/db/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

async function test() {
  await initDatabase();
  
  // Run migrations
  const { runMigrations } = await import('./src/db/migrate');
  await runMigrations();
  
  const db = getDb();
  
  // Check current state
  const allFeeds = await db.select().from(feeds);
  console.log('Feeds in DB:', allFeeds.length);
  
  const allArticles = await db.select().from(articles);
  console.log('Articles in DB:', allArticles.length);
  
  // Fetch RSS
  const source = new WeMpRssSource();
  const feedUrl = 'http://localhost:8001/rss/MP_WXS_3541901739';
  console.log('\nFetching RSS from:', feedUrl);
  
  const rawArticles = await source.fetchArticles(feedUrl);
  console.log('Parsed articles:', rawArticles.length);
  
  for (let i = 0; i < Math.min(3, rawArticles.length); i++) {
    const a = rawArticles[i];
    console.log(`\n  [${i}] title: ${a.title}`);
    console.log(`      url: ${a.url}`);
    console.log(`      content length: ${a.content?.length || 0}`);
    console.log(`      publishedAt: ${a.publishedAt}`);
  }
  
  // Try inserting
  if (rawArticles.length > 0 && rawArticles[0].url) {
    const feedId = allFeeds[0]?.id;
    if (feedId) {
      console.log('\nTrying to insert first article...');
      try {
        const existing = await db.query.articles.findFirst({
          where: eq(articles.url, rawArticles[0].url),
        });
        console.log('Existing:', existing ? 'YES' : 'NO');
        
        if (!existing) {
          await db.insert(articles).values({
            id: uuidv4(),
            feedId,
            title: rawArticles[0].title,
            url: rawArticles[0].url,
            content: rawArticles[0].content || null,
            author: rawArticles[0].author || null,
            publishedAt: rawArticles[0].publishedAt || null,
            fetchedAt: new Date().toISOString(),
          });
          saveDatabase();
          console.log('Insert SUCCESS');
          
          const count = await db.select().from(articles);
          console.log('Articles after insert:', count.length);
        }
      } catch (err) {
        console.error('Insert FAILED:', err);
      }
    }
  }
}

test().catch(console.error);
