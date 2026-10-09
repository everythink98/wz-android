import { describe, expect, it, vi } from 'vitest';
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn()
}));
import type { TopicCreationContext, TopicDraftAttachment } from '@/domain/forum/topicComposer';
import { uploadTopicAttachment, validateTopicAttachment } from './topicCreationActions';

const linuxdo: TopicCreationContext = {
  source: 'linuxdo',
  categories: [],
  maxTags: 8,
  canCreateTag: false,
  postVotingEnabled: true,
  allowedExtensions: ['png', 'pdf'],
  maxImageBytes: 4 * 1024 * 1024,
  maxAttachmentBytes: 4 * 1024 * 1024,
  canUploadAttachments: true,
  pollCapabilities: { groups: [], canUseStaffResults: false }
};
function file(patch: Partial<TopicDraftAttachment> = {}): TopicDraftAttachment {
  return {
    id: 'attachment-one',
    uri: 'file:///private/draft/sample.pdf',
    name: 'sample.pdf',
    mimeType: 'application/pdf',
    size: 128,
    kind: 'attachment',
    description: '',
    status: 'queued',
    ...patch
  };
}
describe('创建主题附件边界', () => {
  it('按当前账号能力、扩展名和服务端大小限制校验，保留可重试文件', () => {
    expect(() => validateTopicAttachment(file(), { ...linuxdo, canUploadAttachments: false })).toThrow('账号不能上传');
    expect(() => validateTopicAttachment(file({ name: 'script.exe' }), linuxdo)).toThrow('文件类型');
    expect(() => validateTopicAttachment(file({ size: 4 * 1024 * 1024 + 1 }), linuxdo)).toThrow('4.0 MiB');
    expect(() => validateTopicAttachment(file({ size: 4 * 1024 * 1024 }), linuxdo)).not.toThrow();
  });
  it('妖火文件帖只在最终发布上传，此入口零请求', async () => {
    const context: TopicCreationContext = {
      source: 'yaohuo',
      categories: [],
      kinds: ['files'],
      allowedFileExtensions: ['pdf', 'png']
    };
    const fetcher = vi.fn();
    await expect(
      uploadTopicAttachment({
        source: 'yaohuo',
        file: file({ kind: 'yaohuo-file' }),
        context,
        fetcher,
        userAgent: 'fixture',
        signal: new AbortController().signal,
        ensureNodeImageApiKey: async () => null
      })
    ).rejects.toThrow('最终发布');
    expect(fetcher).not.toHaveBeenCalled();
    expect(() => validateTopicAttachment(file({ kind: 'yaohuo-file', size: 1024 * 1024 + 1 }), context)).toThrow(
      '1 MiB'
    );
  });
  it('妖火文件选择遵循静态图片 10 MiB 与其他文件 1 MiB 的原站限制', () => {
    const context: TopicCreationContext = {
      source: 'yaohuo',
      categories: [],
      kinds: ['files'],
      allowedFileExtensions: ['webp', 'png', 'gif']
    };
    expect(() =>
      validateTopicAttachment(
        file({ name: 'large.webp', mimeType: 'image/webp', kind: 'yaohuo-file', size: 10 * 1024 * 1024 }),
        context
      )
    ).not.toThrow();
    expect(() =>
      validateTopicAttachment(
        file({ name: 'large.png', mimeType: 'image/png', kind: 'yaohuo-file', size: 10 * 1024 * 1024 + 1 }),
        context
      )
    ).toThrow('10 MiB');
    expect(() =>
      validateTopicAttachment(
        file({ name: 'large.gif', mimeType: 'image/gif', kind: 'yaohuo-file', size: 1024 * 1024 + 1 }),
        context
      )
    ).toThrow('1 MiB');
  });
  it('妖火正文图片复用已验证的图床协议并返回 UBB，不触发文件帖发布', async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://aapi.helioho.st/upload.php');
      expect(init?.body).toBeInstanceOf(FormData);
      expect(init?.headers).toEqual({ Origin: 'https://www.yaohuo.me' });
      return new Response(JSON.stringify({ code: 200, data: { url: 'https://cdn.example.com/topic.png' } }));
    });
    await expect(
      uploadTopicAttachment({
        source: 'yaohuo',
        file: file({ uri: 'file:///private/draft/photo.png', name: 'photo.png', mimeType: 'image/png', kind: 'image' }),
        context: { source: 'yaohuo', categories: [], kinds: ['normal'], allowedFileExtensions: [] },
        fetcher,
        userAgent: 'fixture',
        signal: new AbortController().signal,
        ensureNodeImageApiKey: async () => null
      })
    ).resolves.toBe('[img]https://cdn.example.com/topic.png[/img]');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
