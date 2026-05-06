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
    }
  ): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: config.llm.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: options?.maxTokens ?? 2048,
      temperature: options?.temperature ?? 0.3,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('LLM 返回内容为空');
    }
    return content;
  }

  // 解析 LLM 返回的 JSON，带容错处理
  parseJSON<T>(text: string): T {
    // 尝试提取 ```json ... ``` 代码块
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();

    try {
      return JSON.parse(jsonStr) as T;
    } catch {
      // 尝试找到第一个 { 到最后一个 } 之间的内容
      const start = jsonStr.indexOf('{');
      const end = jsonStr.lastIndexOf('}');
      if (start !== -1 && end !== -1) {
        return JSON.parse(jsonStr.slice(start, end + 1)) as T;
      }
      throw new Error(`无法解析 LLM 返回的 JSON: ${text.slice(0, 200)}`);
    }
  }
}

// 单例
export const llmClient = new LLMClient();
