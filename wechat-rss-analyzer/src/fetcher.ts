import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getDb, saveDatabaseSync } from './db';
import { feeds, articles, type NewArticle } from './db/schema';
import { RssSource } from './sources/rss-source';
import { WeMpRssSource } from './sources/wemp-rss-source';
import { IArticleSource } from './sources/types';

const rssSource = new RssSource();
const weMpRssSource = new WeMpRssSource();

function getSource(sourceType: string): IArticleSource {
  if (sourceType === 'we-mp-rss') return weMpRssSource;
  return rssSource;
}

function matchesTitleFilter(title: string, filter: string | null): boolean {
  if (!filter) return true; // no filter = accept all
  try {
    const regex = new RegExp(filter);
    return regex.test(title);
  } catch {
    // fallback: simple includes check for each | separated pattern
    return filter.split('|').some((p) => title.includes(p.trim()));
  }
}

export async function fetchFeed(feedId: string): Promise<{
  fetched: number;
  newArticles: number;
  filtered: number;
}> {
  const db = getDb();

  const rows = await db.select().from(feeds).where(eq(feeds.id, feedId)).limit(1);
  const feed = rows[0];

  if (!feed) throw new Error('Feed not found: ' + feedId);
  if (!feed.enabled) return { fetched: 0, newArticles: 0, filtered: 0 };

  const source = getSource(feed.sourceType);
  console.log('[Fetcher] Fetching: ' + feed.name + ' (' + feed.url + ')');

  const rawArticles = await source.fetchArticles(feed.url);
  let newCount = 0;
  let filteredCount = 0;

  for (const raw of rawArticles) {
    if (!raw.url) continue;

    // Title filter
    if (!matchesTitleFilter(raw.title, feed.titleFilter)) {
      filteredCount++;
      continue;
    }

    // Dedup by URL
    const existingRows = await db
      .select({ id: articles.id })
      .from(articles)
      .where(eq(articles.url, raw.url))
      .limit(1);

    if (existingRows.length > 0) continue;

    const newArticle: NewArticle = {
      id: uuidv4(),
      feedId: feed.id,
      title: raw.title,
      url: raw.url,
      content: raw.content || null,
      author: raw.author || null,
      publishedAt: raw.publishedAt || null,
      fetchedAt: new Date().toISOString(),
    };

    await db.insert(articles).values(newArticle);
    newCount++;
  }

  await db
    .update(feeds)
    .set({ lastFetchedAt: new Date().toISOString() })
    .where(eq(feeds.id, feedId));

  saveDatabaseSync();

  console.log('[Fetcher] ' + feed.name + ': total=' + rawArticles.length + ' new=' + newCount + ' filtered=' + filteredCount);
  return { fetched: rawArticles.length, newArticles: newCount, filtered: filteredCount };
}

export async function fetchAllFeeds(): Promise<{
  total: number;
  newArticles: number;
}> {
  const db = getDb();

  const enabledFeeds = await db.select().from(feeds).where(eq(feeds.enabled, true));

  if (enabledFeeds.length === 0) {
    console.log('[Fetcher] No enabled feeds');
    return { total: 0, newArticles: 0 };
  }

  let totalNew = 0;
  for (const feed of enabledFeeds) {
    try {
      const result = await fetchFeed(feed.id);
      totalNew += result.newArticles;
    } catch (err) {
      console.error('[Fetcher] Failed: ' + feed.name, err);
    }
  }

  return { total: enabledFeeds.length, newArticles: totalNew };
}
