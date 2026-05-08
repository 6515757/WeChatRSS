const API = '/api';
let currentPage = 'tasks';
let articlePage = 1;
let articleKeyword = '';
let articleFeedId = '';
let statusPollTimer = null;

// ─── Navigation ───────────────────────────────────────────────────────────────

function showPage(page) {
  // 页面遍历：原先的 reports 已并入 digests，无需保留
  ['tasks', 'articles', 'digests', 'feeds'].forEach(p => {
    const pageEl = document.getElementById(`page-${p}`);
    if (pageEl) pageEl.classList.add('hidden');
    const navEl = document.getElementById(`nav-${p}`);
    if (navEl) navEl.classList.remove('active');
  });
  document.getElementById(`page-${page}`).classList.remove('hidden');
  document.getElementById(`nav-${page}`).classList.add('active');
  currentPage = page;

  // articles 页采用左右分栏，自己管理滚动；其它页让外层 main 滚动
  const mainEl = document.querySelector('main.main-content');
  if (mainEl) {
    if (page === 'articles') {
      mainEl.classList.add('overflow-hidden');
      mainEl.classList.remove('overflow-y-auto');
    } else {
      mainEl.classList.remove('overflow-hidden');
      mainEl.classList.add('overflow-y-auto');
    }
  }

  if (page === 'tasks') { refreshStatus(); startStatusPoll(); }
  else { stopStatusPoll(); }
  if (page === 'articles') { ensureFeedSidebar(); loadArticles(); }
  if (page === 'digests') loadDigests();
  if (page === 'feeds') loadFeeds();
}

// ─── Task Status ──────────────────────────────────────────────────────────────

function startStatusPoll() {
  stopStatusPoll();
  statusPollTimer = setInterval(refreshStatus, 5000);
}

function stopStatusPoll() {
  if (statusPollTimer) { clearInterval(statusPollTimer); statusPollTimer = null; }
}

async function refreshStatus() {
  try {
    const data = await get('/tasks/status');
    renderTaskStatus(data);
  } catch (e) { /* ignore */ }
}

function renderTaskStatus(data) {
  const tasks = ['refresh', 'fetch', 'analyze', 'pipeline'];
  tasks.forEach(key => {
    const s = data[key];
    if (!s) return;
    const el = document.getElementById(`status-${key}`);
    if (!el) return;

    if (s.running) {
      el.innerHTML = `<span class="text-blue-500 spinner inline-block">⟳</span> 运行中...`;
      const btn = document.getElementById(`btn-${key}`);
      if (btn) btn.disabled = true;
    } else {
      const btn = document.getElementById(`btn-${key}`);
      if (btn) btn.disabled = false;

      if (s.lastRun) {
        const time = new Date(s.lastRun).toLocaleString('zh-CN');
        let result = '';
        if (s.lastResult) {
          if (s.lastResult.error) {
            result = `<span class="text-red-500">✗ ${s.lastResult.error.slice(0, 60)}</span>`;
          } else if (key === 'fetch') {
            result = `<span class="text-green-600">✓ 新增 ${s.lastResult.newArticles || 0} 篇</span>`;
          } else if (key === 'analyze') {
            result = `<span class="text-green-600">✓ 成功 ${s.lastResult.success || 0} 篇</span>`;
          } else if (key === 'refresh') {
            result = `<span class="text-green-600">✓ ${s.lastResult.success || 0}/${s.lastResult.total || 0} 个公众号</span>`;
          } else if (key === 'pipeline') {
            const ok = s.lastResult.success;
            result = ok
              ? `<span class="text-green-600">✓ 完成</span>`
              : `<span class="text-red-500">✗ ${(s.lastResult.error || '').slice(0, 60)}</span>`;
          }
        }
        el.innerHTML = `<span class="text-gray-400">${time}</span> ${result}`;
      } else {
        el.innerHTML = `<span class="text-gray-400">尚未运行</span>`;
      }
    }
  });

  // Pipeline status
  const ps = data.pipeline;
  renderPipelineProgress(ps);
}

// ─── Task Actions ─────────────────────────────────────────────────────────────

async function runPipeline() {
  const btn = document.getElementById('btn-pipeline');
  btn.disabled = true;
  btn.textContent = '运行中...';
  try {
    await post('/tasks/pipeline');
    showToast('流水线已启动');
    // 开始快速轮询进度
    startPipelinePoll();
  } catch (e) {
    showToast('启动失败: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = '执行';
  }
}

let pipelinePollTimer = null;
function startPipelinePoll() {
  stopPipelinePoll();
  pipelinePollTimer = setInterval(async () => {
    try {
      const data = await get('/tasks/status');
      renderPipelineProgress(data.pipeline);
      if (!data.pipeline.running) {
        stopPipelinePoll();
        const btn = document.getElementById('btn-pipeline');
        btn.disabled = false;
        btn.textContent = '执行';
      }
    } catch (e) { /* ignore */ }
  }, 2000);
}

function stopPipelinePoll() {
  if (pipelinePollTimer) { clearInterval(pipelinePollTimer); pipelinePollTimer = null; }
}

const STEP_LABELS = { refresh: '刷新公众号', sync: '同步订阅源', fetch: '抓取文章', analyze: 'LLM 分析', email: '发送邮件' };
const STEP_ORDER = ['refresh', 'sync', 'fetch', 'analyze', 'email'];

function renderPipelineProgress(ps) {
  const el = document.getElementById('pipeline-status');
  if (!ps) { el.classList.add('hidden'); return; }

  el.classList.remove('hidden');

  if (ps.running && (!ps.lastResult || !ps.lastResult.steps || ps.lastResult.steps.length === 0)) {
    el.innerHTML = renderStepTimeline([], true);
    return;
  }

  if (ps.running && ps.lastResult && ps.lastResult.steps) {
    el.innerHTML = renderStepTimeline(ps.lastResult.steps, true);
    return;
  }

  if (!ps.running && ps.lastResult) {
    if (ps.lastResult.error) {
      el.innerHTML = '<div style="color:#fca5a5;">✗ ' + ps.lastResult.error.slice(0, 100) + '</div>';
    } else {
      el.innerHTML = renderStepTimeline(ps.lastResult.steps || [], false);
    }
    return;
  }

  el.classList.add('hidden');
}

function renderStepTimeline(completedSteps, isRunning) {
  const doneNames = completedSteps.map(s => s.step);
  let currentStep = null;
  if (isRunning) {
    // 找到下一个未完成的步骤
    currentStep = STEP_ORDER.find(s => !doneNames.includes(s)) || null;
  }

  return '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
    STEP_ORDER.map(step => {
      const done = doneNames.includes(step);
      const active = step === currentStep;
      const label = STEP_LABELS[step] || step;

      if (done) {
        const s = completedSteps.find(x => x.step === step);
        const detail = getStepDetail(s);
        return `<span style="color:#86efac;font-size:12px;" title="${detail}">✓ ${label}</span><span style="color:rgba(255,255,255,0.3);font-size:10px;">→</span>`;
      } else if (active) {
        return `<span style="color:#fff;font-size:12px;" class="spinner">⟳</span><span style="color:#fff;font-size:12px;font-weight:500;">${label}</span><span style="color:rgba(255,255,255,0.3);font-size:10px;">→</span>`;
      } else {
        return `<span style="color:rgba(255,255,255,0.4);font-size:12px;">${label}</span><span style="color:rgba(255,255,255,0.2);font-size:10px;">→</span>`;
      }
    }).join('').replace(/→<\/span>$/, '</span>') +
    '</div>';
}

function getStepDetail(s) {
  if (!s) return '';
  if (s.step === 'refresh') return `${s.success || 0}/${s.total || 0} 个公众号`;
  if (s.step === 'sync') return `新增 ${s.added || 0}，已有 ${s.existing || 0}`;
  if (s.step === 'fetch') return `新增 ${s.newArticles || 0} 篇`;
  if (s.step === 'analyze') return `成功 ${s.success || 0}，失败 ${s.failed || 0}`;
  if (s.step === 'email') return s.sent ? '已发送' : '';
  return '';
}

async function runTask(type) {
  const btn = document.getElementById(`btn-${type}`);
  if (btn) btn.disabled = true;
  try {
    await post(`/tasks/${type}`);
    showToast(`${type} 任务已启动`);
    setTimeout(refreshStatus, 1000);
  } catch (e) {
    showToast('启动失败: ' + e.message, 'error');
    if (btn) btn.disabled = false;
  }
}

async function runEmail(type) {
  const el = document.getElementById('status-email');
  el.innerHTML = '<span class="text-blue-500">发送中...</span>';
  try {
    const url = type === 'all' ? '/tasks/email/all' : '/tasks/email';
    await post(url);
    el.innerHTML = '<span class="text-green-600">✓ 邮件已发送</span>';
    showToast('邮件发送成功');
  } catch (e) {
    el.innerHTML = `<span class="text-red-500">✗ ${e.message}</span>`;
    showToast('发送失败: ' + e.message, 'error');
  }
}

// ─── Reports（老报告板块，已并入「报告」=digests 板块，保留占位避免旧代码 ReferenceError） ─
// 老报告功能已废弃。这里保留一些没被调用到的空函数，防止 index.html 缓存还指向它们。

// ─── Articles ─────────────────────────────────────────────────────────────────

let feedsCache = null;
async function ensureFeedSidebar() {
  const panel = document.getElementById('article-feeds-panel');
  if (!panel) return;
  if (feedsCache) {
    renderFeedSidebar();
    return;
  }
  try {
    const data = await get('/feeds');
    const feeds = data.feeds || data.data || data || [];
    feedsCache = feeds;
    renderFeedSidebar();
  } catch (e) {
    panel.innerHTML = `<div class="text-red-400 text-xs px-3 py-4">加载失败: ${escHtml(e.message)}</div>`;
  }
}

function renderFeedSidebar() {
  const panel = document.getElementById('article-feeds-panel');
  if (!panel || !feedsCache) return;
  const active = articleFeedId || '';
  const totalCount = feedsCache.reduce((s, f) => s + (f.articleCount || 0), 0) || '';
  const allItem = `
    <div class="feed-item ${active === '' ? 'active' : ''}" onclick="selectFeed('')">
      <div class="avatar" style="background:linear-gradient(135deg,#4f46e5,#7c3aed);">全</div>
      <span>全部</span>
    </div>
  `;
  const items = feedsCache.map((f) => {
    const cls = active === f.id ? 'active' : '';
    const initial = (f.name || '·').slice(0, 1);
    return `
      <div class="feed-item ${cls}" onclick="selectFeed('${escHtml(f.id)}')" title="${escHtml(f.name)}">
        <div class="avatar">${escHtml(initial)}</div>
        <span class="truncate" style="min-width:0;overflow:hidden;text-overflow:ellipsis;">${escHtml(f.name)}</span>
      </div>
    `;
  }).join('');
  panel.innerHTML = `<div class="space-y-0.5">${allItem}${items}</div>`;
}

function selectFeed(feedId) {
  articleFeedId = feedId || '';
  articlePage = 1;
  renderFeedSidebar();
  loadArticles();
}

let searchTimer = null;
function searchArticles() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    articleKeyword = document.getElementById('article-search').value;
    articlePage = 1;
    loadArticles();
  }, 400);
}

async function loadArticles(page = articlePage) {
  articlePage = page;
  const el = document.getElementById('articles-list');
  el.innerHTML = '<div class="text-gray-400 text-sm text-center py-8">加载中...</div>';
  try {
    const params = new URLSearchParams({ page, pageSize: 20 });
    if (articleKeyword) params.set('keyword', articleKeyword);
    if (articleFeedId) params.set('feedId', articleFeedId);
    const data = await get(`/articles?${params}`);
    const articles = data.articles || data.data || data || [];
    const total = data.total || articles.length;

    // header
    const titleEl = document.getElementById('articles-header-title');
    const subEl = document.getElementById('articles-header-sub');
    if (titleEl) {
      if (articleFeedId && feedsCache) {
        const f = feedsCache.find(x => x.id === articleFeedId);
        titleEl.textContent = f ? f.name : '未知公众号';
      } else {
        titleEl.textContent = '全部公众号';
      }
    }
    if (subEl) subEl.textContent = `共 ${total} 篇`;

    if (articles.length === 0) {
      el.innerHTML = '<div class="text-gray-400 text-sm text-center py-16">暂无文章</div>';
      document.getElementById('articles-pagination').innerHTML = '';
      return;
    }

    el.innerHTML = articles.map(a => {
      const hasAnalysis = a.analysis || a.analysisId || a.hasAnalysis;
      const score = a.analysis?.importanceScore ?? a.importanceScore;
      const scoreColor = score >= 7 ? 'text-red-500' : score >= 5 ? 'text-yellow-500' : 'text-gray-400';
      const summary = a.summary || a.analysis?.summary || '';
      let statusBadge;
      if (summary === 'Content unavailable') {
        statusBadge = '<span class="badge bg-gray-100 text-gray-500">无正文</span>';
      } else if (summary === 'Analysis failed') {
        statusBadge = '<span class="badge bg-red-100 text-red-600">分析失败</span>';
      } else if (hasAnalysis) {
        statusBadge = '<span class="badge bg-green-100 text-green-700">已分析</span>';
      } else {
        statusBadge = '<span class="badge bg-gray-100 text-gray-500">未分析</span>';
      }
      return `
        <div class="card article-card py-3 px-4" data-article-id="${escHtml(a.id)}" onclick="toggleArticle(this)">
          <div class="flex items-start justify-between gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <svg class="chevron flex-shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                <span class="font-medium text-gray-900 text-sm line-clamp-1">${escHtml(a.title)}</span>
              </div>
              <div class="flex items-center gap-3 mt-1 ml-[18px]">
                <span class="text-xs text-gray-400">${escHtml(a.feedName || a.feed?.name || '')}</span>
                <span class="text-xs text-gray-400">${a.publishedAt ? new Date(a.publishedAt).toLocaleDateString('zh-CN') : ''}</span>
                ${statusBadge}
              </div>
            </div>
            ${score != null ? `<span class="text-sm font-bold ${scoreColor} flex-shrink-0">${Number(score).toFixed(1)}</span>` : ''}
          </div>
          <div class="article-detail mt-0 ml-[18px]">
            <div class="pt-3 mt-3 border-t border-gray-100 article-detail-body">
              <div class="text-xs text-gray-400">展开加载...</div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Pagination
    const totalPages = Math.ceil(total / 20);
    renderPagination(page, totalPages);
  } catch (e) {
    el.innerHTML = `<div class="text-red-400 text-sm text-center py-8">加载失败: ${e.message}</div>`;
  }
}

function renderPagination(current, total) {
  const el = document.getElementById('articles-pagination');
  if (total <= 1) { el.innerHTML = ''; return; }
  const pages = [];
  for (let i = Math.max(1, current - 2); i <= Math.min(total, current + 2); i++) pages.push(i);
  el.innerHTML = [
    current > 1 ? `<button class="btn btn-secondary text-xs" onclick="loadArticles(${current - 1})">‹</button>` : '',
    ...pages.map(p => `<button class="btn text-xs ${p === current ? 'btn-primary' : 'btn-secondary'}" onclick="loadArticles(${p})">${p}</button>`),
    current < total ? `<button class="btn btn-secondary text-xs" onclick="loadArticles(${current + 1})">›</button>` : '',
  ].join('');
}

// 卡片展开/折叠 + 按需加载分析详情
const articleDetailCache = {};
async function toggleArticle(cardEl) {
  if (!cardEl) return;
  const id = cardEl.dataset.articleId;
  const willOpen = !cardEl.classList.contains('open');
  // 收起其它已展开卡片（一次只看一个）
  document.querySelectorAll('.article-card.open').forEach(el => {
    if (el !== cardEl) el.classList.remove('open');
  });
  cardEl.classList.toggle('open', willOpen);
  if (!willOpen) return;
  const body = cardEl.querySelector('.article-detail-body');
  if (!body) return;
  if (articleDetailCache[id]) {
    body.innerHTML = articleDetailCache[id];
    return;
  }
  body.innerHTML = '<div class="text-xs text-gray-400">加载中...</div>';
  try {
    const data = await get(`/articles/${encodeURIComponent(id)}`);
    const html = renderArticleDetail(data);
    articleDetailCache[id] = html;
    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = `<div class="text-xs text-red-500">加载失败: ${escHtml(e.message)}</div>`;
  }
}

function renderArticleDetail(a) {
  const an = a.analysis;
  // 无分析 / 占位情况
  if (!an) {
    return `
      <div class="analysis-section">
        <div class="text-gray-500">暂未生成分析。</div>
        <a href="${escHtml(a.url)}" target="_blank" class="text-xs text-indigo-600 hover:underline mt-2 inline-block">阅读原文 →</a>
      </div>`;
  }
  if (an.summary === 'Content unavailable') {
    return `
      <div class="analysis-section">
        <div class="text-gray-500">RSS 源没有提供正文，无法生成分析。</div>
        <a href="${escHtml(a.url)}" target="_blank" class="text-xs text-indigo-600 hover:underline mt-2 inline-block">阅读原文 →</a>
      </div>`;
  }
  if (an.summary === 'Analysis failed') {
    const raw = an.rawResponse ? String(an.rawResponse) : '';
    return `
      <div class="analysis-section">
        <div class="text-red-500 mb-2">LLM 分析失败。</div>
        ${raw ? `<details class="text-xs text-gray-500"><summary class="cursor-pointer">错误详情</summary><pre class="whitespace-pre-wrap mt-2 p-2 bg-gray-50 rounded border border-gray-100">${escHtml(raw.slice(0, 2000))}</pre></details>` : ''}
        <a href="${escHtml(a.url)}" target="_blank" class="text-xs text-indigo-600 hover:underline mt-2 inline-block">阅读原文 →</a>
      </div>`;
  }

  const topics = Array.isArray(an.topics) ? an.topics : [];
  const keyPoints = Array.isArray(an.keyPoints) ? an.keyPoints : [];
  // keyData 可能是 JSON 字符串 也可能是数组
  let keyData = an.keyData;
  if (typeof keyData === 'string') {
    try { keyData = JSON.parse(keyData); } catch { keyData = []; }
  }
  if (!Array.isArray(keyData)) keyData = [];

  const topicsHtml = topics.length
    ? `<div class="mb-3">${topics.map(t => `<span class="topic-chip">${escHtml(t)}</span>`).join('')}</div>`
    : '';
  const summaryHtml = an.summary
    ? `<div class="mb-3"><span class="label">核心内容</span>${escHtml(an.summary)}</div>`
    : '';
  const keyPointsHtml = keyPoints.length
    ? `<div class="mb-3"><span class="label">关键观点</span><ul class="key-list">${keyPoints.map(p => `<li>${escHtml(p)}</li>`).join('')}</ul></div>`
    : '';
  const keyDataHtml = keyData.length
    ? `<div class="mb-3"><span class="label">关键数据</span><ul class="key-list">${keyData.map(p => `<li>${escHtml(p)}</li>`).join('')}</ul></div>`
    : '';
  const scoreHtml = an.importanceScore != null
    ? `<div class="mb-3"><span class="label">重要性</span>${Number(an.importanceScore).toFixed(1)} / 10</div>`
    : '';

  return `
    <div class="analysis-section">
      ${topicsHtml}
      ${summaryHtml}
      ${keyPointsHtml}
      ${keyDataHtml}
      ${scoreHtml}
      <a href="${escHtml(a.url)}" target="_blank" class="text-xs text-indigo-600 hover:underline">阅读原文 →</a>
    </div>`;
}

// ─── Digests ──────────────────────────────────────────────────────────────────

let digestPage = 1;
async function loadDigests(page = 1) {
  digestPage = page;
  const el = document.getElementById('digests-list');
  el.innerHTML = '<div class="text-gray-400 text-sm text-center py-8">加载中...</div>';
  try {
    const params = new URLSearchParams({ page, pageSize: 20 });
    const data = await get(`/digests?${params}`);
    const items = data.data || [];
    const total = data.total || items.length;
    document.getElementById('digests-count').textContent = total > 0 ? `共 ${total} 封` : '';
    if (items.length === 0) {
      el.innerHTML = '<div class="text-gray-400 text-sm text-center py-8">暂无已发送的邮件</div>';
      document.getElementById('digests-pagination').innerHTML = '';
      return;
    }
    el.innerHTML = items.map(d => `
      <div class="card hover:border-gray-200 cursor-pointer transition-colors" onclick="openDigest('${escHtml(d.id)}')">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium text-gray-900 truncate">${escHtml(d.subject)}</div>
            <div class="text-xs text-gray-400 mt-1">
              ${new Date(d.sentAt).toLocaleString('zh-CN')}
              · ${d.articleCount} 篇 · ${d.feedCount} 个公众号
              · 发至 ${escHtml(d.recipient || '')}
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>
    `).join('');

    // 分页
    const totalPages = Math.ceil(total / 20);
    const pEl = document.getElementById('digests-pagination');
    if (totalPages <= 1) { pEl.innerHTML = ''; return; }
    const pages = [];
    for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i++) pages.push(i);
    pEl.innerHTML = [
      page > 1 ? `<button class="btn btn-secondary text-xs" onclick="loadDigests(${page - 1})">‹</button>` : '',
      ...pages.map(p => `<button class="btn text-xs ${p === page ? 'btn-primary' : 'btn-secondary'}" onclick="loadDigests(${p})">${p}</button>`),
      page < totalPages ? `<button class="btn btn-secondary text-xs" onclick="loadDigests(${page + 1})">›</button>` : '',
    ].join('');
  } catch (e) {
    el.innerHTML = `<div class="text-red-400 text-sm text-center py-8">加载失败: ${escHtml(e.message)}</div>`;
  }
}

async function openDigest(id) {
  try {
    const data = await get(`/digests/${encodeURIComponent(id)}`);
    document.getElementById('digest-modal-title').textContent = data.subject || '邮件';
    const sub = [];
    if (data.sentAt) sub.push(new Date(data.sentAt).toLocaleString('zh-CN'));
    if (data.articleCount != null) sub.push(`${data.articleCount} 篇`);
    if (data.feedCount != null) sub.push(`${data.feedCount} 个公众号`);
    if (data.recipient) sub.push(`发至 ${data.recipient}`);
    document.getElementById('digest-modal-sub').textContent = sub.join(' · ');
    document.getElementById('digest-modal-iframe').src = `/api/digests/${encodeURIComponent(id)}/html`;
    document.getElementById('digest-modal').classList.remove('hidden');
  } catch (e) {
    showToast('打开失败: ' + e.message, 'error');
  }
}

function closeDigestModal() {
  document.getElementById('digest-modal').classList.add('hidden');
  document.getElementById('digest-modal-iframe').src = 'about:blank';
}

// ─── Feeds ────────────────────────────────────────────────────────────────────

async function loadFeeds() {
  const el = document.getElementById('feeds-list');
  el.innerHTML = '<div class="text-gray-400 text-sm text-center py-8">加载中...</div>';
  try {
    const data = await get('/feeds');
    const feeds = data.feeds || data.data || data || [];
    if (feeds.length === 0) {
      el.innerHTML = '<div class="text-gray-400 text-sm text-center py-8">暂无订阅源，点击右上角添加</div>';
      return;
    }
    el.innerHTML = feeds.map(f => `
      <div class="card">
        <div class="flex items-center justify-between">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-medium text-gray-900 text-sm">${escHtml(f.name)}</span>
              <span class="badge ${f.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}">${f.enabled ? '启用' : '停用'}</span>
            </div>
            <div class="text-xs text-gray-400 mt-1 truncate">${escHtml(f.url)}</div>
            ${f.titleFilter ? `<div class="text-xs text-blue-500 mt-0.5">过滤: ${escHtml(f.titleFilter)}</div>` : ''}
            <div class="text-xs text-gray-400 mt-0.5">最后抓取: ${f.lastFetchedAt ? new Date(f.lastFetchedAt).toLocaleString('zh-CN') : '从未'}</div>
          </div>
          <div class="flex gap-2 ml-3">
            <button class="btn btn-secondary text-xs" onclick="toggleFeed('${f.id}', ${!f.enabled})">${f.enabled ? '停用' : '启用'}</button>
            <button class="btn btn-danger text-xs" onclick="deleteFeed('${f.id}', '${escHtml(f.name)}')">删除</button>
          </div>
        </div>
      </div>
    `).join('');
  } catch (e) {
    el.innerHTML = `<div class="text-red-400 text-sm text-center py-8">加载失败: ${e.message}</div>`;
  }
}

function showAddFeed() {
  document.getElementById('feed-modal').classList.remove('hidden');
}

function closeFeedModal() {
  document.getElementById('feed-modal').classList.add('hidden');
  document.getElementById('feed-name').value = '';
  document.getElementById('feed-url').value = '';
  document.getElementById('feed-filter').value = '';
}

async function addFeed() {
  const name = document.getElementById('feed-name').value.trim();
  const url = document.getElementById('feed-url').value.trim();
  const titleFilter = document.getElementById('feed-filter').value.trim();
  if (!name || !url) { showToast('名称和 URL 不能为空', 'error'); return; }
  try {
    await post('/feeds', { name, url, sourceType: 'we-mp-rss', titleFilter: titleFilter || null });
    showToast('订阅源添加成功');
    closeFeedModal();
    feedsCache = null;
    loadFeeds();
  } catch (e) {
    showToast('添加失败: ' + e.message, 'error');
  }
}

async function toggleFeed(id, enabled) {
  try {
    await put(`/feeds/${id}`, { enabled });
    feedsCache = null;
    loadFeeds();
  } catch (e) {
    showToast('操作失败: ' + e.message, 'error');
  }
}

async function deleteFeed(id, name) {
  if (!confirm(`确认删除订阅源「${name}」？相关文章也会被删除。`)) return;
  try {
    await del(`/feeds/${id}`);
    showToast('已删除');
    feedsCache = null;
    loadFeeds();
  } catch (e) {
    showToast('删除失败: ' + e.message, 'error');
  }
}

// ─── HTTP Helpers ─────────────────────────────────────────────────────────────

async function get(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function post(path, body) {
  const opts = { method: 'POST' };
  if (body) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(API + path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function put(path, body) {
  const res = await fetch(API + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function del(path) {
  const res = await fetch(API + path, { method: 'DELETE' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function showToast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium shadow-lg transition-all fade-in ${
    type === 'error' ? 'bg-red-500 text-white' : 'bg-gray-900 text-white'
  }`;
  const icon = type === 'error' ? '✗' : '✓';
  el.innerHTML = `<span>${icon}</span> ${msg}`;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3000);
}

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Init ─────────────────────────────────────────────────────────────────────

showPage('tasks');
