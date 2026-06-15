import type { YaohuoActionRequest } from './yaohuoActions';
import { fetchWithTimeout, type Fetcher } from './request';
import { textContentFromHtml } from './localHtml';
import { isYaohuoLoginRequiredHtml, isYaohuoVerificationRequiredHtml } from './localYaohuo';
import {
  YAOHUO_ANDROID_USER_AGENT,
  YAOHUO_BASE_URL,
  YAOHUO_BBS_REFERER,
  YAOHUO_LOGIN_URL
} from './localYaohuoHelpers';

const YAOHUO_ACTION_HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  origin: YAOHUO_BASE_URL,
  referer: YAOHUO_BBS_REFERER,
  'sec-ch-ua': '"Chromium";v="125", "Not.A/Brand";v="24"',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"Android"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'same-origin',
  'user-agent': YAOHUO_ANDROID_USER_AGENT
};

function yaohuoLoginRequiredError(reason: 'expired' | 'verification' = 'expired') {
  const error = new Error(
    reason === 'verification'
      ? '妖火需要完成访问验证，请在登录页完成验证后重试'
      : '妖火登录已失效，请重新登录'
  );
  Object.assign(error, {
    source: 'yaohuo',
    loginRequired: true,
    reason,
    loginUrl: YAOHUO_LOGIN_URL
  });
  return error;
}

function actionMessage(html: string) {
  const tip = String(html || '').match(/<[^>]*class=["'][^"']*tip[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
  const text = textContentFromHtml(tip?.[1] || html);
  if (!tip && text.length > 80) {
    return '操作结果无法确认，请刷新原帖核对';
  }
  if (text.length > 80) {
    return '操作已提交';
  }
  return text || '操作已提交';
}

export async function runYaohuoAction({
  cookieHeader,
  request,
  fetcher = fetch,
  signal,
  timeoutMs
}: {
  cookieHeader: string;
  request: YaohuoActionRequest;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  const cleanCookie = cookieHeader.trim();
  if (!cleanCookie) {
    throw yaohuoLoginRequiredError('expired');
  }

  const response = await fetchWithTimeout(`${YAOHUO_BASE_URL}${request.path}`, {
    method: request.method,
    headers: {
      ...YAOHUO_ACTION_HEADERS,
      ...request.headers,
      cookie: cleanCookie
    },
    body: request.method === 'POST' ? request.body : undefined
  }, {
    fetcher,
    signal,
    timeoutMs
  });
  const html = await response.text();
  const responseUrl = response.url || '';

  if (isYaohuoVerificationRequiredHtml(html)) {
    throw yaohuoLoginRequiredError('verification');
  }
  if (isYaohuoLoginRequiredHtml(html, responseUrl)) {
    throw yaohuoLoginRequiredError('expired');
  }
  if (!response.ok) {
    throw new Error(`妖火请求失败：HTTP ${response.status}`);
  }

  return {
    ok: true,
    message: actionMessage(html)
  };
}
