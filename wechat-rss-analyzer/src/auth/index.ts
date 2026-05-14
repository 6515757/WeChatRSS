import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as crypto from 'crypto';
import { FACTS, QUIZ_SYSTEM, buildQuizPrompt, Fact } from './facts';
import { llmClient } from '../analyzer/llm-client';

// 简单的 HMAC token 签发/验证
const SECRET = process.env.AUTH_SECRET || 'wechatrss-love-secret-2026';
const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000; // 7 天
const COOKIE_NAME = 'wrss_auth';

function signToken(): string {
  const payload = { exp: Date.now() + TOKEN_TTL_MS };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return data + '.' + sig;
}

function verifyToken(token: string): boolean {
  const [data, sig] = token.split('.');
  if (!data || !sig) return false;
  const expected = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  if (sig !== expected) return false;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    return payload.exp > Date.now();
  } catch {
    return false;
  }
}

// 进程内缓存当前 challenge（防止用户刷新页面丢失题目）
// key = 简单的 session id（存 cookie），value = { facts, questions }
const challenges = new Map<string, { facts: Fact[]; questions: any[]; createdAt: number }>();

// 清理过期 challenge（超过 1 小时）
function cleanChallenges() {
  const now = Date.now();
  for (const [k, v] of challenges) {
    if (now - v.createdAt > 3600000) challenges.delete(k);
  }
}

function pickRandom(arr: Fact[], n: number): Fact[] {
  const copy = [...arr];
  const result: Fact[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    result.push(copy.splice(idx, 1)[0]);
  }
  return result;
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  // 检查是否已认证
  app.get('/api/auth/me', async (req, reply) => {
    const token = parseCookie(req)
    if (token && verifyToken(token)) {
      return { authenticated: true };
    }
    return { authenticated: false };
  });

  // 获取题目
  app.get('/api/auth/challenge', async (req, reply) => {
    cleanChallenges();

    // 随机选 5 个事实
    const selected = pickRandom(FACTS, 5);
    const prompt = buildQuizPrompt(selected);

    let questions: any[];
    try {
      const raw = await llmClient.chat(QUIZ_SYSTEM, prompt, { maxTokens: 2048, temperature: 0.7 });
      const parsed = llmClient.parseJSON<{ questions: any[] }>(raw);
      questions = parsed.questions;
      if (!Array.isArray(questions) || questions.length < 5) {
        throw new Error('题目数量不足');
      }
    } catch (err) {
      return reply.status(500).send({ error: '出题失败，请刷新重试: ' + (err as Error).message });
    }

    // 生成 session id
    const sessionId = crypto.randomBytes(16).toString('hex');
    challenges.set(sessionId, { facts: selected, questions, createdAt: Date.now() });

    // 返回题目（不含 correctIndex）
    const safeQuestions = questions.map((q: any, i: number) => ({
      id: q.id || i + 1,
      text: q.text,
      options: q.options,
    }));

    reply.header('Set-Cookie', `wrss_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`);
    return { questions: safeQuestions };
  });

  // 验证答案
  app.post<{ Body: { answers: number[] } }>('/api/auth/verify', async (req, reply) => {
    const sessionId = parseSessionCookie(req);
    if (!sessionId || !challenges.has(sessionId)) {
      return reply.status(400).send({ error: '题目已过期，请刷新重新答题' });
    }

    const challenge = challenges.get(sessionId)!;
    const answers = req.body?.answers;
    if (!Array.isArray(answers) || answers.length !== 5) {
      return reply.status(400).send({ error: '请回答全部 5 道题' });
    }

    // 逐题检查
    const results = challenge.questions.map((q: any, i: number) => ({
      id: q.id || i + 1,
      correct: answers[i] === q.correctIndex,
    }));

    const allCorrect = results.every((r: any) => r.correct);

    if (allCorrect) {
      // 签发 token
      const token = signToken();
      challenges.delete(sessionId);
      reply.header('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`);
      return { success: true, results };
    }

    return { success: false, results };
  });
}

// API 守卫：检查认证
export function authGuard(req: FastifyRequest, reply: FastifyReply, done: () => void) {
  // 放行认证相关路由和静态资源
  const url = req.url;
  if (
    url.startsWith('/api/auth/') ||
    url === '/health' ||
    !url.startsWith('/api/')
  ) {
    done();
    return;
  }

  // 内部调用绕过（用于 cron / 手动触发）
  const internalKey = req.headers['x-internal-key'];
  if (internalKey === (process.env.AUTH_SECRET || 'wechatrss-love-secret-2026')) {
    done();
    return;
  }

  const token = parseCookie(req);
  if (token && verifyToken(token)) {
    done();
    return;
  }

  reply.status(401).send({ error: '请先完成认证' });
}

function parseCookie(req: FastifyRequest): string | null {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  return match ? match[1] : null;
}

function parseSessionCookie(req: FastifyRequest): string | null {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/wrss_session=([^;]+)/);
  return match ? match[1] : null;
}
