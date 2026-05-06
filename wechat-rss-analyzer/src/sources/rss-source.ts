import Parser from 'rss-parser';
import { IArticleSource, RawArticle } from './types';

// 通用 RSS 适配器，兼容标准 RSS/Atom 格式
export class RssSource implements IArticleSource {
  name = 'generic-rss';

  private parser: Parser;

  constructor() {
    this.parser = new Parser({
      customFields: {
        item: [
          ['content:encoded', 'contentEncoded'],
          ['description', 'description'],
        ],
      },
      timeout: 15000,
      headers: {
        'User-Agent': 'WeChatRSSAnalyzer/1.0',
      },
    });
  }

  async fetchArticles(feedUrl: string): Promise<RawArticle[]> {
    const feed = await this.parser.parseURL(feedUrl);

    return feed.items.map((item) => ({
      title: item.title || '无标题',
      url: item.link || item.guid || '',
      // 优先使用全文，其次 description
      content: (item as any).contentEncoded || item.content || item.summary || '',
      author: item.creator || item.author || '',
      publishedAt: item.pubDate || item.isoDate || '',
    }));
  }
}
