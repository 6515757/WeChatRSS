import { initDatabase, getDb, saveDatabaseSync } from './src/db';
import { runMigrations } from './src/db/migrate';
import { feeds, articles, analyses } from './src/db/schema';
import { fetchFeed } from './src/fetcher';
import { analyzeArticle } from './src/analyzer/analyzer';
import { sendAllAnalyzedEmail } from './src/mailer';
import { eq, isNull } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

async function main() {
  console.log('=== Pipeline Start ===\n');

  // 1. Init DB
  await initDatabase();
  await runMigrations();
  const db = getDb();

  // 2. Create feed with title filter (if not exists)
  const existingFeeds = await db.select().from(feeds);
  let feedId: string;

  if (existingFeeds.length === 0) {
    feedId = uuidv4();
    await db.insert(feeds).values({
      id: feedId,
      name: '\u4e2d\u91d1\u5b8f\u89c2', // 中金宏观
      url: 'http://localhost:8001/rss/MP_WXS_3541901739',
      sourceType: 'we-mp-rss',
      enabled: true,
      titleFilter: '\u4e2d\u91d1\u5b8f\u89c2 \\||\u4e2d\u91d1\uff1a|\u4e2d\u91d1:', // 中金宏观 ||中金：|中金:
      createdAt: new Date().toISOString(),
    });
    saveDatabaseSync();
    console.log('1. Feed created: ' + feedId);
  } else {
    feedId = existingFeeds[0].id;
    // Update title filter
    await db.update(feeds).set({
      name: '\u4e2d\u91d1\u5b8f\u89c2',
      titleFilter: '\u4e2d\u91d1\u5b8f\u89c2 \\||\u4e2d\u91d1\uff1a|\u4e2d\u91d1:',
    }).where(eq(feeds.id, feedId));
    saveDatabaseSync();
    console.log('1. Feed updated: ' + feedId);
  }

  // 3. Fetch articles
  console.log('\n2. Fetching articles...');
  const fetchResult = await fetchFeed(feedId);
  console.log('   Fetched: ' + fetchResult.fetched + ', New: ' + fetchResult.newArticles + ', Filtered: ' + fetchResult.filtered);

  // 4. Analyze unanalyzed articles
  const unanalyzed = await db
    .select({ id: articles.id, title: articles.title })
    .from(articles)
    .leftJoin(analyses, eq(articles.id, analyses.articleId))
    .where(isNull(analyses.id));

  console.log('\n3. Analyzing ' + unanalyzed.length + ' articles...');

  for (const a of unanalyzed) {
    try {
      await analyzeArticle(a.id);
    } catch (err) {
      console.error('   Failed: ' + a.title);
    }
  }

  // 5. Send email
  console.log('\n4. Sending email...');
  await sendAllAnalyzedEmail();

  console.log('\n=== Pipeline Complete ===');
}

main().catch((err) => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
