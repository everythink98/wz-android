import { isRecord } from '@/domain/forum/html';
import {
  type TopicDraft,
  type TopicTag,
  topicEditChanges,
  sameTopicField,
  validateTopicEdit,
  type TopicEditContext,
  type TopicEditableFields,
  type TopicEditResult
} from '@/domain/forum/topicComposer';
import type { Fetcher } from '@/platform/network/request';
import { runLinuxDoAction } from './actionClient';
import { loadLinuxDoTopicCreationContext } from './topicCreation';

type Options = { fetcher: Fetcher; userAgent: string; signal?: AbortSignal };
function tags(value: unknown): TopicTag[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((tag) =>
    typeof tag === 'string'
      ? [{ name: tag }]
      : isRecord(tag) && typeof tag.name === 'string'
        ? [{ name: tag.name, ...(Number.isSafeInteger(tag.id) && Number(tag.id) > 0 ? { id: Number(tag.id) } : {}) }]
        : []
  );
}

export async function loadLinuxDoTopicEditContext(
  options: Options & { topicId: string; identityKey: string }
): Promise<TopicEditContext> {
  const { topicId, identityKey } = options;
  if (!/^\d+$/.test(topicId)) throw new Error('帖子 ID 不正确');
  const read = (path: string) =>
    runLinuxDoAction({
      ...options,
      browserFetchIntent: { owner: 'topic', priority: 'foreground' },
      request: { path, method: 'GET', headers: {} }
    });
  const data = await read(`/t/${topicId}.json`);
  if (data.archetype === 'private_message') throw new Error('主帖编辑入口不支持私信');
  const stream = isRecord(data.post_stream) ? data.post_stream : {};
  const first = Array.isArray(stream.posts)
    ? stream.posts.find((post) => isRecord(post) && post.post_number === 1)
    : null;
  if (!isRecord(first) || String(data.id) !== topicId || !Number.isSafeInteger(first.id))
    throw new Error('linux.do 未返回主帖身份');
  const post = await read(`/posts/${first.id}.json`);
  if (
    post.id !== first.id ||
    String(post.topic_id) !== topicId ||
    post.post_number !== 1 ||
    identityKey !== `linuxdo:${post.user_id}` ||
    typeof post.raw !== 'string' ||
    typeof data.title !== 'string'
  )
    throw new Error('原站未确认本人主帖或原始正文');
  const details = isRecord(data.details) ? data.details : {};
  const permissions = {
    title: details.can_edit === true,
    categoryId: details.can_edit === true,
    tags: details.can_edit === true || details.can_edit_tags === true,
    body: post.can_edit === true,
    rank: false,
    additionalReward: false
  };
  if (!Object.values(permissions).some(Boolean)) throw new Error('原站不允许编辑此主帖');
  const rules = await loadLinuxDoTopicCreationContext(options);
  return {
    source: 'linuxdo',
    topicId,
    postId: Number(post.id),
    identityKey,
    permissions,
    rules,
    original: { title: data.title, body: post.raw, categoryId: String(data.category_id), tags: tags(data.tags) }
  };
}

export async function editLinuxDoTopic(
  options: Options & {
    draft: TopicDraft;
    context: TopicEditContext;
    checkpoint: (confirmed: Partial<TopicEditableFields>) => Promise<void>;
  }
): Promise<TopicEditResult> {
  const { draft, context, checkpoint } = options;
  if (draft.source !== 'linuxdo' || !draft.edit?.postId || context.postId !== draft.edit.postId)
    throw new Error('linux.do 首帖身份不正确');
  const errors = validateTopicEdit(draft, context);
  if (Object.keys(errors).length) return { status: 'rejected', message: Object.values(errors).join('；') };
  const changes = topicEditChanges(draft);
  if (
    (['categoryId', 'tags'] as const).some(
      (field) => changes[field] !== undefined && !sameTopicField(draft.edit!.original[field], context.original[field])
    )
  )
    return { status: 'conflict', message: '原站分类或标签已变化，请核对最新内容', latest: context.original };
  let confirmed: Partial<TopicEditableFields> = {};
  let checkpointFailed = false;
  let sent = false;
  const request = async (path: string, payload: Record<string, unknown>) =>
    runLinuxDoAction({
      ...options,
      fetcher: (url, init) => {
        if (init?.method === 'PUT') sent = true;
        return options.fetcher(url, init);
      },
      request: { path, method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    });
  const record = async (fields: Partial<TopicEditableFields>) => {
    confirmed = { ...confirmed, ...fields };
    try {
      await checkpoint(confirmed);
    } catch (error) {
      checkpointFailed = true;
      throw error;
    }
  };
  try {
    const { body, ...metadata } = changes;
    if (Object.keys(metadata).length) {
      const payload: Record<string, unknown> = {};
      if (metadata.title !== undefined) {
        payload.title = metadata.title;
        payload.original_title = draft.edit.original.title;
      }
      if (metadata.categoryId !== undefined) payload.category_id = Number(metadata.categoryId);
      if (metadata.tags !== undefined) {
        payload.tags = metadata.tags;
        payload.original_tags = draft.edit.original.tags || [];
      }
      const result = await request(
        context.permissions.title ? `/t/-/${draft.edit.topicId}.json` : `/t/${draft.edit.topicId}/tags`,
        payload
      );
      const topic = isRecord(result.basic_topic) ? result.basic_topic : result;
      if (String(topic.id) !== draft.edit.topicId)
        return { status: 'unknown', message: 'linux.do 未确认主题属性的保存结果' };
      await record({
        ...metadata,
        ...(topic && typeof topic.title === 'string' && metadata.title !== undefined ? { title: topic.title } : {}),
        ...(metadata.tags !== undefined && Array.isArray(result.tags) ? { tags: tags(result.tags) } : {})
      });
    }
    if (body !== undefined) {
      sent = false;
      const result = await request(`/posts/${draft.edit.postId}.json`, {
        post: { raw: body, original_text: draft.edit.original.body }
      });
      if (!isRecord(result.post) || result.post.id !== draft.edit.postId || typeof result.post.raw !== 'string')
        return { status: 'unknown', message: 'linux.do 未确认正文的保存结果', confirmed };
      await record({ body: result.post.raw });
    }
    return { status: 'saved', message: '修改已保存', confirmed };
  } catch (error) {
    const status = isRecord(error) ? Number(error.status) : 0;
    const known = !checkpointFailed && (!sent || [400, 401, 403, 404, 409, 422, 429].includes(status));
    const message = error instanceof Error ? error.message : '保存失败';
    return {
      status: !known ? 'unknown' : Object.keys(confirmed).length ? 'partial' : status === 409 ? 'conflict' : 'rejected',
      message: `${Object.keys(confirmed).length ? '部分修改已保存；' : ''}${!known ? '保存结果未知，请到原站核对' : message}`,
      confirmed
    };
  }
}
