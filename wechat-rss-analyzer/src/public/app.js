const API = '/api';
let currentPage = 'tasks';
let articlePage = 1;
let articleKeyword = '';
let articleFeedId = '';
let statusPollTimer = null;

function showPage(page) {
  ['tasks', 'articles', 'search', 'digests', 'feeds'].forEach(p => {
    const pageEl = document.getElementById('page-' + p);
    if (pageEl) pageEl.classList.add('hidden');
    const navEl = document.getElementById('nav-' + p);
    if (navEl) navEl.classList.remove('active');
  });
  document.getElementById('page-' + page).classList.remove('hidden');
  document.getElementById('nav-' + page).classList.add('active');
  currentPage = page;

  const mainEl = document.querySelector('main.main-content');
  if (mainEl) {
    if (page === 'articles' || page === 'search') { mainEl.classList.add('overflow-hidden'); mainEl.classList.remove('overflow-y-auto'); }
    else { mainEl.classList.remove('overflow-hidden'); mainEl.classList.add('overflow-y-auto'); }
  }

  if (page === 'tasks') { refreshStatus(); startStatusPoll(); }
  else { stopStatusPoll(); }
  if (page === 'articles') { ensureFeedSidebar(); loadArticles(); }
  if (page === 'digests') loadDigests();
  if (page === 'feeds') loadFeeds();
}

function startStatusPoll() { stopStatusPoll(); statusPollTimer = setInterval(refreshStatus, 5000); }
function stopStatusPoll() { if (statusPollTimer) { clearInterval(statusPollTimer); statusPollTimer = null; } }
async function refreshStatus() {
  try { const data = await get('/tasks/status'); renderPipelineProgress(data.pipeline); } catch (e) {}
}

async function runPipeline() {
  const btn = document.getElementById('btn-pipeline');
  btn.disabled = true; btn.textContent = '运行中...';
  try { await post('/tasks/pipeline'); showToast('流水线已启动 ✏️'); startPipelinePoll(); }
  catch (e) { showToast('启动失败: ' + e.message, 'error'); btn.disabled = false; btn.textContent = '执行'; }
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
        btn.disabled = false; btn.textContent = '执行';
      }
    } catch (e) {}
  }, 2000);
}
function stopPipelinePoll() { if (pipelinePollTimer) { clearInterval(pipelinePollTimer); pipelinePollTimer = null; } }

const STEP_LABELS = { refresh: '刷新', sync: '同步', fetch: '抓取', analyze: '分析', email: '邮件' };
const STEP_ORDER = ['refresh', 'sync', 'fetch', 'analyze', 'email'];

function renderPipelineProgress(ps) {
  const el = document.getElementById('pipeline-status');
  if (!el) return;
  if (!ps) { el.classList.add('hidden'); return; }
  if (ps.running && (!ps.lastResult || !ps.lastResult.steps || ps.lastResult.steps.length === 0)) {
    el.classList.remove('hidden'); el.innerHTML = renderStepTimeline([], true); return;
  }
  if (ps.running && ps.lastResult && ps.lastResult.steps) {
    el.classList.remove('hidden'); el.innerHTML = renderStepTimeline(ps.lastResult.steps, true); return;
  }
  if (!ps.running && ps.lastResult) {
    if (ps.lastResult.error) { el.classList.remove('hidden'); el.innerHTML = '<span style="opacity:0.9;">✗ ' + escHtml(String(ps.lastResult.error).slice(0, 120)) + '</span>'; return; }
    if (ps.lastResult.steps) { el.classList.remove('hidden'); el.innerHTML = renderStepTimeline(ps.lastResult.steps, false); return; }
  }
  el.classList.add('hidden');
}

function renderStepTimeline(completedSteps, isRunning) {
  const doneMap = {};
  completedSteps.forEach(s => { doneMap[s.step] = s; });
  let currentStep = null;
  if (isRunning) currentStep = STEP_ORDER.find(s => !doneMap[s]) || null;
  const pillStyle = 'display:inline-flex;align-items:center;gap:4px;padding:2px 10px;font-family:Kalam,sans-serif;font-weight:700;border:2px solid currentColor;border-radius:14px 5px 16px 6px / 6px 14px 5px 16px;';
  const parts = STEP_ORDER.map(step => {
    const done = !!doneMap[step];
    const active = step === currentStep;
    const label = STEP_LABELS[step] || step;
    const title = done ? stepDetail(step, doneMap[step]) : '';
    const titleAttr = title ? ' title="' + escHtml(title) + '"' : '';
    if (done) return '<span style="' + pillStyle + 'color:#d5f0c7;"' + titleAttr + '>✓ ' + label + '</span>';
    if (active) return '<span style="' + pillStyle + 'color:#fff9c4;"><span class="spinner">⟳</span> ' + label + '</span>';
    return '<span style="' + pillStyle + 'color:rgba(253,251,247,0.4);">' + label + '</span>';
  });
  return '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;">' + parts.join('<span style="opacity:0.4;margin:0 6px;">~~</span>') + '</div>';
}

function stepDetail(step, s) {
  if (!s) return '';
  if (step === 'refresh') return (s.success || 0) + '/' + (s.total || 0) + ' 个公众号';
  if (step === 'sync') return '新增 ' + (s.added || 0) + '，已有 ' + (s.existing || 0);
  if (step === 'fetch') {
    const reasonMap = { 'all-ready': '全部正文齐', 'no-progress': '无进展放弃', 'timeout': '超时' };
    const reason = reasonMap[s.reason] || (s.reason || '');
    const parts = ['新增 ' + (s.newArticles || 0) + ' 篇'];
    if (s.rounds) parts.push(s.rounds + ' 轮抓取');
    if (s.stillShort) parts.push('仍缺 ' + s.stillShort + ' 篇正文');
    if (reason) parts.push(reason);
    return parts.join(' · ');
  }
  if (step === 'analyze') return '成功 ' + (s.success || 0) + '，失败 ' + (s.failed || 0);
  if (step === 'email') return s.sent ? '已发送' : '';
  return '';
}

let feedsCache = null;
async function ensureFeedSidebar() {
  if (feedsCache) { renderFeedSidebar(); return; }
  const panel = document.getElementById('article-feeds-panel');
  if (!panel) return;
  try {
    const data = await get('/feeds');
    feedsCache = data.feeds || data.data || data || [];
    renderFeedSidebar();
  } catch (e) {
    panel.innerHTML = '<div class="text-red-500 text-xs px-3 py-4">加载失败: ' + escHtml(e.message) + '</div>';
  }
}

function renderFeedSidebar() {
  const panel = document.getElementById('article-feeds-panel');
  if (!panel || !feedsCache) return;
  const active = articleFeedId || '';
  const allItem =
    '<div class="feed-item ' + (active === '' ? 'active' : '') + '" onclick="selectFeed(\'\')">' +
    '<div class="avatar" style="background:#2d2d2d;">全</div><span>全部</span></div>';
  const items = feedsCache.map((f) => {
    const cls = active === f.id ? 'active' : '';
    const initial = (f.name || '·').slice(0, 1);
    return '<div class="feed-item ' + cls + '" onclick="selectFeed(\'' + escHtml(f.id) + '\')" title="' + escHtml(f.name) + '">' +
      '<div class="avatar">' + escHtml(initial) + '</div>' +
      '<span class="truncate" style="min-width:0;overflow:hidden;text-overflow:ellipsis;">' + escHtml(f.name) + '</span>' +
      '</div>';
  }).join('');
  panel.innerHTML = '<div class="space-y-1">' + allItem + items + '</div>';
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

async function loadArticles(page) {
  if (page == null) page = articlePage;
  articlePage = page;
  const el = document.getElementById('articles-list');
  el.innerHTML = '<div class="text-sm opacity-50 text-center py-8">加载中...</div>';
  try {
    const params = new URLSearchParams({ page, pageSize: 20 });
    if (articleKeyword) params.set('keyword', articleKeyword);
    if (articleFeedId) params.set('feedId', articleFeedId);
    const data = await get('/articles?' + params);
    const articles = data.articles || data.data || data || [];
    const total = data.total || articles.length;

    const titleEl = document.getElementById('articles-header-title');
    const subEl = document.getElementById('articles-header-sub');
    if (titleEl) {
      if (articleFeedId && feedsCache) {
        const f = feedsCache.find(x => x.id === articleFeedId);
        titleEl.textContent = f ? f.name : '未知公众号';
      } else { titleEl.textContent = '全部公众号'; }
    }
    if (subEl) subEl.textContent = '共 ' + total + ' 篇';

    if (articles.length === 0) {
      el.innerHTML = '<div class="text-sm opacity-50 text-center py-16">暂无文章</div>';
      document.getElementById('articles-pagination').innerHTML = '';
      return;
    }
    el.innerHTML = articles.map(a => renderArticleCard(a)).join('');
    const totalPages = Math.ceil(total / 20);
    renderPagination(page, totalPages);
  } catch (e) {
    el.innerHTML = '<div class="text-red-500 text-sm text-center py-8">加载失败: ' + escHtml(e.message) + '</div>';
  }
}

function renderArticleCard(a) {
  const hasAnalysis = a.analysis || a.analysisId || a.hasAnalysis;
  const score = (a.analysis && a.analysis.importanceScore != null) ? a.analysis.importanceScore : a.importanceScore;
  const scoreCls = score >= 7 ? '' : (score >= 5 ? 'score-mid' : 'score-low');
  const summary = a.summary || (a.analysis && a.analysis.summary) || '';
  let statusBadge;
  if (summary === 'Content unavailable') statusBadge = '<span class="badge badge-none">无正文</span>';
  else if (summary === 'Analysis failed') statusBadge = '<span class="badge badge-fail">分析失败</span>';
  else if (hasAnalysis) statusBadge = '<span class="badge badge-ok">✓ 已分析</span>';
  else statusBadge = '<span class="badge badge-postit">未分析</span>';

  const feedName = a.feedName || (a.feed && a.feed.name) || '';
  const dateStr = a.publishedAt ? new Date(a.publishedAt).toLocaleDateString('zh-CN') : '';
  const scoreHtml = score != null ? '<span class="score-stamp ' + scoreCls + ' flex-shrink-0">' + Number(score).toFixed(1) + '</span>' : '';

  return '<div class="article-card" data-article-id="' + escHtml(a.id) + '" onclick="toggleArticle(this)">' +
    '<div class="flex items-start justify-between gap-3">' +
      '<div class="flex-1 min-w-0">' +
        '<div class="flex items-center gap-2">' +
          '<svg class="chevron flex-shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>' +
          '<span class="font-marker text-base line-clamp-1">' + escHtml(a.title) + '</span>' +
        '</div>' +
        '<div class="flex items-center gap-3 mt-1 ml-[18px] flex-wrap">' +
          '<span class="text-xs opacity-70">' + escHtml(feedName) + '</span>' +
          '<span class="text-xs opacity-50">' + dateStr + '</span>' +
          statusBadge +
        '</div>' +
      '</div>' +
      scoreHtml +
    '</div>' +
    '<div class="article-detail ml-[18px]">' +
      '<div class="pt-3 mt-3 border-t-2 border-dashed border-ink/30 article-detail-body">' +
        '<div class="text-xs opacity-50">展开加载...</div>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function renderPagination(current, total) {
  const el = document.getElementById('articles-pagination');
  if (total <= 1) { el.innerHTML = ''; return; }
  const pages = [];
  for (let i = Math.max(1, current - 2); i <= Math.min(total, current + 2); i++) pages.push(i);
  el.innerHTML = [
    current > 1 ? '<button class="btn btn-xs" onclick="loadArticles(' + (current - 1) + ')">‹</button>' : '',
    ...pages.map(p => '<button class="btn btn-xs ' + (p === current ? 'btn-primary' : 'btn-secondary') + '" onclick="loadArticles(' + p + ')">' + p + '</button>'),
    current < total ? '<button class="btn btn-xs" onclick="loadArticles(' + (current + 1) + ')">›</button>' : '',
  ].join('');
}

const articleDetailCache = {};
async function toggleArticle(cardEl) {
  if (!cardEl) return;
  const id = cardEl.dataset.articleId;
  const willOpen = !cardEl.classList.contains('open');
  document.querySelectorAll('.article-card.open').forEach(el => { if (el !== cardEl) el.classList.remove('open'); });
  cardEl.classList.toggle('open', willOpen);
  if (!willOpen) return;
  const body = cardEl.querySelector('.article-detail-body');
  if (!body) return;
  if (articleDetailCache[id]) { body.innerHTML = articleDetailCache[id]; return; }
  body.innerHTML = '<div class="text-xs opacity-50">加载中...</div>';
  try {
    const data = await get('/articles/' + encodeURIComponent(id));
    const html = renderArticleDetail(data);
    articleDetailCache[id] = html;
    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = '<div class="text-xs text-red-500">加载失败: ' + escHtml(e.message) + '</div>';
  }
}

function renderArticleDetail(a) {
  const an = a.analysis;
  const readMore = '<a href="' + escHtml(a.url) + '" target="_blank" class="text-sm inline-block mt-3" style="color:#2d5da1;border-bottom:2px dashed #2d5da1;">阅读原文 →</a>';
  if (!an) return '<div class="analysis-section"><div class="opacity-70">暂未生成分析。</div>' + readMore + '</div>';
  if (an.summary === 'Content unavailable') return '<div class="analysis-section"><div class="opacity-70">RSS 源没有提供正文，无法生成分析。</div>' + readMore + '</div>';
  if (an.summary === 'Analysis failed') {
    const raw = an.rawResponse ? String(an.rawResponse) : '';
    const details = raw ? '<details class="text-xs opacity-70"><summary class="cursor-pointer">错误详情</summary><pre class="whitespace-pre-wrap mt-2 p-3" style="border:2px dashed #ff4d4d;border-radius:14px 5px 16px 6px / 6px 14px 5px 16px;background:#fff9c4;">' + escHtml(raw.slice(0, 2000)) + '</pre></details>' : '';
    return '<div class="analysis-section"><div style="color:#ff4d4d;" class="mb-2 font-marker">LLM 分析失败</div>' + details + readMore + '</div>';
  }
  const topics = Array.isArray(an.topics) ? an.topics : [];
  const keyPoints = Array.isArray(an.keyPoints) ? an.keyPoints : [];
  let keyData = an.keyData;
  if (typeof keyData === 'string') { try { keyData = JSON.parse(keyData); } catch { keyData = []; } }
  if (!Array.isArray(keyData)) keyData = [];
  const topicsHtml = topics.length ? '<div class="mb-3">' + topics.map(t => '<span class="topic-chip">' + escHtml(t) + '</span>').join('') + '</div>' : '';
  const summaryHtml = an.summary ? '<div class="mb-3"><span class="label">核心内容</span>' + escHtml(an.summary) + '</div>' : '';
  const keyPointsHtml = keyPoints.length ? '<div class="mb-3"><span class="label">关键观点</span><ul class="key-list">' + keyPoints.map(p => '<li>' + escHtml(p) + '</li>').join('') + '</ul></div>' : '';
  const keyDataHtml = keyData.length ? '<div class="mb-3"><span class="label">关键数据</span><ul class="key-list">' + keyData.map(p => '<li>' + escHtml(p) + '</li>').join('') + '</ul></div>' : '';
  const scoreHtml = an.importanceScore != null ? '<div class="mb-3"><span class="label">重要性</span>' + Number(an.importanceScore).toFixed(1) + ' / 10</div>' : '';
  return '<div class="analysis-section">' + topicsHtml + summaryHtml + keyPointsHtml + keyDataHtml + scoreHtml + readMore + '</div>';
}

let digestPage = 1;
async function loadDigests(page) {
  if (page == null) page = 1;
  digestPage = page;
  const el = document.getElementById('digests-list');
  el.innerHTML = '<div class="text-sm opacity-50 text-center py-8">加载中...</div>';
  try {
    const params = new URLSearchParams({ page, pageSize: 20 });
    const data = await get('/digests?' + params);
    const items = data.data || [];
    const total = data.total || items.length;
    document.getElementById('digests-count').textContent = total > 0 ? ('共 ' + total + ' 封') : '';
    if (items.length === 0) {
      el.innerHTML = '<div class="text-sm opacity-50 text-center py-16">暂无已发送的邮件</div>';
      document.getElementById('digests-pagination').innerHTML = '';
      return;
    }
    el.innerHTML = items.map((d, i) => {
      const rot = (i % 2 === 0) ? '-rotate-1' : 'rotate-1';
      return '<div class="paper tack p-5 ' + rot + '" style="cursor:pointer;" onclick="openDigest(\'' + escHtml(d.id) + '\')">' +
        '<div class="flex items-center justify-between gap-3">' +
          '<div class="min-w-0 flex-1">' +
            '<div class="font-marker text-lg truncate">' + escHtml(d.subject) + '</div>' +
            '<div class="text-xs opacity-70 mt-2 flex items-center gap-2 flex-wrap">' +
              '<span>' + new Date(d.sentAt).toLocaleString('zh-CN') + '</span>' +
              '<span class="badge badge-postit">' + d.articleCount + ' 篇</span>' +
              '<span class="badge">' + d.feedCount + ' 个公众号</span>' +
              '<span class="opacity-50">→ ' + escHtml(d.recipient || '') + '</span>' +
            '</div>' +
          '</div>' +
          '<span style="color:#ff4d4d;font-family:Kalam,sans-serif;font-weight:700;font-size:1.4rem;">→</span>' +
        '</div>' +
      '</div>';
    }).join('');

    const totalPages = Math.ceil(total / 20);
    const pEl = document.getElementById('digests-pagination');
    if (totalPages <= 1) { pEl.innerHTML = ''; return; }
    const pages = [];
    for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i++) pages.push(i);
    pEl.innerHTML = [
      page > 1 ? '<button class="btn btn-xs" onclick="loadDigests(' + (page - 1) + ')">‹</button>' : '',
      ...pages.map(p => '<button class="btn btn-xs ' + (p === page ? 'btn-primary' : 'btn-secondary') + '" onclick="loadDigests(' + p + ')">' + p + '</button>'),
      page < totalPages ? '<button class="btn btn-xs" onclick="loadDigests(' + (page + 1) + ')">›</button>' : '',
    ].join('');
  } catch (e) {
    el.innerHTML = '<div class="text-red-500 text-sm text-center py-8">加载失败: ' + escHtml(e.message) + '</div>';
  }
}

async function openDigest(id) {
  try {
    const data = await get('/digests/' + encodeURIComponent(id));
    document.getElementById('digest-modal-title').textContent = data.subject || '邮件';
    const sub = [];
    if (data.sentAt) sub.push(new Date(data.sentAt).toLocaleString('zh-CN'));
    if (data.articleCount != null) sub.push(data.articleCount + ' 篇');
    if (data.feedCount != null) sub.push(data.feedCount + ' 个公众号');
    if (data.recipient) sub.push('→ ' + data.recipient);
    document.getElementById('digest-modal-sub').textContent = sub.join(' · ');
    document.getElementById('digest-modal-iframe').src = '/api/digests/' + encodeURIComponent(id) + '/html';
    document.getElementById('digest-modal').classList.remove('hidden');
  } catch (e) { showToast('打开失败: ' + e.message, 'error'); }
}

function closeDigestModal() {
  document.getElementById('digest-modal').classList.add('hidden');
  document.getElementById('digest-modal-iframe').src = 'about:blank';
}

async function loadFeeds() {
  const el = document.getElementById('feeds-list');
  el.innerHTML = '<div class="text-sm opacity-50 text-center py-8">加载中...</div>';
  try {
    const data = await get('/feeds');
    const feeds = data.feeds || data.data || data || [];
    if (feeds.length === 0) {
      el.innerHTML = '<div class="text-sm opacity-50 text-center py-16">暂无订阅源，点击右上角添加</div>';
      return;
    }
    el.innerHTML = feeds.map((f, i) => {
      const rot = (i % 2 === 0) ? '-rotate-1' : 'rotate-1';
      const enabledBadge = f.enabled ? '<span class="badge badge-ok">启用</span>' : '<span class="badge badge-none">停用</span>';
      return '<div class="paper p-5 ' + rot + '">' +
        '<div class="flex items-center justify-between gap-3 flex-wrap">' +
          '<div class="flex-1 min-w-0">' +
            '<div class="flex items-center gap-2 flex-wrap">' +
              '<span class="font-marker text-lg">' + escHtml(f.name) + '</span>' +
              enabledBadge +
            '</div>' +
            '<div class="text-xs opacity-60 mt-1 truncate">' + escHtml(f.url) + '</div>' +
            (f.titleFilter ? '<div class="text-xs mt-1" style="color:#2d5da1;">过滤: ' + escHtml(f.titleFilter) + '</div>' : '') +
            '<div class="text-xs opacity-50 mt-1">最后抓取: ' + (f.lastFetchedAt ? new Date(f.lastFetchedAt).toLocaleString('zh-CN') : '从未') + '</div>' +
          '</div>' +
          '<div class="flex gap-2 flex-shrink-0">' +
            '<button class="btn btn-xs" onclick="toggleFeed(\'' + escHtml(f.id) + '\', ' + (!f.enabled) + ')">' + (f.enabled ? '停用' : '启用') + '</button>' +
            '<button class="btn btn-xs btn-danger" onclick="deleteFeed(\'' + escHtml(f.id) + '\', \'' + escHtml(f.name) + '\')">删除</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  } catch (e) {
    el.innerHTML = '<div class="text-red-500 text-sm text-center py-8">加载失败: ' + escHtml(e.message) + '</div>';
  }
}

function showAddFeed() { document.getElementById('feed-modal').classList.remove('hidden'); }
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
  } catch (e) { showToast('添加失败: ' + e.message, 'error'); }
}

async function toggleFeed(id, enabled) {
  try { await put('/feeds/' + id, { enabled }); feedsCache = null; loadFeeds(); }
  catch (e) { showToast('操作失败: ' + e.message, 'error'); }
}

async function deleteFeed(id, name) {
  if (!confirm('确认删除订阅源「' + name + '」？相关文章也会被删除。')) return;
  try { await del('/feeds/' + id); showToast('已删除'); feedsCache = null; loadFeeds(); }
  catch (e) { showToast('删除失败: ' + e.message, 'error'); }
}

async function get(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function post(path, body) {
  const opts = { method: 'POST' };
  if (body) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
  const res = await fetch(API + path, opts);
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || ('HTTP ' + res.status)); }
  return res.json();
}

async function put(path, body) {
  const res = await fetch(API + path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function del(path) {
  const res = await fetch(API + path, { method: 'DELETE' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

function showToast(msg, type) {
  if (!type) type = 'success';
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast fade-in ' + (type === 'error' ? 'toast-error' : '');
  const icon = type === 'error' ? '✗' : '✓';
  el.innerHTML = '<span style="font-weight:700;margin-right:6px;">' + icon + '</span>' + escHtml(msg);
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3000);
}

function escHtml(str) {
  return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

showPage('tasks');

// ─── Search (主题搜索) ────────────────────────────────────────────────────────

let searchRunning = false;

async function runSearch() {
  if (searchRunning) return;
  const qEl = document.getElementById('search-query');
  const dEl = document.getElementById('search-days');
  const query = (qEl.value || '').trim();
  const days = parseInt(dEl.value || '30', 10);
  if (!query) { showToast('请输入搜索主题', 'error'); return; }

  const btn = document.getElementById('btn-search');
  const emptyEl = document.getElementById('search-empty');
  const splitEl = document.getElementById('search-split');
  const feedsPanel = document.getElementById('search-feeds-panel');
  const contentEl = document.getElementById('search-content');
  const metaEl = document.getElementById('search-meta');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner">⟳</span> 搜索中...';
  emptyEl.classList.add('hidden');
  splitEl.classList.remove('hidden');
  feedsPanel.innerHTML = '<div class="text-xs opacity-50 text-center py-8">AI 正在翻阅...</div>';
  contentEl.innerHTML = '<div class="paper p-6 text-sm opacity-70 -rotate-1">AI 正在翻阅最近 ' + days + ' 天的文章，找和「' + escHtml(query) + '」有关的内容...</div>';
  metaEl.textContent = '搜索中...';
  searchRunning = true;

  try {
    const res = await fetch(API + '/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, days }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || ('HTTP ' + res.status));
    }
    const data = await res.json();
    renderSearchResult(data);
  } catch (e) {
    feedsPanel.innerHTML = '';
    contentEl.innerHTML = '<div class="paper p-6 text-red-500">搜索失败: ' + escHtml(e.message) + '</div>';
    metaEl.textContent = '';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🔍 搜索';
    searchRunning = false;
  }
}

// 当前搜索数据缓存在前端（供点公众号切换）
let _lastSearch = null;
let _searchView = 'overview'; // 'overview' | 'all' | 'feed:<feedId>'

function renderSearchResult(data) {
  _lastSearch = data;
  _searchView = (data.overview ? 'overview' : 'all');

  // Stats in top meta line
  const metaEl = document.getElementById('search-meta');
  const bits = [];
  bits.push('最近 ' + data.days + ' 天');
  bits.push('候选 ' + (data.searched || 0) + ' / ' + (data.totalAnalyzed || 0) + ' 篇');
  bits.push('命中 ' + (data.total || 0) + ' 篇');
  if (data.cached) bits.push('来自缓存');
  if (data.prefiltered) bits.push('已预筛');
  metaEl.innerHTML = '「<span class="font-marker">' + escHtml(data.query) + '</span>」 · ' + bits.join(' · ');

  renderSearchLeft();
  renderSearchRight();
}

function renderSearchLeft() {
  const panel = document.getElementById('search-feeds-panel');
  const subEl = document.getElementById('search-left-sub');
  if (!_lastSearch) { panel.innerHTML = ''; return; }
  const data = _lastSearch;
  subEl.textContent = data.total > 0 ? (data.total + ' 篇 · ' + data.groups.length + ' 个公众号') : '';

  const items = [];

  // 搜索报告入口（只在有 overview 时出现）
  if (data.overview) {
    const cls = _searchView === 'overview' ? 'active' : '';
    items.push(
      '<div class="feed-item ' + cls + '" onclick="selectSearchView(\'overview\')">' +
        '<div class="avatar" style="background:#fff9c4;color:#2d2d2d;border-color:#2d2d2d;">📋</div>' +
        '<span>搜索报告</span>' +
      '</div>'
    );
  }

  // 全部命中
  if ((data.total || 0) > 0) {
    const cls = _searchView === 'all' ? 'active' : '';
    items.push(
      '<div class="feed-item ' + cls + '" onclick="selectSearchView(\'all\')">' +
        '<div class="avatar" style="background:#2d2d2d;">全</div>' +
        '<span>全部命中</span>' +
        '<span class="opacity-50 text-xs ml-auto">' + data.total + '</span>' +
      '</div>'
    );
  }

  // 各公众号
  for (const g of (data.groups || [])) {
    const key = 'feed:' + g.feedId;
    const cls = _searchView === key ? 'active' : '';
    const initial = (g.feedName || '·').slice(0, 1);
    items.push(
      '<div class="feed-item ' + cls + '" onclick="selectSearchView(\'' + escHtml(key) + '\')" title="' + escHtml(g.feedName) + '">' +
        '<div class="avatar">' + escHtml(initial) + '</div>' +
        '<span class="truncate" style="min-width:0;overflow:hidden;text-overflow:ellipsis;">' + escHtml(g.feedName) + '</span>' +
        '<span class="opacity-50 text-xs ml-auto">' + g.articles.length + '</span>' +
      '</div>'
    );
  }

  panel.innerHTML = '<div class="space-y-1">' + items.join('') + '</div>';
}

function selectSearchView(view) {
  _searchView = view;
  renderSearchLeft();
  renderSearchRight();
  // 顶部内容滚回顶
  const rightScroller = document.querySelector('#search-split .flex-1.overflow-y-auto');
  if (rightScroller) rightScroller.scrollTop = 0;
}

function renderSearchRight() {
  const el = document.getElementById('search-content');
  if (!_lastSearch) { el.innerHTML = ''; return; }
  const data = _lastSearch;

  // Overview
  if (_searchView === 'overview') {
    if (!data.overview) {
      el.innerHTML = '<div class="paper p-6 opacity-70">本次搜索没有生成综合报告。</div>';
      return;
    }
    el.innerHTML =
      '<div class="paper postit p-6 -rotate-1">' +
        '<div class="flex items-center gap-2 mb-3">' +
          '<span class="font-marker text-xl">搜索报告</span>' +
          '<span class="text-xs opacity-60">关于「' + escHtml(data.query) + '」 · 最近 ' + data.days + ' 天</span>' +
        '</div>' +
        '<div class="analysis-section" style="font-size:1.05rem;line-height:1.9;">' + escHtml(data.overview) + '</div>' +
        '<div class="text-xs opacity-60 mt-4 pt-3 border-t-2 border-dashed border-ink/30">' +
          '共从 ' + (data.searched || 0) + ' 篇候选中命中 ' + (data.total || 0) + ' 篇，涉及 ' + (data.groups || []).length + ' 个公众号。' +
          '（点左侧切换公众号查看具体文章）' +
        '</div>' +
      '</div>';
    return;
  }

  // 空命中
  if (!data.groups || data.groups.length === 0) {
    el.innerHTML = '<div class="paper p-8 text-center opacity-70">没有命中的文章。换个说法，或者扩大时间范围试试？</div>';
    return;
  }

  // 'all' 或 'feed:<id>'
  let articles = [];
  let headerTitle = '';
  if (_searchView === 'all') {
    // 跨公众号合并，按 matchScore 降序
    const merged = [];
    for (const g of data.groups) for (const a of g.articles) merged.push(a);
    merged.sort((a, b) => (Number(b.matchScore) || 0) - (Number(a.matchScore) || 0));
    articles = merged;
    headerTitle = '全部命中';
  } else if (_searchView.startsWith('feed:')) {
    const fid = _searchView.slice(5);
    const g = data.groups.find(x => x.feedId === fid);
    articles = g ? g.articles : [];
    headerTitle = g ? g.feedName : '未知公众号';
  }

  const head =
    '<header class="flex items-end justify-between gap-3 flex-wrap">' +
      '<h2 class="font-marker text-2xl">' + escHtml(headerTitle) + '</h2>' +
      '<span class="text-xs opacity-60">共 ' + articles.length + ' 篇</span>' +
    '</header>';

  const list = articles.map(a => renderSearchHit(a, _searchView === 'all')).join('');
  el.innerHTML = head + '<div class="space-y-3 mt-4">' + list + '</div>';
}

function renderSearchHit(a, showFeed) {
  const score = Number(a.matchScore || 0);
  const scoreCls = score >= 7 ? '' : (score >= 5 ? 'score-mid' : 'score-low');
  const topics = Array.isArray(a.topics) ? a.topics : [];
  const topicsHtml = topics.length
    ? '<div class="mt-1 mb-1">' + topics.slice(0, 5).map(t => '<span class="topic-chip">' + escHtml(t) + '</span>').join('') + '</div>'
    : '';
  const dateStr = a.publishedAt ? new Date(a.publishedAt).toLocaleDateString('zh-CN') : '';
  const feedSpan = showFeed && a.feedName
    ? '<span class="badge badge-postit mr-1">' + escHtml(a.feedName) + '</span>'
    : '';
  const reason = a.reason ? '<div class="text-xs mt-1" style="color:#2d5da1;"><span class="font-marker mr-1">AI 判断：</span>' + escHtml(a.reason) + '</div>' : '';

  return '<div class="paper-soft p-4">' +
    '<div class="flex items-start justify-between gap-3">' +
      '<div class="flex-1 min-w-0">' +
        '<a href="' + escHtml(a.url) + '" target="_blank" class="font-marker text-base line-clamp-1" style="color:#2d2d2d;border-bottom:2px dashed #2d5da1;">' + escHtml(a.title) + '</a>' +
        '<div class="flex items-center gap-2 mt-1 flex-wrap">' +
          feedSpan +
          '<span class="text-xs opacity-60">' + escHtml(dateStr) + (a.importanceScore != null ? ' · 重要性 ' + Number(a.importanceScore).toFixed(1) : '') + '</span>' +
        '</div>' +
        topicsHtml +
        '<div class="analysis-section mt-2">' + escHtml(a.summary || '') + '</div>' +
        reason +
      '</div>' +
      '<span class="score-stamp ' + scoreCls + ' flex-shrink-0">' + score.toFixed(1) + '</span>' +
    '</div>' +
  '</div>';
}
