import { FastifyInstance } from 'fastify';
import { eq, gte, and } from 'drizzle-orm';
import { getDb } from '../../db';
import { articles, analyses, feeds } from '../../db/schema';
import { llmClient } from '../../analyzer/llm-client';
import { SEARCH_SYSTEM, buildSearchPrompt } from '../../analyzer/prompts';

// 搜索结果缓存（进程内）：key = query|days，value = { at, result }
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { at: number; result: any }>();

// 传给 LLM 前的兜底预筛数量上限；超过就用简单的子串匹配挑出有关的候选
const MAX_CANDIDATES_FOR_LLM = 300;

interface Candidate {
  id: string;
  title: string;
  feedId: string;
  feedName: string;
  summary: string;
  topics: string[];
}

interface LlmHit {
  id: string;
  score: number;
  reason?: string;
}

interface LlmSearchResult {
  overview: string;
  hits: LlmHit[];
}

function prefilter(query: string, all: Candidate[]): Candidate[] {
  if (all.length <= MAX_CANDIDATES_FOR_LLM) return all;
  const q = query.trim().toLowerCase();
  if (!q) return all.slice(0, MAX_CANDIDATES_FOR_LLM);
  const scored = all.map((c) => {
    const hay = (c.title + ' ' + (c.topics || []).join(' ') + ' ' + c.summary).toLowerCase();
    let s = 0;
    if (hay.includes(q)) s += 3;
    // 单字命中，适合中文
    for (const ch of q) if (ch.trim() && hay.includes(ch)) s += 0.02;
    return { c, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, MAX_CANDIDATES_FOR_LLM).map((x) => x.c);
}

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  // 主题搜索：在一段时间范围内找"和主题相关"的文章
  app.post<{ Body: { query?: string; days?: number } }>('/search', async (req, reply) => {
    const query = (req.body?.query || '').trim();
    const days = Math.max(1, Math.min(90, Number(req.body?.days) || 30));
    if (!query) return reply.status(400).send({ error: '请输入搜索主题' });

    const cacheKey = query + '|' + days;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return { ...cached.result, cached: true };
    }

    const db = getDb();
    const sinceMs = Date.now() - days * 24 * 3600 * 1000;
    const sinceIso = new Date(sinceMs).toISOString();

    // 只取"有意义分析"的文章
    const rows = await db
      .select({
        id: articles.id,
        title: articles.title,
        url: articles.url,
        feedId: articles.feedId,
        feedName: feeds.name,
        publishedAt: articles.publishedAt,
        fetchedAt: articles.fetchedAt,
        importanceScore: analyses.importanceScore,
        summary: analyses.summary,
        topics: analyses.topics,
        keyPoints: analyses.keyPoints,
      })
      .from(analyses)
      .innerJoin(articles, eq(analyses.articleId, articles.id))
      .innerJoin(feeds, eq(articles.feedId, feeds.id))
      .where(and(gte(articles.fetchedAt, sinceIso)));

    // 过滤掉占位分析
    const valid = rows.filter((r) => r.summary && r.summary !== 'Content unavailable' && r.summary !== 'Analysis failed');

    if (valid.length === 0) {
      return { query, days, total: 0, overview: '这个时间范围内还没有可搜索的分析结果。', groups: [] };
    }

    const allCandidates: Candidate[] = valid.map((r) => ({
      id: r.id,
      title: r.title,
      feedId: r.feedId,
      feedName: r.feedName,
      summary: r.summary || '',
      topics: JSON.parse(r.topics || '[]'),
    }));

    const candidates = prefilter(query, allCandidates);

    // 喂 LLM
    const prompt = buildSearchPrompt(query, days, candidates.map((c) => ({
      id: c.id,
      title: c.title,
      feedName: c.feedName,
      summary: c.summary,
      topics: c.topics,
    })));

    let llmResult: LlmSearchResult;
    try {
      const raw = await llmClient.chat(SEARCH_SYSTEM, prompt, { maxTokens: 8000, temperature: 0.2 });
      llmResult = llmClient.parseJSON<LlmSearchResult>(raw);
    } catch (err) {
      return reply.status(500).send({ error: 'LLM 搜索失败: ' + (err as Error).message });
    }

    const hits = Array.isArray(llmResult.hits) ? llmResult.hits : [];
    const overview = typeof llmResult.overview === 'string' ? llmResult.overview : '';

    // 建立 id -> 详情映射（含完整文章 + feedName + score）
    const valueById = new Map(valid.map((r) => [r.id, r]));
    const mergedHits = hits
      .filter((h) => h && h.id && valueById.has(h.id))
      .map((h) => {
        const r = valueById.get(h.id)!;
        return {
          id: r.id,
          title: r.title,
          url: r.url,
          feedId: r.feedId,
          feedName: r.feedName,
          publishedAt: r.publishedAt,
          fetchedAt: r.fetchedAt,
          importanceScore: r.importanceScore,
          summary: r.summary,
          topics: JSON.parse(r.topics || '[]'),
          keyPoints: JSON.parse(r.keyPoints || '[]'),
          matchScore: Number(h.score) || 0,
          reason: typeof h.reason === 'string' ? h.reason : '',
        };
      });

    // 按公众号聚合；组内按 matchScore 降序；组间按组内最高分降序
    const groupMap = new Map<string, { feedId: string; feedName: string; articles: typeof mergedHits }>();
    for (const h of mergedHits) {
      const g = groupMap.get(h.feedId) || { feedId: h.feedId, feedName: h.feedName, articles: [] };
      g.articles.push(h);
      groupMap.set(h.feedId, g);
    }
    const groups = Array.from(groupMap.values())
      .map((g) => ({ ...g, articles: g.articles.sort((a, b) => b.matchScore - a.matchScore) }))
      .sort((a, b) => (b.articles[0]?.matchScore || 0) - (a.articles[0]?.matchScore || 0));

    const result = {
      query,
      days,
      searched: candidates.length,
      totalAnalyzed: allCandidates.length,
      prefiltered: allCandidates.length !== candidates.length,
      total: mergedHits.length,
      overview,
      groups,
    };

    cache.set(cacheKey, { at: Date.now(), result });
    return result;
  });
}
