import type { Topic } from './models';
import type { ComposerMode, PendingNodeSeekPoll } from './structuredComposer';
import type { LinuxDoPollCapabilities } from './linuxDoPoll';
import { MAX_COMPOSER_MARKDOWN_LENGTH, validatePendingNodeSeekPoll } from './structuredComposer';

export type TopicCreationSource = 'nodeseek' | 'linuxdo' | 'yaohuo';
export type YaohuoTopicKind = 'normal' | 'gift' | 'poll' | 'files' | 'resources';
export type TopicTag = { id?: number; name: string };
export type TopicDraftAttachment = {
  id: string;
  uri: string;
  name: string;
  mimeType: string;
  size: number;
  kind: 'image' | 'attachment' | 'yaohuo-file';
  status: 'queued' | 'uploading' | 'uploaded' | 'failed' | 'unknown';
  description: string;
  markup?: string;
  error?: string;
};
export type YaohuoTopicResource = { title: string; url: string; size: string; extension: string; description: string };
type TopicDraftBase = {
  edit?: TopicEditBaseline;
  additionalReward?: string;
  id: string;
  identityKey: string;
  revision: number;
  updatedAt: number;
  title: string;
  body: string;
  mode: ComposerMode;
  categoryId: string;
  pendingNodeSeekPolls: PendingNodeSeekPoll[];
  attachments: TopicDraftAttachment[];
};
export type TopicDraft = TopicDraftBase &
  (
    | { source: 'nodeseek'; rank: number }
    | { source: 'linuxdo'; tags: TopicTag[]; postVoting: boolean; appliedTemplate: string; onlyPostVoting?: boolean }
    | {
        source: 'yaohuo';
        kind: YaohuoTopicKind;
        reward: string;
        gift: { total: string; perPerson: string };
        poll: { options: string[]; giftEnabled: boolean; total: string; perPerson: string };
        resources: YaohuoTopicResource[];
      }
  );
export type TopicCreationCategory = {
  id: string;
  name: string;
  parentId?: string;
  template?: string;
  minimumTags?: number;
  requiredTagGroups?: { name?: string; minCount: number; tagNames?: string[] }[];
  canCreate?: boolean;
  defaultPostVoting?: boolean;
  onlyPostVoting?: boolean;
  minimumBodyLength?: number;
};
type TopicCreationContextBase = {
  categories: TopicCreationCategory[];
  titleMin?: number;
  titleMax?: number;
  bodyMin?: number;
  bodyMax?: number;
  defaultCategoryId?: string;
};
export type TopicCreationContext = TopicCreationContextBase &
  (
    | { source: 'nodeseek'; ranks: number[]; insideFee: number }
    | {
        source: 'linuxdo';
        maxTags: number;
        maxTagLength?: number;
        canCreateTag: boolean;
        postVotingEnabled: boolean;
        allowedExtensions: string[];
        maxImageBytes: number;
        maxAttachmentBytes: number;
        canUploadAttachments: boolean;
        pollCapabilities: LinuxDoPollCapabilities;
      }
    | { source: 'yaohuo'; kinds: YaohuoTopicKind[]; allowedFileExtensions: string[] }
  );
export type TopicTagSearchResult = {
  tags: TopicTag[];
  requiredGroup?: { name: string; minCount: number };
  forbidden?: string;
  forbiddenMessage?: string;
};
export type CreateTopicInput = { draft: TopicDraft; body: string };
export type CreateTopicResult =
  | { status: 'posted'; message: string; topic?: Topic }
  | { status: 'enqueued'; message: string }
  | { status: 'rejected'; message: string }
  | { status: 'unknown'; message: string };
export type TopicSubmissionAttempt = {
  target?: string;
  confirmed?: Partial<TopicEditableFields>;
  id: string;
  source: TopicCreationSource;
  identityKey: string;
  draftId: string;
  revision: number;
  startedAt: number;
  status: 'sending' | CreateTopicResult['status'] | TopicEditResult['status'];
  result?: CreateTopicResult | TopicEditResult;
};

export function emptyTopicDraft(source: TopicCreationSource, identityKey: string): TopicDraft {
  const now = Date.now();
  const base = {
    id: `${source}-${now}-${Math.random().toString(36).slice(2, 10)}`,
    identityKey,
    revision: 0,
    updatedAt: now,
    title: '',
    body: '',
    mode: 'rich' as const,
    categoryId: '',
    pendingNodeSeekPolls: [],
    attachments: []
  };
  if (source === 'nodeseek') return { ...base, source, rank: 0 };
  if (source === 'linuxdo') return { ...base, source, tags: [], postVoting: false, appliedTemplate: '' };
  return {
    ...base,
    source,
    kind: 'normal',
    reward: '',
    gift: { total: '', perPerson: '' },
    poll: { options: ['', '', ''], giftEnabled: false, total: '', perPerson: '' },
    resources: [{ title: '', url: '', size: '', extension: '', description: '' }]
  };
}

function validAmount(value: string, min: number, max = Number.MAX_SAFE_INTEGER) {
  return (
    /^\d+$/.test(value.trim()) && Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max
  );
}

function giftError(total: string, perPerson: string) {
  if (!validAmount(total, 2000)) return '派币总额至少为 2000，且必须为整数';
  if (!validAmount(perPerson, 200, 10000)) return '每人妖晶必须为 200–10000 的整数';
  return Number(perPerson) > Number(total) ? '每人妖晶不能超过派币总额' : '';
}

export function yaohuoFileSizeLimit(file: Pick<TopicDraftAttachment, 'name' | 'mimeType'>) {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const staticImage =
    ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(
      file.mimeType.toLowerCase()
    ) || ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(extension);
  return (staticImage ? 10 : 1) * 1024 * 1024;
}

export function validateTopicDraft(draft: TopicDraft, context: TopicCreationContext): Record<string, string> {
  const errors: Record<string, string> = {};
  if (draft.source !== context.source) return { categoryId: '发帖站点与当前规则不一致，请重新加载' };
  const category = context.categories.find((item) => item.id === draft.categoryId);
  const title = draft.title.trim();
  const body = draft.body.trim();
  const minimumBody = category?.minimumBodyLength ?? context.bodyMin;
  if (!title) errors.title = '请输入标题';
  else if (context.titleMin && title.length < context.titleMin)
    errors.title = `标题至少需要 ${context.titleMin} 个字符`;
  else if (context.titleMax && title.length > context.titleMax) errors.title = `标题最多 ${context.titleMax} 个字符`;
  if (!body) errors.body = '请输入正文';
  else if (minimumBody && body.length < minimumBody) errors.body = `正文至少需要 ${minimumBody} 个字符`;
  else if (body.length > Math.min(context.bodyMax ?? MAX_COMPOSER_MARKDOWN_LENGTH, MAX_COMPOSER_MARKDOWN_LENGTH)) {
    errors.body = `正文超过 ${Math.min(context.bodyMax ?? MAX_COMPOSER_MARKDOWN_LENGTH, MAX_COMPOSER_MARKDOWN_LENGTH)} 个字符`;
  }
  if (!category || category.canCreate === false) errors.categoryId = '请选择可发帖的版块';
  if (draft.attachments.some((file) => file.kind !== 'yaohuo-file' && file.status !== 'uploaded')) {
    errors.attachments = '请先完成附件上传，或移除未完成的附件';
  }
  if (draft.source === 'nodeseek' && context.source === 'nodeseek') {
    if (!context.ranks.includes(draft.rank)) errors.rank = '当前账号不能使用这个阅读权限';
    try {
      draft.pendingNodeSeekPolls.forEach(validatePendingNodeSeekPoll);
    } catch (error) {
      errors.poll = error instanceof Error ? error.message : '投票内容不正确';
    }
  }
  if (draft.source === 'linuxdo' && context.source === 'linuxdo') {
    const names = draft.tags.map((tag) => tag.name.trim());
    if (names.length < (category?.minimumTags ?? 0)) errors.tags = `此版块至少需要 ${category!.minimumTags} 个标签`;
    if (names.length > context.maxTags) errors.tags = `最多选择 ${context.maxTags} 个标签`;
    if (
      names.some((name) => !name || name.length > (context.maxTagLength ?? 20)) ||
      new Set(names).size !== names.length
    )
      errors.tags = '标签不能为空、重复或超出长度限制';
    if (!context.canCreateTag && draft.tags.some((tag) => !tag.id))
      errors.tags = '当前账号不能创建新标签，请选择已有标签';
    for (const group of category?.requiredTagGroups ?? []) {
      if (!group.tagNames) continue;
      const count = names.filter((name) => group.tagNames!.includes(name)).length;
      if (count < group.minCount) errors.tags = `请从${group.name || '要求的标签组'}选择至少 ${group.minCount} 个标签`;
    }
    if (!draft.edit) {
      if (draft.postVoting && !context.postVotingEnabled) errors.categoryId = '当前站点未开放帖子投票话题';
      if (category?.onlyPostVoting && !draft.postVoting) errors.categoryId = '此版块只允许帖子投票话题';
    }
    for (const file of draft.attachments) {
      const extension = file.name.split('.').pop()?.toLowerCase() || '';
      const maximum = file.kind === 'image' ? context.maxImageBytes : context.maxAttachmentBytes;
      if (!context.allowedExtensions.includes(extension) || file.size > maximum || file.size <= 0)
        errors.attachments = '附件格式或大小不符合当前站点限制';
      if (file.kind !== 'image' && !context.canUploadAttachments) errors.attachments = '当前账号不能上传附件';
    }
  }
  if (draft.source === 'yaohuo' && context.source === 'yaohuo') {
    if (!context.kinds.includes(draft.kind)) errors.categoryId = '当前版块未开放这种发帖类型';
    if (draft.kind === 'normal' && draft.reward.trim() && !validAmount(draft.reward, 1000))
      errors.reward = '悬赏至少为 1000 妖晶，且必须为整数';
    if (draft.kind === 'gift') {
      const message = giftError(draft.gift.total, draft.gift.perPerson);
      if (message) errors.gift = message;
    }
    if (draft.kind === 'poll') {
      if (
        draft.poll.options.length < 2 ||
        draft.poll.options.length > 9 ||
        draft.poll.options.some((option) => !option.trim() || option.trim().length > 15)
      )
        errors.poll = '投票需要 2–9 个选项，每项 1–15 个字符';
      if (draft.poll.giftEnabled) {
        const message = giftError(draft.poll.total, draft.poll.perPerson);
        if (message) errors.gift = message;
      }
    }
    if (draft.kind === 'resources') {
      if (
        draft.resources.length < 1 ||
        draft.resources.length > 9 ||
        draft.resources.some((resource) => {
          let validUrl = false;
          try {
            validUrl = /^https?:$/.test(new URL(resource.url.trim()).protocol);
          } catch {
            /* Invalid URL. */
          }
          return (
            !resource.title.trim() ||
            resource.title.trim().length > 35 ||
            !validUrl ||
            resource.size.length > 7 ||
            resource.extension.length > 5
          );
        })
      )
        errors.resources = '资源需要 1–9 项；名称必填且最多 35 字，链接必须为 http/https，大小最多 7 字、后缀最多 5 字';
    }
    if (draft.kind === 'files') {
      const files = draft.attachments.filter((file) => file.kind === 'yaohuo-file');
      if (files.length < 1 || files.length > 9) errors.attachments = '请选择 1–9 个本地文件';
      for (const file of files) {
        const extension = file.name.split('.').pop()?.toLowerCase() || '';
        const maximum = yaohuoFileSizeLimit(file);
        if (!file.uri || file.size <= 0 || !context.allowedFileExtensions.includes(extension) || file.size > maximum)
          errors.attachments = `文件格式不支持，或文件超过 ${maximum / 1024 / 1024} MiB`;
        if (file.status === 'unknown' || file.status === 'failed' || file.status === 'uploading')
          errors.attachments = '请重新选择不可用的本地文件';
      }
    }
  }
  return errors;
}

export function applyTopicCategory(draft: TopicDraft, categoryId: string, context: TopicCreationContext): TopicDraft {
  if (draft.source !== context.source) return draft;
  const category = context.categories.find((item) => item.id === categoryId);
  if (draft.source !== 'linuxdo') return { ...draft, categoryId };
  const template = category?.template || '';
  const canReplaceTemplate = !draft.body.trim() || draft.body === draft.appliedTemplate;
  return {
    ...draft,
    categoryId,
    body: canReplaceTemplate ? template : draft.body,
    appliedTemplate: canReplaceTemplate ? template : draft.appliedTemplate,
    onlyPostVoting: Boolean(category?.onlyPostVoting),
    postVoting:
      category?.onlyPostVoting ||
      (categoryId !== draft.categoryId ? Boolean(category?.defaultPostVoting) : draft.postVoting)
  };
}

export type TopicComposerIntent =
  | { kind: 'create'; initialSource?: TopicCreationSource }
  | { kind: 'edit'; source: TopicCreationSource; topicId: string };
export type TopicEditableFields = {
  title: string;
  body: string;
  categoryId: string;
  rank?: number;
  tags?: TopicTag[];
};
export type TopicEditPermissions = Record<keyof TopicEditableFields | 'additionalReward', boolean>;
export type TopicEditBaseline = {
  topicId: string;
  postId?: number;
  original: TopicEditableFields;
};
export type TopicEditContext = TopicEditBaseline & {
  source: TopicCreationSource;
  identityKey: string;
  permissions: TopicEditPermissions;
  rules: TopicCreationContext;
};
export type TopicEditResult = {
  status: 'saved' | 'partial' | 'conflict' | 'rejected' | 'unknown';
  message: string;
  confirmed?: Partial<TopicEditableFields>;
  latest?: TopicEditableFields;
};

export function topicDraftTarget(draft: Pick<TopicDraft, 'edit'>) {
  return draft.edit ? `edit:${draft.edit.topicId}` : 'create';
}

export function editableTopicFields(draft: TopicDraft): TopicEditableFields {
  return {
    title: draft.title,
    body: draft.body,
    categoryId: draft.categoryId,
    ...(draft.source === 'nodeseek' ? { rank: draft.rank } : {}),
    ...(draft.source === 'linuxdo' ? { tags: draft.tags } : {})
  };
}

export function sameTopicField(a: unknown, b: unknown) {
  if (Array.isArray(a) && Array.isArray(b)) {
    const names = (tags: TopicTag[]) =>
      tags
        .map((tag) => tag.id ?? tag.name)
        .sort()
        .join('\u0000');
    return names(a) === names(b);
  }
  return a === b;
}

export function topicEditChanges(draft: TopicDraft): Partial<TopicEditableFields> {
  if (!draft.edit) return {};
  return Object.fromEntries(
    Object.entries(editableTopicFields(draft)).filter(
      ([key, value]) => !sameTopicField(value, draft.edit!.original[key as keyof TopicEditableFields])
    )
  );
}

export function hasTopicEditChanges(draft: TopicDraft) {
  return Object.keys(topicEditChanges(draft)).length > 0 || Boolean(draft.edit && draft.additionalReward);
}

export function draftFromTopicEdit(context: TopicEditContext): TopicDraft {
  const value = emptyTopicDraft(context.source, context.identityKey);
  const { topicId, postId, original } = context;
  return {
    ...value,
    ...original,
    mode: 'source',
    edit: { topicId, postId, original },
    additionalReward: ''
  } as TopicDraft;
}

export function validateTopicEdit(draft: TopicDraft, context: TopicEditContext): Record<string, string> {
  if (
    !draft.edit ||
    draft.source !== context.source ||
    draft.edit.topicId !== context.topicId ||
    draft.identityKey !== context.identityKey
  )
    return { body: '编辑目标或账号不一致，请重新进入' };
  const changes = topicEditChanges(draft);
  const validation = validateTopicDraft(draft, context.rules);
  const errors: Record<string, string> = {};
  for (const key of Object.keys(changes) as (keyof TopicEditableFields)[]) {
    if (!context.permissions[key]) errors[key] = '原站不允许修改此字段';
    else if (validation[key]) errors[key] = validation[key]!;
  }
  if (changes.categoryId !== undefined && validation.tags && !errors.tags) errors.tags = validation.tags;
  if (changes.body !== undefined && validation.attachments) errors.attachments = validation.attachments;
  if (changes.body !== undefined && validation.poll) errors.poll = validation.poll;
  if (
    draft.additionalReward &&
    (!context.permissions.additionalReward ||
      !/^\d+$/.test(draft.additionalReward) ||
      !Number.isSafeInteger(Number(draft.additionalReward)) ||
      Number(draft.additionalReward) <= 0)
  )
    errors.additionalReward = '追加悬赏必须为允许范围内的正整数';
  return errors;
}

export function topicEditConflict(original: TopicEditableFields, latest: TopicEditableFields) {
  return Object.keys(original).some(
    (key) => !sameTopicField(original[key as keyof TopicEditableFields], latest[key as keyof TopicEditableFields])
  );
}
