import { eq, isNull } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getDb, saveDatabaseSync } from '../db';
import { articles, analyses, type NewAnalysis } from '../db/schema';
import { llmClient } from './llm-client';
import {
  ARTICLE_ANALYSIS_SYSTEM,
  buildArticleAnalysisPrompt,
} from './prompts';
import { config } from '../config';

interface AnalysisResult {
  summary: string;
  topics: string[];
  keyPoints: string[];
  keyData: string[];
  importanceScore: number;
}

async function pLimit<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<T[]> {
  const results: T[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < tasks.length) {
      const current = index++;
      results[current] = await tasks[current]();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

export async function analyzeArticle(articleId: string): Promise<void> {
  const db = getDb();

  const rows = await db.select().from(articles).where(eq(articles.id, articleId)).limit(1);
  const article = rows[0];

  if (!article) {
    throw new Error('Article not found: ' + articleId);
  }

  if (!article.content) {
    console.warn('Article content empty, skip: ' + article.title);
    return;
  }

  const prompt = buildArticleAnalysisPrompt(article.title, article.content);

  try {
    const rawResponse = await llmClient.chat(ARTICLE_ANALYSIS_SYSTEM, prompt);
    const result = llmClient.parseJSON<AnalysisResult>(rawResponse);

    const newAnalysis: NewAnalysis = {
      id: uuidv4(),
      articleId: article.id,
      summary: result.summary || '',
      topics: JSON.stringify(result.topics || []),
      keyPoints: JSON.stringify(result.keyPoints || []),
      keyData: JSON.stringify(result.keyData || []),
      importanceScore: result.importanceScore ?? 5,
      rawResponse,
      analyzedAt: new Date().toISOString(),
    };

    await db.insert(analyses).values(newAnalysis);
    saveDatabaseSync();
    console.log('Analysis done: ' + article.title);
  } catch (err) {
    console.error('Analysis failed: ' + article.title, err);
    try {
      await db.insert(analyses).values({
        id: uuidv4(),
        articleId: article.id,
        summary: 'Analysis failed',
        topics: '[]',
        keyPoints: '[]',
        keyData: '[]',
        importanceScore: 0,
        rawResponse: String(err),
        analyzedAt: new Date().toISOString(),
      });
      saveDatabaseSync();
    } catch {
      // ignore conflict
    }
  }
}

export async function analyzeUnprocessedArticles(): Promise<{
  total: number;
  success: number;
  failed: number;
}> {
  const db = getDb();

  const unanalyzed = await db
    .select({ id: articles.id, title: articles.title })
    .from(articles)
    .leftJoin(analyses, eq(articles.id, analyses.articleId))
    .where(isNull(analyses.id));

  if (unanalyzed.length === 0) {
    console.log('No articles to analyze');
    return { total: 0, success: 0, failed: 0 };
  }

  console.log('Analyzing ' + unanalyzed.length + ' articles, concurrency: ' + config.llm.concurrency);

  let success = 0;
  let failed = 0;

  const tasks = unanalyzed.map((a) => async () => {
    try {
      await analyzeArticle(a.id);
      success++;
    } catch {
      failed++;
    }
  });

  await pLimit(tasks, config.llm.concurrency);

  console.log('Analysis complete: success=' + success + ' failed=' + failed);
  return { total: unanalyzed.length, success, failed };
}
