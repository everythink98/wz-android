import { isRecord } from '@/domain/forum/html';
import {
  type TopicDraft,
  topicEditConflict,
  validateTopicEdit,
  type TopicEditContext,
  type TopicEditResult
} from '@/domain/forum/topicComposer';
import { fetchWithTimeout, type Fetcher } from '@/platform/network/request';
import { withBrowserFetchIntent } from '@/platform/network/browserFetchIntent';
import { NODESEEK_ACTION_HEADERS, runNodeSeekAction } from './actionClient';
import { randomNodeSeekContentToken } from './actionRequest';
import { extractNodeSeekEmbeddedData, nodeSeekEmbeddedUserId, nodeSeekTopicUrl } from './protocol';

type Options = { fetcher: Fetcher; userAgent: string; signal?: AbortSignal };

export async function loadNodeSeekTopicEditContext(
  options: Options & { topicId: string; identityKey: string }
): Promise<TopicEditContext> {
  const { topicId, identityKey, fetcher, signal, userAgent } = options;
  if (!/^\d+$/.test(topicId)) throw new Error('帖子 ID 不正确');
  const response = await fetchWithTimeout(
    nodeSeekTopicUrl(topicId),
    withBrowserFetchIntent(
      {
        headers: {
          ...NODESEEK_ACTION_HEADERS,
          accept: 'text/html',
          'user-agent': userAgent,
          'cache-control': 'no-cache'
        }
      },
      { owner: 'topic', priority: 'foreground' }
    ),
    { fetcher, signal }
  );
  const data = extractNodeSeekEmbeddedData(await response.text());
  const post = isRecord(data?.postData) ? data.postData : {};
  const user = isRecord(data?.user) ? data.user : {};
  const first = Array.isArray(post.comments) && isRecord(post.comments[0]) ? post.comments[0] : {};
  const poster = isRecord(first.poster) ? first.poster : {};
  const rank = Number(user.rank);
  if (
    !response.ok ||
    String(post.postId) !== topicId ||
    first.floorIndex !== 0 ||
    poster.isMe !== true ||
    !nodeSeekEmbeddedUserId(user) ||
    identityKey !== `nodeseek:${nodeSeekEmbeddedUserId(user)}` ||
    nodeSeekEmbeddedUserId(poster) !== nodeSeekEmbeddedUserId(user)
  )
    throw new Error('原站未确认本人主帖编辑权限');
  if (
    typeof first.markdown !== 'string' ||
    typeof post.title !== 'string' ||
    !Number.isSafeInteger(rank) ||
    rank < 0 ||
    rank >= 255 ||
    !Number.isSafeInteger(post.rank) ||
    Number(post.rank) < 0 ||
    Number(post.rank) > 255
  )
    throw new Error('NodeSeek 未返回完整原文或阅读权限');
  const categoryId =
    typeof post.category === 'string'
      ? post.category
      : isRecord(post.category) && typeof post.category.key === 'string'
        ? post.category.key
        : String(post.categoryLink || '').match(/\/categories\/([^/?#]+)/)?.[1] || '';
  return {
    source: 'nodeseek',
    topicId,
    identityKey,
    original: { title: post.title, body: first.markdown, categoryId, rank: Number(post.rank) },
    permissions: { title: true, body: true, categoryId: false, tags: false, rank: true, additionalReward: false },
    rules: {
      source: 'nodeseek',
      categories: [{ id: categoryId, name: String(post.categoryWord || categoryId) }],
      ranks: [...Array.from({ length: rank + 1 }, (_, index) => index), 255],
      insideFee: 5
    }
  };
}

export async function editNodeSeekTopic(options: Options & { draft: TopicDraft }): Promise<TopicEditResult> {
  const { draft } = options;
  if (draft.source !== 'nodeseek' || !draft.edit) throw new Error('NodeSeek 编辑目标不正确');
  const latest = await loadNodeSeekTopicEditContext({
    ...options,
    topicId: draft.edit.topicId,
    identityKey: draft.identityKey
  });
  const errors = validateTopicEdit(draft, latest);
  if (Object.keys(errors).length) return { status: 'rejected', message: Object.values(errors).join('；') };
  if (topicEditConflict(draft.edit.original, latest.original))
    return { status: 'conflict', message: '原站内容已变化，请核对最新内容', latest: latest.original };
  try {
    const data = await runNodeSeekAction({
      ...options,
      request: {
        path: '/api/content/edit-discussion',
        method: 'POST',
        headers: {
          referer: nodeSeekTopicUrl(draft.edit.topicId),
          'csrf-token': randomNodeSeekContentToken()
        },
        body: JSON.stringify({
          content: draft.body,
          mode: 'edit-discussion',
          title: draft.title,
          postId: Number(draft.edit.topicId),
          rank: draft.rank
        })
      }
    });
    if (isRecord(data) && (data.error || (Array.isArray(data.errors) && data.errors.length)))
      return { status: 'rejected', message: 'NodeSeek 拒绝了修改' };
    return isRecord(data) && data.success === true
      ? { status: 'saved', message: '修改已保存' }
      : { status: 'unknown', message: 'NodeSeek 未返回明确保存结果，请到原站核对' };
  } catch (error) {
    if (isRecord(error) && error.serverRejected === true)
      return { status: 'rejected', message: error instanceof Error ? error.message : 'NodeSeek 拒绝了修改' };
    if (
      (isRecord(error) && error.serverRejected === false) ||
      (error instanceof Error && error.message === 'NodeSeek 返回内容格式不正确')
    )
      return { status: 'unknown', message: 'NodeSeek 未确认保存结果，请到原站核对' };
    throw error;
  }
}
