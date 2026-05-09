import OpenAI from 'openai';
import { config } from '../config';

// 封装 LLM 客户端，使用 OpenAI SDK 兼容接口调用 Claude
class LLMClient {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: config.llm.apiKey,
      baseURL: config.llm.baseURL,
    });
  }

  async chat(
    systemPrompt: string,
    userMessage: string,
    options?: {
      maxTokens?: number;
      temperature?: number;
      jsonMode?: boolean;
    }
  ): Promise<string> {
    const payload: any = {
      model: config.llm.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: options?.maxTokens ?? 2048,
      temperature: options?.temperature ?? 0.3,
    };
    // 尽量让上游强制输出 JSON；如果上游不支持，出错时不抛给调用方
    if (options?.jsonMode !== false) {
      payload.response_format = { type: 'json_object' };
    }

    let response;
    try {
      response = await this.client.chat.completions.create(payload);
    } catch (err: any) {
      // 某些上游不支持 response_format，降级重试一次
      const msg = String(err?.message || err);
      if (/response_format|json_object/i.test(msg) && payload.response_format) {
        delete payload.response_format;
        response = await this.client.chat.completions.create(payload);
      } else {
        throw err;
      }
    }

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('LLM 返回内容为空');
    }
    return content;
  }

  // 解析 LLM 返回的 JSON，带容错处理
  parseJSON<T>(text: string): T {
    // 1) 去掉 ```json ... ``` 代码块围栏
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    let body = (fenceMatch ? fenceMatch[1] : text).trim();

    // 2) 截取第一个 { 到最后一个 } 之间
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      body = body.slice(start, end + 1);
    }

    // 直接解析
    try {
      return JSON.parse(body) as T;
    } catch {}

    // 3) 尝试「安全修复」后再解析：
    //    - 把中文引号/花引号替换成普通双引号
    //    - 对字符串值中出现的裸换行做转义
    const repaired = repairJson(body);
    try {
      return JSON.parse(repaired) as T;
    } catch {}

    // 4) 最后兜底：LLM 输出被截断。尝试补齐未闭合的字符串 / 数组 / 对象，让解析至少能返回已抓到的部分。
    const salvaged = salvageTruncated(repaired);
    try {
      return JSON.parse(salvaged) as T;
    } catch (err) {
      const snippet = text.length > 2000 ? text.slice(0, 2000) + '\n...[truncated]' : text;
      throw new Error(
        '无法解析 LLM 返回的 JSON: ' + (err as Error).message + '\n-----raw-----\n' + snippet
      );
    }
  }
}

/**
 * 对"被截断的 JSON"做抢救：
 * 策略：先扫一遍，收集所有"安全切断点"（字符串外的 `,`、`}`、`]`），
 * 从最靠后的切点开始回退重试，补齐未关闭的容器，能 parse 就返回。
 */
function salvageTruncated(input: string): string {
  // 如果首次直接闭合就能 parse，立即返回（常见情况）
  const direct = closeUnclosed(input);
  try { JSON.parse(direct); return direct; } catch {}

  // 收集候选切断位置
  const cutPoints: Array<{ idx: number; inclusive: boolean }> = [];
  let inStr = false;
  let escape = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inStr) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === ',') cutPoints.push({ idx: i, inclusive: false }); // 切到逗号前
    else if (ch === '}' || ch === ']') cutPoints.push({ idx: i, inclusive: true }); // 切到闭括号后
  }

  // 从最靠后的切点开始尝试
  for (let k = cutPoints.length - 1; k >= 0; k--) {
    const p = cutPoints[k];
    let candidate = input.slice(0, p.inclusive ? p.idx + 1 : p.idx);
    candidate = candidate.replace(/[,\s]+$/, '');
    const closed = closeUnclosed(candidate);
    try { JSON.parse(closed); return closed; } catch {}
  }

  // 全部尝试失败，返回原始 direct 让外层抛错
  return direct;
}

/** 扫描输入，若在字符串里就补 `"`，然后按栈补齐 `]` / `}` */
function closeUnclosed(s: string): string {
  const stack: string[] = [];
  let inStr = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let out = s;
  if (inStr) out += '"';
  while (stack.length) {
    const top = stack.pop();
    out += top === '{' ? '}' : ']';
  }
  return out;
}

// 简单的 JSON 修复：处理中文/花引号、字符串内部裸双引号、以及字符串内部的裸换行。
// 仅在原始 JSON.parse 失败后作为兜底使用。
function repairJson(input: string): string {
  let s = input;
  // 中文/花括号引号 → 普通双引号（出现在值内部时统一处理，会在下面的扫描中被转义）
  s = s.replace(/[\u201c\u201d\u2033]/g, '"').replace(/[\u2018\u2019\u2032]/g, "'");

  // 扫描：逐字符判断当前是否在字符串里。遇到字符串内部的非转义 `"` 需要判断它是真正的字符串结束，
  // 还是作者写在正文里的引号——启发式：看紧随其后的下一个非空白字符是不是 JSON 结构字符
  // (`,` `}` `]` `:`)，若不是则视为字符串内容中的引号并转义它。
  let out = '';
  let inStr = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (!inStr) {
      if (ch === '"') {
        inStr = true;
      }
      out += ch;
      continue;
    }
    // in string
    if (escape) {
      out += ch;
      escape = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escape = true;
      continue;
    }
    if (ch === '"') {
      // peek 后面的第一个非空白字符
      let j = i + 1;
      while (j < s.length && (s[j] === ' ' || s[j] === '\t' || s[j] === '\r' || s[j] === '\n')) j++;
      const next = s[j];
      if (next === ',' || next === '}' || next === ']' || next === ':' || next === undefined) {
        // 视为字符串结束
        inStr = false;
        out += ch;
      } else {
        // 视为字符串中未转义的引号，补转义
        out += '\\"';
      }
      continue;
    }
    if (ch === '\n') {
      out += '\\n';
      continue;
    }
    if (ch === '\r') {
      out += '\\r';
      continue;
    }
    out += ch;
  }
  return out;
}

// 单例
export const llmClient = new LLMClient();
