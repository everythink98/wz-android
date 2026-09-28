import { decodeHtml, isRecord, parseHtml } from '@/domain/forum/html';
import type {
  CreateTopicInput,
  CreateTopicResult,
  TopicCreationCategory,
  TopicCreationContext,
  TopicTag,
  TopicTagSearchResult
} from '@/domain/forum/topicComposer';
import { fetchWithTimeout, type Fetcher } from '@/platform/network/request';
import { withBrowserFetchIntent } from '@/platform/network/browserFetchIntent';
import {
  cloudflareChallengeDiagnostics,
  isCloudflareChallengeResponse,
  LinuxDoCloudflareError
} from '@/platform/network/cloudflareChallenge';
import { DEFAULT_LINUXDO_ANDROID_USER_AGENT } from '@/platform/android/linuxDoUserAgent';
import { runLinuxDoAction } from './actionClient';
import { LINUXDO_BASE_URL, linuxDoRequestError } from './protocol';
import { normalizeLinuxDoPollCapabilities } from './pollCapabilities';

type Options = { fetcher: Fetcher; userAgent: string; signal?: AbortSignal };

function object(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return object(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return isRecord(value) ? value : {};
}

function positive(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeTag(value: unknown): TopicTag | null {
  if (typeof value === 'string' && value.trim()) return { name: value.trim() };
  const tag = object(value);
  const name = typeof tag.name === 'string' ? tag.name.trim() : '';
  const id = positive(tag.id, 0);
  return name ? { ...(id ? { id } : {}), name } : null;
}

export async function loadLinuxDoTopicCreationContext(options: Options): Promise<TopicCreationContext> {
  const { fetcher, userAgent, signal } = options;
  const browserFetchIntent = { owner: 'topic', priority: 'foreground' } as const;
  const [siteValue, sessionValue, bootstrapResponse] = await Promise.all([
    runLinuxDoAction({ ...options, browserFetchIntent, request: { path: '/site.json', method: 'GET', headers: {} } }),
    runLinuxDoAction({
      ...options,
      browserFetchIntent,
      request: { path: '/session/current.json', method: 'GET', headers: {} }
    }),
    fetchWithTimeout(
      `${LINUXDO_BASE_URL}/latest`,
      withBrowserFetchIntent(
        { headers: { Accept: 'text/html', 'User-Agent': userAgent || DEFAULT_LINUXDO_ANDROID_USER_AGENT } },
        browserFetchIntent
      ),
      { fetcher, signal }
    )
  ]);
  const html = await bootstrapResponse.text();
  const root = parseHtml(html);
  // node-html-parser textContent decodes entities even inside JSON script text.
  const preloadScript = root.querySelector('script#data-preloaded[type="application/json"]');
  const preload = object(
    preloadScript?.rawText ?? decodeHtml(root.querySelector('[data-preloaded]')?.getAttribute('data-preloaded') || '')
  );
  const hasPreloadedRules = Object.keys(object(preload.siteSettings ?? preload.site_settings)).length > 0;
  if (
    isCloudflareChallengeResponse(bootstrapResponse) ||
    (!hasPreloadedRules &&
      isCloudflareChallengeResponse({
        status: bootstrapResponse.status,
        headers: bootstrapResponse.headers,
        bodyText: html
      }))
  )
    throw Object.assign(
      new LinuxDoCloudflareError(bootstrapResponse),
      cloudflareChallengeDiagnostics(bootstrapResponse, html)
    );
  if (!bootstrapResponse.ok)
    throw linuxDoRequestError(`linux.do 发帖规则读取失败：HTTP ${bootstrapResponse.status}`, bootstrapResponse.status);
  const site = object(siteValue);
  const session = object(sessionValue);
  const currentUser = object(session.current_user);
  const staff = currentUser.staff === true || currentUser.admin === true || currentUser.moderator === true;
  const settings = object(preload.siteSettings ?? preload.site_settings ?? site.site_settings);
  if (!Object.keys(currentUser).length)
    throw Object.assign(new Error('请重新检测 linux.do 登录后读取发帖权限'), {
      source: 'linuxdo',
      loginRequired: true,
      reason: 'account-recheck-required'
    });
  if (!Object.keys(settings).length) throw new Error('linux.do 未返回当前发帖规则，请刷新后重试');
  const rows = Array.isArray(site.categories) ? site.categories : [];
  const categories: TopicCreationCategory[] = rows.filter(isRecord).flatMap((row) => {
    const id = positive(row.id, 0);
    if (!id || typeof row.name !== 'string') return [];
    const custom = object(row.custom_fields);
    const groupRows = Array.isArray(row.required_tag_groups) ? row.required_tag_groups : [];
    return [
      {
        id: String(id),
        name: row.name,
        ...(row.parent_category_id ? { parentId: String(row.parent_category_id) } : {}),
        template: typeof row.topic_template === 'string' ? row.topic_template : '',
        minimumTags: positive(row.minimum_required_tags, 0),
        canCreate:
          typeof row.can_create_topic === 'boolean'
            ? row.can_create_topic
            : !('permission' in row) || row.permission === 1,
        requiredTagGroups: groupRows.filter(isRecord).map((group) => ({
          ...(typeof group.name === 'string' ? { name: group.name } : {}),
          minCount: positive(group.min_count, 1),
          ...(Array.isArray(group.tags)
            ? {
                tagNames: group.tags
                  .map(normalizeTag)
                  .filter((tag): tag is TopicTag => Boolean(tag))
                  .map((tag) => tag.name)
              }
            : {})
        })),
        defaultPostVoting: (row.create_as_post_voting_default ?? custom.create_as_post_voting_default) === true,
        onlyPostVoting: (row.only_post_voting_in_this_category ?? custom.only_post_voting_in_this_category) === true,
        ...(positive(custom.warden_min_first_post_length, 0)
          ? { minimumBodyLength: positive(custom.warden_min_first_post_length, 0) }
          : {})
      }
    ];
  });
  if (!categories.length) throw new Error('linux.do 未返回可发帖版块');
  const allowedExtensions = String(settings.authorized_extensions || '')
    .split('|')
    .map((extension) => extension.trim().replace(/^\./, '').toLowerCase())
    .filter(Boolean);
  if (!allowedExtensions.length) throw new Error('linux.do 未返回附件类型规则');
  return {
    source: 'linuxdo',
    categories,
    titleMin: positive(settings.min_topic_title_length, 6),
    titleMax: positive(settings.max_topic_title_length, 255),
    bodyMin: positive(settings.min_first_post_length, 20),
    bodyMax: positive(settings.max_post_length, 64000),
    defaultCategoryId: String(settings.default_composer_category || ''),
    maxTags: positive(settings.max_tags_per_topic, 8),
    maxTagLength: positive(settings.max_tag_length, 20),
    canCreateTag:
      typeof currentUser.can_create_tag === 'boolean'
        ? currentUser.can_create_tag
        : staff ||
          (typeof currentUser.trust_level === 'number' &&
            typeof settings.min_trust_to_create_tag === 'number' &&
            currentUser.trust_level >= settings.min_trust_to_create_tag),
    postVotingEnabled: settings.post_voting_enabled === true,
    allowedExtensions,
    maxImageBytes: positive(settings.max_image_size_kb, 4096) * 1024,
    maxAttachmentBytes: positive(settings.max_attachment_size_kb, 4096) * 1024,
    canUploadAttachments: staff || Number(currentUser.trust_level) > 0 || Number(settings.newuser_max_attachments) > 0,
    pollCapabilities: normalizeLinuxDoPollCapabilities({ ...site, site_settings: settings }, session)
  };
}

export async function searchLinuxDoTopicTags({
  categoryId,
  query,
  selectedTags,
  ...options
}: Options & { categoryId: string; query: string; selectedTags: TopicTag[] }): Promise<TopicTagSearchResult> {
  if (!/^\d+$/.test(categoryId)) throw new Error('请先选择版块');
  const params = new URLSearchParams({ q: query, categoryId, filterForInput: 'true' });
  for (const tag of selectedTags) if (positive(tag.id, 0)) params.append('selected_tag_ids[]', String(tag.id));
  const data = await runLinuxDoAction({
    ...options,
    request: { path: `/tags/filter/search?${params}`, method: 'GET', headers: {} }
  });
  const results = Array.isArray(data.results) ? data.results : Array.isArray(data.tags) ? data.tags : [];
  const required = object(data.required_tag_group);
  const groupName =
    typeof required.name === 'string'
      ? required.name
      : typeof data.required_tag_group === 'string'
        ? data.required_tag_group
        : '';
  return {
    tags: results
      .filter((tag) => !isRecord(tag) || tag.disabled !== true)
      .map(normalizeTag)
      .filter((tag): tag is TopicTag => Boolean(tag)),
    ...(typeof data.forbidden === 'string' ? { forbidden: data.forbidden } : {}),
    ...(typeof data.forbidden_message === 'string' ? { forbiddenMessage: data.forbidden_message } : {}),
    ...(groupName
      ? { requiredGroup: { name: groupName, minCount: positive(required.min_count ?? data.minimum_required_tags, 1) } }
      : {})
  };
}

export async function createLinuxDoTopic({
  input,
  ...options
}: Options & { input: CreateTopicInput }): Promise<CreateTopicResult> {
  const { draft, body } = input;
  if (draft.source !== 'linuxdo' || !draft.title.trim() || !body.trim() || !/^\d+$/.test(draft.categoryId))
    throw new Error('linux.do 发帖内容或版块不正确');
  let data: Record<string, unknown>;
  let uncertainResponse = false;
  try {
    data = await runLinuxDoAction({
      ...options,
      fetcher: async (url, init) => {
        const response = await options.fetcher(url, init);
        if (init?.method === 'POST' && [408, 409].includes(response.status)) {
          const payload: unknown = await response
            .clone()
            .json()
            .catch(() => null);
          uncertainResponse =
            !isRecord(payload) ||
            !(
              payload.success === false ||
              (typeof payload.error === 'string' && payload.error.trim()) ||
              (Array.isArray(payload.errors) &&
                payload.errors.some((error) => typeof error === 'string' && error.trim()))
            );
        }
        return response;
      },
      request: {
        path: '/posts',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raw: body,
          title: draft.title.trim(),
          category: Number(draft.categoryId),
          tags: draft.tags.map((tag) => ({ ...(positive(tag.id, 0) ? { id: tag.id } : {}), name: tag.name.trim() })),
          archetype: 'regular',
          nested_post: true,
          create_as_post_voting: draft.postVoting,
          only_post_voting_in_this_category: draft.onlyPostVoting === true
        })
      }
    });
  } catch (error) {
    if (uncertainResponse) return { status: 'unknown', message: 'linux.do 未确认是否已发布，请到原站核对，勿直接重发' };
    if (
      isRecord(error) &&
      typeof error.status === 'number' &&
      error.status >= 400 &&
      error.status < 500 &&
      !(error instanceof Error && /Cloudflare/i.test(error.name))
    )
      return { status: 'rejected', message: error instanceof Error ? error.message : 'linux.do 拒绝了发帖请求' };
    if (error instanceof Error && error.message === 'linux.do 返回内容格式不正确')
      return { status: 'unknown', message: 'linux.do 返回了无法确认的结果，请到原站核对' };
    throw error;
  }
  if (!isRecord(data)) return { status: 'unknown', message: 'linux.do 返回了无法确认的结果，请到原站核对' };
  if (data.success === false || data.error || (Array.isArray(data.errors) ? data.errors.length > 0 : data.errors))
    return {
      status: 'rejected',
      message:
        typeof data.error === 'string'
          ? data.error
          : Array.isArray(data.errors)
            ? data.errors.join('；')
            : typeof data.message === 'string'
              ? data.message
              : 'linux.do 拒绝了发帖请求'
    };
  if (data.action === 'enqueued')
    return data.success === true
      ? { status: 'enqueued', message: '帖子已提交，正在等待审核' }
      : { status: 'unknown', message: 'linux.do 未确认审核提交，请到原站核对' };
  const post = object(data.post ?? data);
  const topicId = positive(post.topic_id, 0);
  if (!topicId || !positive(post.id, 0) || post.post_number !== 1)
    return { status: 'unknown', message: 'linux.do 未返回新话题凭据，请到原站核对' };
  return {
    status: 'posted',
    message: '发帖成功',
    topic: {
      source: 'linuxdo',
      id: String(topicId),
      title: draft.title.trim(),
      author: typeof post.username === 'string' ? post.username : '',
      url: `${LINUXDO_BASE_URL}/t/${topicId}`,
      createdAt: typeof post.created_at === 'string' ? post.created_at : new Date().toISOString(),
      categoryId: draft.categoryId,
      tags: draft.tags.map((tag) => tag.name)
    }
  };
}
