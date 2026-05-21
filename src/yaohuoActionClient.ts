import type { YaohuoActionRequest } from './yaohuoActions';
import { type Fetcher } from './request';

const YAOHUO_BASE_URL = 'https://yaohuo.me';
const YAOHUO_LOGIN_URL = `${YAOHUO_BASE_URL}/waplogin.aspx?siteid=1000`;
const YAOHUO_ACTION_HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  origin: YAOHUO_BASE_URL,
  referer: `${YAOHUO_BASE_URL}/bbs/`,
  'sec-ch-ua': '"Chromium";v="125", "Not.A/Brand";v="24"',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"Android"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'same-origin',
  'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36'
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

function isVerificationHtml(html: string) {
  return /访问验证|ImageCaptcha|Gocaptcha|CAPTCHA_CONFIG|请开启JavaScript并刷新该页/i.test(html);
}

function isLoginHtml(html: string, responseUrl = '') {
  const visibleText = html.replace(/<[^>]*>/g, ' ');
  return /waplogin\.aspx/i.test(responseUrl)
    || /身份失效了，请重新登录网站|请先登录网站/.test(html)
    || /请先\s+登录/.test(visibleText);
}

function textFromHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function actionMessage(html: string) {
  const tip = String(html || '').match(/<[^>]*class=["'][^"']*tip[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1];
  const text = textFromHtml(tip || html);
  if (text.length > 80) {
    return '操作已提交';
  }
  return text || '操作已提交';
}

export async function runYaohuoAction({
  cookieHeader,
  request,
  fetcher = fetch
}: {
  cookieHeader: string;
  request: YaohuoActionRequest;
  fetcher?: Fetcher;
}) {
  const cleanCookie = cookieHeader.trim();
  if (!cleanCookie) {
    throw yaohuoLoginRequiredError('expired');
  }

  const response = await fetcher(`${YAOHUO_BASE_URL}${request.path}`, {
    method: request.method,
    headers: {
      ...YAOHUO_ACTION_HEADERS,
      ...request.headers,
      cookie: cleanCookie
    },
    body: request.method === 'POST' ? request.body : undefined
  });
  const html = await response.text();
  const responseUrl = response.url || '';

  if (isVerificationHtml(html)) {
    throw yaohuoLoginRequiredError('verification');
  }
  if (isLoginHtml(html, responseUrl)) {
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
