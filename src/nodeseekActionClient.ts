import { nodeSeekActionErrorMessage, type NodeSeekActionRequest } from './nodeseekActions';

const NODESEEK_BASE_URL = 'https://www.nodeseek.com';
const NODESEEK_ACTION_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'content-type': 'application/json',
  origin: NODESEEK_BASE_URL,
  referer: `${NODESEEK_BASE_URL}/`,
  'sec-ch-ua': '"Chromium";v="125", "Not.A/Brand";v="24"',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"Android"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
  'x-csrf-challenge': 'simple-token',
  'x-requested-with': 'XMLHttpRequest'
};

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export async function runNodeSeekAction({
  cookieHeader,
  request,
  fetcher = fetch
}: {
  cookieHeader: string;
  request: NodeSeekActionRequest;
  fetcher?: Fetcher;
}) {
  const cleanCookie = cookieHeader.trim();
  if (!cleanCookie) {
    throw new Error('请先检测 NodeSeek 登录');
  }

  const response = await fetcher(`${NODESEEK_BASE_URL}${request.path}`, {
    method: request.method,
    headers: {
      ...NODESEEK_ACTION_HEADERS,
      ...request.headers,
      cookie: cleanCookie
    },
    body: request.body
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(nodeSeekActionErrorMessage(data, response.status));
  }

  return data;
}
