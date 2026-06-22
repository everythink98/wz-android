import type { YaohuoActionRequest } from './yaohuoActions';
import { fetchWithTimeout, type Fetcher } from './request';
import { elementText, parseHtml, textContentFromHtml } from './localHtml';
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
const YAOHUO_ACTION_FAILURE_PATTERN = /(失败|权限不足|请勿重复|重复提交|错误|禁止|无权|不允许|请选择|不能为空|未成功)/;

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
  const tip = parseHtml(html).querySelector('.tip');
  const text = tip ? elementText(tip) : textContentFromHtml(html);
  if (tip) {
    assertYaohuoActionSuccess(text);
  }
  if (!tip && text.length > 80) {
    return '操作结果无法确认，请刷新原帖核对';
  }
  assertYaohuoActionSuccess(text);
  if (text.length > 80) {
    return '操作已提交';
  }
  return text || '操作已提交';
}

function assertYaohuoActionSuccess(message: string) {
  if (YAOHUO_ACTION_FAILURE_PATTERN.test(message)) {
    throw new Error(message);
  }
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

  const message = actionMessage(html);
  return { ok: true, message };
}
