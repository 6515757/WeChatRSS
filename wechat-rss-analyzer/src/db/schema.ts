import { sqliteTable, text, real, integer } from 'drizzle-orm/sqlite-core';

// 订阅源表
export const feeds = sqliteTable('feeds', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  sourceType: text('source_type').notNull().default('generic'), // wewe-rss | we-mp-rss | generic
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastFetchedAt: text('last_fetched_at'),
  titleFilter: text('title_filter'), // 标题过滤正则，为空则不过滤
  createdAt: text('created_at').notNull(),
});

// 文章表
export const articles = sqliteTable('articles', {
  id: text('id').primaryKey(),
  feedId: text('feed_id')
    .notNull()
    .references(() => feeds.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  url: text('url').notNull().unique(),
  content: text('content'),
  author: text('author'),
  publishedAt: text('published_at'),
  fetchedAt: text('fetched_at').notNull(),
});

// 分析结果表
export const analyses = sqliteTable('analyses', {
  id: text('id').primaryKey(),
  articleId: text('article_id')
    .notNull()
    .unique()
    .references(() => articles.id, { onDelete: 'cascade' }),
  summary: text('summary'),
  topics: text('topics'), // JSON 数组
  keyPoints: text('key_points'), // JSON 数组
  keyData: text('key_data'), // JSON 数组 - 关键数据
  importanceScore: real('importance_score'), // 0-10
  rawResponse: text('raw_response'),
  analyzedAt: text('analyzed_at').notNull(),
});

// 报告表
export const reports = sqliteTable('reports', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  type: text('type').notNull(), // daily | weekly | monthly
  content: text('content').notNull(), // Markdown 格式
  periodStart: text('period_start').notNull(),
  periodEnd: text('period_end').notNull(),
  createdAt: text('created_at').notNull(),
});

// 类型导出
export type Feed = typeof feeds.$inferSelect;
export type NewFeed = typeof feeds.$inferInsert;
export type Article = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;
export type Analysis = typeof analyses.$inferSelect;
export type NewAnalysis = typeof analyses.$inferInsert;
export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
