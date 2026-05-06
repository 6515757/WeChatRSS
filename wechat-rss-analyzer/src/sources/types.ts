// 数据源抽象接口

export interface RawArticle {
  title: string;
  url: string;
  content?: string;
  author?: string;
  publishedAt?: string;
}

export interface IArticleSource {
  /** 数据源名称 */
  name: string;
  /** 拉取文章列表 */
  fetchArticles(feedUrl: string): Promise<RawArticle[]>;
}
