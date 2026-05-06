import Parser from 'rss-parser';
import { IArticleSource, RawArticle } from './types';
import { config } from '../config';

// we-mp-rss 专用适配器
// we-mp-rss 提供标准 RSS 格式，但内容更丰富
export class WeMpRssSource implements IArticleSource {
  name = 'we-mp-rss';

  private parser: Parser;
  private baseUrl: string;

  constructor() {
    this.baseUrl = config.weMpRss.url;
    this.parser = new Parser({
      customFields: {
        item: [
          ['content:encoded', 'contentEncoded'],
          ['description', 'description'],
          ['author', 'author'],
        ],
      },
      timeout: 20000,
      headers: {
        'User-Agent': 'WeChatRSSAnalyzer/1.0',
      },
    });
  }

  async fetchArticles(feedUrl: string): Promise<RawArticle[]> {
    // 支持传入完整 URL 或相对路径
    const url = feedUrl.startsWith('http') ? feedUrl : `${this.baseUrl}${feedUrl}`;
    const feed = await this.parser.parseURL(url);

    console.log(`[WeMpRss] 解析到 ${feed.items.length} 篇文章`);
    if (feed.items.length > 0) {
      const sample = feed.items[0];
      console.log(`[WeMpRss] 样本字段: link=${sample.link}, guid=${sample.guid}, title=${sample.title}`);
    }

    return feed.items.map((item) => {
      // we-mp-rss 的 link 字段是微信文章完整 URL
      // guid 也是完整 URL，作为备选
      const articleUrl = item.link || item.guid || (item as any).id || '';
      return {
        title: item.title || '无标题',
        url: articleUrl,
        content: (item as any).contentEncoded || item.content || (item as any).description || item.summary || '',
        author: item.creator || item.author || '',
        publishedAt: item.pubDate || item.isoDate || '',
      };
    });
  }

  // 通过 we-mp-rss API 获取所有订阅的公众号列表
  async listFeeds(): Promise<Array<{ id: string; name: string; rssUrl: string }>> {
    const response = await fetch(`${this.baseUrl}/api/feed/list`);
    if (!response.ok) {
      throw new Error(`获取订阅列表失败: ${response.status} ${response.statusText}`);
    }
    const data = await response.json() as any;
    // we-mp-rss 返回格式适配
    const items = data.data || data.items || data || [];
    return items.map((item: any) => ({
      id: item.id || item.mp_id || '',
      name: item.name || item.mp_name || '',
      rssUrl: `${this.baseUrl}/rss/${item.id || item.mp_id}.xml`,
    }));
  }
}
