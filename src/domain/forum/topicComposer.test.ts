import { describe, expect, it } from 'vitest';
import {
  applyTopicCategory,
  emptyTopicDraft,
  draftFromTopicEdit,
  validateTopicEdit,
  validateTopicDraft,
  type TopicCreationContext,
  type TopicDraft,
  type TopicEditContext
} from './topicComposer';

const yh: TopicCreationContext = {
  source: 'yaohuo',
  categories: [{ id: '213', name: '问答' }],
  titleMin: 5,
  titleMax: 50,
  bodyMin: 15,
  kinds: ['normal', 'gift', 'poll', 'files', 'resources'],
  allowedFileExtensions: ['jpg', 'png', 'zip', 'gif']
};
const ld: TopicCreationContext = {
  source: 'linuxdo',
  categories: [
    { id: '4', name: '技术', template: '说明模板', minimumTags: 1 },
    { id: '5', name: '问答', template: '问题模板', onlyPostVoting: true }
  ],
  titleMin: 6,
  titleMax: 255,
  bodyMin: 20,
  maxTags: 8,
  canCreateTag: true,
  postVotingEnabled: true,
  allowedExtensions: ['png', 'zip'],
  maxImageBytes: 4096 * 1024,
  maxAttachmentBytes: 4096 * 1024,
  canUploadAttachments: true,
  pollCapabilities: { groups: [], canUseStaffResults: false }
};

function yaohuoDraft(): Extract<TopicDraft, { source: 'yaohuo' }> {
  return {
    ...emptyTopicDraft('yaohuo', 'user:1'),
    source: 'yaohuo',
    kind: 'normal',
    reward: '',
    gift: { total: '', perPerson: '' },
    poll: { options: ['', '', ''], giftEnabled: false, total: '', perPerson: '' },
    resources: [],
    categoryId: '213',
    title: '合法帖子标题',
    body: '完整正文内容用于确保超过十五个字符限制。'
  };
}

describe('topic draft validation and category changes', () => {
  it('revalidates unchanged tags when moving an existing topic to a restricted category', () => {
    const context: TopicEditContext = {
      source: 'linuxdo',
      identityKey: 'user:1',
      topicId: '123',
      original: { title: '原有主帖标题', body: '原始正文', categoryId: '5', tags: [] },
      permissions: { title: true, body: true, categoryId: true, tags: true, rank: false, additionalReward: false },
      rules: {
        ...ld,
        categories: [
          ...ld.categories,
          { id: '6', name: '标签组版块', requiredTagGroups: [{ name: '主题类型', minCount: 1, tagNames: ['技术'] }] }
        ]
      }
    };
    const draft = draftFromTopicEdit(context);
    expect(validateTopicEdit({ ...draft, categoryId: '4' }, context)).toEqual({ tags: '此版块至少需要 1 个标签' });
    expect(validateTopicEdit({ ...draft, categoryId: '6' }, context)).toEqual({
      tags: '请从主题类型选择至少 1 个标签'
    });
    expect(
      validateTopicEdit({ ...draft, categoryId: '6', tags: [{ id: 1, name: '技术' }] } as TopicDraft, context)
    ).toEqual({});
    expect(validateTopicEdit({ ...draft, title: '只修改帖子标题' }, context)).toEqual({});
  });

  it('validates an existing topic category without applying creation-only voting rules', () => {
    const context: TopicEditContext = {
      source: 'linuxdo',
      identityKey: 'user:1',
      topicId: '123',
      postId: 789,
      original: { title: '原有主帖标题', body: '原始正文', categoryId: '4', tags: [] },
      permissions: { title: true, body: true, categoryId: true, tags: true, rank: false, additionalReward: false },
      rules: ld
    };
    const draft = { ...draftFromTopicEdit(context), categoryId: '5' };
    expect(draft).toMatchObject({ body: '原始正文', categoryId: '5', postVoting: false });
    expect(validateTopicEdit(draft, context)).toEqual({});
    expect(validateTopicDraft({ ...draft, edit: undefined }, ld)).toHaveProperty('categoryId');
  });

  it('creates independent account-bound drafts and preserves edited body and tags across category templates', () => {
    const first = emptyTopicDraft('linuxdo', 'user:1');
    const second = emptyTopicDraft('linuxdo', 'user:2');
    expect(first.id).not.toBe(second.id);
    expect(first.identityKey).toBe('user:1');
    const applied = applyTopicCategory(first, '4', ld);
    expect(applied.body).toBe('说明模板');
    expect(applyTopicCategory(applied, '5', ld)).toMatchObject({ body: '问题模板', postVoting: true });
    const edited = { ...applied, body: '已经编辑过的正文' };
    expect(applyTopicCategory(edited, '5', ld)).toMatchObject({ body: edited.body, postVoting: true });
    expect(validateTopicDraft(edited, yh)).toHaveProperty('categoryId');
  });

  it('validates only active Yaohuo fields and rejects unsafe currency and file boundaries', () => {
    const normal = yaohuoDraft();
    normal.gift = { total: 'bad', perPerson: 'bad' };
    expect(validateTopicDraft(normal, yh)).toEqual({});
    expect(validateTopicDraft({ ...normal, reward: '999' }, yh)).toHaveProperty('reward');
    expect(
      validateTopicDraft({ ...normal, kind: 'gift', gift: { total: '2000', perPerson: '10001' } }, yh)
    ).toHaveProperty('gift');
    const file = {
      id: 'one',
      uri: 'file:///one.gif',
      name: 'one.gif',
      mimeType: 'image/gif',
      size: 1024 * 1024 + 1,
      kind: 'yaohuo-file' as const,
      status: 'queued' as const,
      description: ''
    };
    expect(validateTopicDraft({ ...normal, kind: 'files', attachments: [file] }, yh)).toHaveProperty('attachments');
    expect(validateTopicDraft({ ...normal, kind: 'files', attachments: [{ ...file, size: 1024 * 1024 }] }, yh)).toEqual(
      {}
    );
    expect(
      validateTopicDraft(
        { ...normal, kind: 'files', attachments: [{ ...file, name: 'one.png', mimeType: 'image/png' }] },
        yh
      )
    ).toEqual({});
  });

  it.each([
    ['jpg', 'image/jpeg'],
    ['jpeg', 'image/jpg'],
    ['png', 'image/png'],
    ['webp', 'image/webp'],
    ['zip', 'image/webp'],
    ['heic', 'application/octet-stream'],
    ['heif', '']
  ])('applies the 10 MiB image limit by MIME or extension to an allowed %s attachment', (extension, mimeType) => {
    const file = {
      id: 'one',
      uri: `file:///one.${extension}`,
      name: `one.${extension}`,
      mimeType,
      size: 10 * 1024 * 1024,
      kind: 'yaohuo-file' as const,
      status: 'queued' as const,
      description: ''
    };
    const context: TopicCreationContext = { ...yh, allowedFileExtensions: [extension] };
    const draft = { ...yaohuoDraft(), kind: 'files' as const, attachments: [file] };
    expect(validateTopicDraft(draft, context)).toEqual({});
    expect(validateTopicDraft({ ...draft, attachments: [{ ...file, size: file.size + 1 }] }, context)).toHaveProperty(
      'attachments'
    );
    expect(validateTopicDraft(draft, { ...context, allowedFileExtensions: [] })).toHaveProperty('attachments');
  });

  it('enforces current Yaohuo option and resource limits without truncating drafts', () => {
    const draft = yaohuoDraft();
    draft.kind = 'poll';
    draft.poll.options = ['A'.repeat(15), '二'];
    expect(validateTopicDraft(draft, yh)).toEqual({});
    draft.poll.options.push('B'.repeat(16));
    expect(validateTopicDraft(draft, yh)).toHaveProperty('poll');
    expect(draft.poll.options[2]).toHaveLength(16);
    draft.kind = 'resources';
    draft.resources = [{ title: '文件', url: 'javascript:alert(1)', size: '', extension: '', description: '' }];
    expect(validateTopicDraft(draft, yh)).toHaveProperty('resources');
  });

  it('checks dynamic NodeSeek ranks and LinuxDo restrictions and uploaded attachment sizes', () => {
    const ns = {
      ...emptyTopicDraft('nodeseek', 'user:1'),
      source: 'nodeseek' as const,
      rank: 4,
      title: '标题',
      body: '正文',
      categoryId: 'daily'
    };
    expect(
      validateTopicDraft(ns, {
        source: 'nodeseek',
        categories: [{ id: 'daily', name: '日常' }],
        ranks: [0, 1, 255],
        insideFee: 5
      })
    ).toHaveProperty('rank');
    const draft = {
      ...emptyTopicDraft('linuxdo', 'user:1'),
      source: 'linuxdo' as const,
      tags: [],
      postVoting: false,
      appliedTemplate: '',
      categoryId: '4',
      title: '标题字符够长度',
      body: '这是一段超过二十个字符的完整测试正文，必须保留下来。'
    };
    expect(validateTopicDraft(draft, ld)).toHaveProperty('tags');
    expect(
      validateTopicDraft(
        {
          ...draft,
          tags: [{ id: 1, name: '技术' }],
          attachments: [
            {
              id: '1',
              uri: 'file:///a.zip',
              name: 'a.zip',
              mimeType: 'application/zip',
              size: 4096 * 1024 + 1,
              kind: 'attachment',
              status: 'uploaded',
              description: ''
            }
          ]
        },
        ld
      )
    ).toHaveProperty('attachments');
  });
});
