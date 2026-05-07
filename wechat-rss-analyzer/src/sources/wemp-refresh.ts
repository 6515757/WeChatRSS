import { config } from '../config';

// 登录 we-mp-rss 获取 token
async function getToken(): Promise<string> {
  const res = await fetch(`${config.weMpRss.url}/api/v1/wx/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      username: config.weMpRss.user,
      password: config.weMpRss.password,
    }).toString(),
  });

  if (!res.ok) {
    throw new Error(`we-mp-rss login failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as any;
  const token = data.data?.access_token || data.access_token || data.token;
  if (!token) {
    throw new Error('we-mp-rss login: no token in response');
  }
  return token;
}

// 获取所有订阅的公众号列表
async function getMpList(token: string): Promise<Array<{ mp_id: string; mp_name: string }>> {
  const res = await fetch(`${config.weMpRss.url}/api/v1/wx/mps`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`get mp list failed: ${res.status}`);
  }

  const data = (await res.json()) as any;
  const items = data.data?.list || data.data?.items || data.data || data.items || data || [];
  return items.map((item: any) => ({
    mp_id: item.mp_id || item.id || '',
    mp_name: item.mp_name || item.name || '',
  }));
}

// 触发单个公众号刷新
async function refreshMp(token: string, mpId: string): Promise<boolean> {
  const res = await fetch(`${config.weMpRss.url}/api/v1/wx/mps/update/${mpId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok;
}

// 触发所有公众号刷新文章
export async function refreshAllMps(): Promise<{
  total: number;
  success: number;
  failed: number;
}> {
  console.log('[Refresh] 开始触发 we-mp-rss 刷新...');

  const token = await getToken();
  const mpList = await getMpList(token);

  if (mpList.length === 0) {
    console.log('[Refresh] 没有订阅的公众号');
    return { total: 0, success: 0, failed: 0 };
  }

  console.log(`[Refresh] 共 ${mpList.length} 个公众号需要刷新`);

  let success = 0;
  let failed = 0;

  for (const mp of mpList) {
    try {
      const ok = await refreshMp(token, mp.mp_id);
      if (ok) {
        success++;
        console.log(`[Refresh] ✓ ${mp.mp_name}`);
      } else {
        failed++;
        console.log(`[Refresh] ✗ ${mp.mp_name} (请求失败)`);
      }
      // 间隔 2 秒，避免请求过快
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      failed++;
      console.error(`[Refresh] ✗ ${mp.mp_name}`, err);
    }
  }

  console.log(`[Refresh] 完成: success=${success} failed=${failed}`);
  return { total: mpList.length, success, failed };
}

// 自动同步 we-mp-rss 的公众号到 analyzer 的 feeds 表
export async function syncFeedsFromWeMpRss(): Promise<{
  total: number;
  added: number;
  existing: number;
}> {
  const { eq } = await import('drizzle-orm');
  const { v4: uuidv4 } = await import('uuid');
  const { getDb, saveDatabaseSync } = await import('../db');
  const { feeds } = await import('../db/schema');

  console.log('[Sync] 同步 we-mp-rss 公众号到 feeds...');

  const token = await getToken();
  const mpList = await getMpList(token);

  if (mpList.length === 0) {
    console.log('[Sync] we-mp-rss 没有订阅的公众号');
    return { total: 0, added: 0, existing: 0 };
  }

  const db = getDb();
  let added = 0;
  let existing = 0;

  for (const mp of mpList) {
    const rssUrl = `${config.weMpRss.url}/rss/${mp.mp_id}`;

    // 检查是否已存在（按 URL 匹配）
    const existingFeed = await db
      .select({ id: feeds.id })
      .from(feeds)
      .where(eq(feeds.url, rssUrl))
      .limit(1);

    if (existingFeed.length > 0) {
      existing++;
      continue;
    }

    // 添加新的 feed
    await db.insert(feeds).values({
      id: uuidv4(),
      name: mp.mp_name,
      url: rssUrl,
      sourceType: 'we-mp-rss',
      enabled: true,
      createdAt: new Date().toISOString(),
    });
    added++;
    console.log(`[Sync] + ${mp.mp_name}`);
  }

  saveDatabaseSync();
  console.log(`[Sync] 完成: total=${mpList.length} added=${added} existing=${existing}`);
  return { total: mpList.length, added, existing };
}
