import { isRecord, parseHtml } from '@/domain/forum/html';
import { parseForumTopicLink } from '@/domain/forum/links';
import type { CreateTopicInput, CreateTopicResult, TopicCreationContext } from '@/domain/forum/topicComposer';
import { fetchWithTimeout, type Fetcher } from '@/platform/network/request';
import { withBrowserFetchIntent } from '@/platform/network/browserFetchIntent';
import { DEFAULT_NODESEEK_ANDROID_USER_AGENT } from '@/platform/android/nodeSeekUserAgent';
import { NODESEEK_ACTION_HEADERS, runNodeSeekAction } from './actionClient';
import { randomNodeSeekContentToken } from './actionRequest';
import { extractNodeSeekEmbeddedData, NODESEEK_BASE_URL } from './protocol';
import { normalizeCategories } from './feedParser';

type Options = { fetcher: Fetcher; userAgent: string; signal?: AbortSignal };

export async function loadNodeSeekTopicCreationContext({
  fetcher,
  userAgent,
  signal
}: Options): Promise<TopicCreationContext> {
  const response = await fetchWithTimeout(
    `${NODESEEK_BASE_URL}/new-discussion`,
    withBrowserFetchIntent(
      {
        headers: {
          ...NODESEEK_ACTION_HEADERS,
          accept: 'text/html',
          'user-agent': userAgent || DEFAULT_NODESEEK_ANDROID_USER_AGENT
        }
      },
      { owner: 'write', priority: 'write' }
    ),
    { fetcher, signal }
  );
  const html = await response.text();
  const data = extractNodeSeekEmbeddedData(html);
  const user = data && isRecord(data.user) ? data.user : null;
  const rank = user ? Number(user.rank) : NaN;
  if (!response.ok) throw new Error(`NodeSeek 发帖规则读取失败：HTTP ${response.status}`);
  if (!user || !Number.isSafeInteger(rank) || rank < 0 || rank >= 255)
    throw Object.assign(new Error('请重新检测 NodeSeek 登录后读取发帖权限'), {
      source: 'nodeseek',
      loginRequired: true
    });
  const categories = normalizeCategories(data!);
  if (!categories.length) throw new Error('NodeSeek 未返回可发帖版块');
  const title = parseHtml(html).querySelector('input[name="title"]');
  const limit = (name: string) => {
    const value = Number(title?.getAttribute(name));
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  };
  return {
    source: 'nodeseek',
    categories,
    ranks: [...Array.from({ length: rank + 1 }, (_, index) => index), 255],
    insideFee: 5,
    titleMin: limit('minlength'),
    titleMax: limit('maxlength')
  };
}

export async function createNodeSeekTopic({
  input,
  fetcher,
  userAgent,
  signal
}: Options & { input: CreateTopicInput }): Promise<CreateTopicResult> {
  const { draft, body } = input;
  if (
    draft.source !== 'nodeseek' ||
    !draft.title.trim() ||
    !body.trim() ||
    !draft.categoryId ||
    !Number.isSafeInteger(draft.rank) ||
    draft.rank < 0 ||
    draft.rank > 255
  )
    throw new Error('NodeSeek 发帖内容或权限不正确');
  let data: unknown;
  try {
    data = await runNodeSeekAction({
      fetcher,
      userAgent,
      signal,
      request: {
        path: '/api/content/new-discussion',
        method: 'POST',
        headers: {
          referer: `${NODESEEK_BASE_URL}/new-discussion`,
          'csrf-token': randomNodeSeekContentToken()
        },
        body: JSON.stringify({
          content: body,
          mode: 'new-discussion',
          title: draft.title.trim(),
          category: draft.categoryId,
          rank: draft.rank
        })
      }
    });
  } catch (error) {
    if (isRecord(error) && [408, 409].includes(Number(error.status)) && error.serverRejected === false)
      return { status: 'unknown', message: 'NodeSeek 未确认是否已发布，请到原站核对，勿直接重发' };
    if (isRecord(error) && error.serverRejected === true)
      return { status: 'rejected', message: error instanceof Error ? error.message : 'NodeSeek 拒绝了发帖请求' };
    if (error instanceof Error && error.message === 'NodeSeek 返回内容格式不正确')
      return { status: 'unknown', message: 'NodeSeek 返回了无法确认的结果，请到原站核对' };
    throw error;
  }
  if (!isRecord(data) || data.success !== true)
    return { status: 'unknown', message: 'NodeSeek 未返回明确发布结果，请到原站核对' };
  if (data.error || (Array.isArray(data.errors) ? data.errors.length > 0 : data.errors))
    return { status: 'rejected', message: typeof data.error === 'string' ? data.error : 'NodeSeek 拒绝了发帖请求' };
  const linked = typeof data.redirect === 'string' ? parseForumTopicLink(data.redirect, NODESEEK_BASE_URL) : null;
  const topic =
    linked?.source === 'nodeseek' ? { ...linked, title: draft.title.trim(), categoryId: draft.categoryId } : undefined;
  return { status: 'posted', message: '发帖成功', ...(topic ? { topic } : {}) };
}
