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
    } catch (err) {
      const snippet = text.length > 2000 ? text.slice(0, 2000) + '\n...[truncated]' : text;
      throw new Error(
        '无法解析 LLM 返回的 JSON: ' + (err as Error).message + '\n-----raw-----\n' + snippet
      );
    }
  }
}

// 简单的 JSON 修复：处理中文/花引号，以及字符串内部的裸换行。
// 仅在原始 JSON.parse 失败后作为兜底使用。
function repairJson(input: string): string {
  let s = input;
  // 中文/花括号引号 → 普通双引号
  s = s.replace(/[\u201c\u201d\u2033]/g, '"').replace(/[\u2018\u2019\u2032]/g, "'");
  // 字符串内的裸换行转义成 \n
  let out = '';
  let inStr = false;
  let escape = false;
  for (const ch of s) {
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
      inStr = !inStr;
      out += ch;
      continue;
    }
    if (inStr && (ch === '\n' || ch === '\r')) {
      out += ch === '\n' ? '\\n' : '\\r';
      continue;
    }
    out += ch;
  }
  return out;
}

// 单例
export const llmClient = new LLMClient();
