import { config } from '../config';

export interface WxSessionStatus {
  valid: boolean;
  expiryTime: string | null;    // ISO or readable string
  remainingSeconds: number;     // 0 if unknown
  remainingDays: number;        // rounded
}

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
  if (!res.ok) throw new Error('we-mp-rss login failed: ' + res.status);
  const data = (await res.json()) as any;
  return data.data?.access_token || data.access_token || data.token || '';
}

export async function getWxSessionStatus(): Promise<WxSessionStatus> {
  try {
    const token = await getToken();
    const res = await fetch(`${config.weMpRss.url}/api/v1/wx/sys/info`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('sys/info failed: ' + res.status);
    const data = (await res.json()) as any;
    const expiry = data?.data?.wx?.info?.expiry;
    if (!expiry) {
      return { valid: false, expiryTime: null, remainingSeconds: 0, remainingDays: 0 };
    }
    const remaining = Number(expiry.remaining_seconds) || 0;
    return {
      valid: remaining > 0,
      expiryTime: expiry.expiry_time || null,
      remainingSeconds: remaining,
      remainingDays: Math.floor(remaining / 86400),
    };
  } catch (err) {
    console.error('[WxStatus] 获取微信 session 状态失败:', err);
    return { valid: false, expiryTime: null, remainingSeconds: 0, remainingDays: 0 };
  }
}
