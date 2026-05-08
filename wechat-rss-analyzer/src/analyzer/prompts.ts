// Prompt 模板集合

export const ARTICLE_ANALYSIS_SYSTEM = `你是一个专业的内容分析助手，擅长分析微信公众号文章。
请对给定的文章进行分析，并以 JSON 格式返回结果。
返回格式必须严格遵循以下结构：

{
  "summary": "文章核心内容摘要，100-200字",
  "topics": ["主题1", "主题2"],
  "keyPoints": ["关键观点1", "关键观点2", "关键观点3"],
  "keyData": ["关键数据1", "关键数据2"],
  "importanceScore": 7.5
}

说明：
- summary: 简洁的文章摘要，概括核心内容和结论
- topics: 文章涉及的主题标签，2-5个，简短精炼
- keyPoints: 文章的核心观点或关键结论，2-4条，每条一句话
- keyData: 文章中提到的关键数据或数字，如"GDP同比增长5.0%"、"研究覆盖超1800支个股"，2-4条。如果没有具体数据则返回空数组
- importanceScore: 文章重要性评分，0-10分，10分最重要

重要：所有字符串值中，如果需要引号，请使用中文引号""''，不要使用英文双引号 "，否则会破坏 JSON 结构。
只返回合法的 JSON，不要有其他内容。`;

export function buildArticleAnalysisPrompt(title: string, content: string): string {
  const maxContentLength = 6000;
  const truncatedContent =
    content.length > maxContentLength
      ? content.slice(0, maxContentLength) + '\n\n[内容过长，已截断]'
      : content;

  return `请分析以下微信公众号文章：

标题：${title}

正文：
${truncatedContent}`;
}

export const REPORT_GENERATION_SYSTEM = `你是一个专业的内容分析报告撰写助手。
请根据提供的文章分析数据，生成一份结构清晰、内容丰富的分析报告。
报告使用 Markdown 格式，包含以下部分：
1. 概述（本期内容总结）
2. 热点话题（本期最受关注的主题）
3. 重要文章精选（按重要性评分排序，每篇包含标题、摘要、来源）
4. 趋势分析（内容趋势和值得关注的方向）

语言简洁专业，适合快速阅读。`;

export function buildReportPrompt(
  reportType: 'daily' | 'weekly' | 'monthly',
  periodStart: string,
  periodEnd: string,
  articles: Array<{
    title: string;
    feedName: string;
    summary: string;
    topics: string[];
    keyPoints: string[];
    importanceScore: number;
    publishedAt: string;
  }>
): string {
  const typeLabel = { daily: '日报', weekly: '周报', monthly: '月报' }[reportType];
  const articlesText = articles
    .map(
      (a, i) =>
        `${i + 1}. 【${a.feedName}】${a.title}
   发布时间：${a.publishedAt}
   重要性：${a.importanceScore}/10
   主题：${a.topics.join('、')}
   摘要：${a.summary}
   关键观点：${a.keyPoints.join('；')}`
    )
    .join('\n\n');

  return `请生成一份微信公众号内容${typeLabel}。

报告周期：${periodStart} 至 ${periodEnd}
文章总数：${articles.length} 篇

文章列表：
${articlesText}`;
}
