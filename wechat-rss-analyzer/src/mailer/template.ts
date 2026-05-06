// HTML 邮件模板 - 微信公众号每日摘要

interface EmailArticle {
  title: string;
  url: string;
  topics: string[];
  summary: string;
  keyPoints: string[];
  keyData: string[];
  importanceScore: number;
}

interface EmailFeedGroup {
  feedName: string;
  articles: EmailArticle[];
}

function renderTag(text: string): string {
  return `<span style="display:inline-block;background:#ebf5ff;color:#2b6cb0;font-size:11px;padding:2px 8px;border-radius:10px;margin-right:5px;margin-bottom:4px;">${text}</span>`;
}

function renderLabel(label: string, content: string): string {
  return `<div style="margin-bottom:8px;font-size:13px;color:#4a5568;line-height:1.7;">
    <span style="color:#2b6cb0;font-weight:600;">【${label}】</span>${content}
  </div>`;
}

function renderArticle(a: EmailArticle): string {
  const tagsHtml = a.topics.length > 0
    ? `<div style="margin-bottom:10px;">${a.topics.map(renderTag).join('')}</div>`
    : '';

  const summaryHtml = a.summary ? renderLabel('核心内容', a.summary) : '';
  const keyPointsHtml = a.keyPoints.length > 0 ? renderLabel('关键观点', a.keyPoints.join('；') + '。') : '';
  const keyDataHtml = a.keyData.length > 0 ? renderLabel('关键数据', a.keyData.join('；') + '。') : '';

  return `
  <div style="background:#ffffff;border:1px solid #e8edf2;border-radius:10px;padding:18px 20px;margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
    <div style="font-weight:700;font-size:14px;color:#1a202c;margin-bottom:10px;line-height:1.5;">${a.title}</div>
    ${tagsHtml}
    ${summaryHtml}
    ${keyPointsHtml}
    ${keyDataHtml}
    <div style="margin-top:10px;padding-top:10px;border-top:1px solid #f0f3f7;">
      <a href="${a.url}" style="color:#3182ce;font-size:12px;text-decoration:none;font-weight:500;">&#128279; 阅读原文</a>
    </div>
  </div>`;
}

export function buildEmailHtml(
  date: string,
  totalArticles: number,
  totalFeeds: number,
  feedGroups: EmailFeedGroup[]
): string {
  const feedSections = feedGroups
    .map((group) => {
      const articlesHtml = group.articles.map(renderArticle).join('\n');

      return `
      <div style="margin-bottom:28px;">
        <div style="display:flex;align-items:center;margin-bottom:16px;">
          <div style="width:4px;height:20px;background:linear-gradient(180deg,#3182ce,#63b3ed);border-radius:2px;margin-right:10px;"></div>
          <span style="font-size:16px;font-weight:700;color:#2d3748;">${group.feedName}</span>
          <span style="font-size:12px;color:#a0aec0;margin-left:10px;">${group.articles.length} 篇</span>
        </div>
        ${articlesHtml}
      </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f0f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;-webkit-font-smoothing:antialiased;">

<div style="max-width:640px;margin:24px auto;background-color:#f7f9fc;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#2d3748 0%,#4a5568 100%);padding:30px 24px;text-align:center;">
    <div style="font-size:21px;font-weight:700;color:#ffffff;letter-spacing:0.5px;">&#128240;&nbsp; 微信公众号每日摘要</div>
    <div style="color:#cbd5e0;font-size:13px;margin-top:6px;">${date}</div>
  </div>

  <!-- Stats bar -->
  <div style="background:#ffffff;padding:12px 24px;border-bottom:1px solid #edf2f7;">
    <span style="font-size:13px;color:#718096;">今日共更新 <strong style="color:#2d3748;">${totalArticles}</strong> 篇文章，来自 <strong style="color:#2d3748;">${totalFeeds}</strong> 个公众号</span>
  </div>

  <!-- Content -->
  <div style="padding:24px 20px 8px;">
    ${feedSections}
  </div>

  <!-- Footer -->
  <div style="text-align:center;padding:16px 20px 20px;color:#a0aec0;font-size:11px;">
    由 WeChat RSS Digest 自动生成 · Powered by Claude
  </div>

</div>

</body>
</html>`;
}
