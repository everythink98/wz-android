import { describe, expect, it, vi } from 'vitest';
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn()
}));
import { emptyTopicDraft, type CreateTopicInput } from '@/domain/forum/topicComposer';
import { createLinuxDoTopic, loadLinuxDoTopicCreationContext, searchLinuxDoTopicTags } from './topicCreation';

function input(): CreateTopicInput {
  return {
    draft: {
      ...emptyTopicDraft('linuxdo', 'one'),
      source: 'linuxdo',
      title: '一个新主题标题',
      categoryId: '4',
      tags: [{ id: 12, name: '技术' }, { name: '新标签' }],
      postVoting: true,
      appliedTemplate: ''
    },
    body: '最终正文'
  };
}

describe('linux.do topic creation', () => {
  it('reads valid bootstrap rules despite background Cloudflare scripts and preserves literal JSON entities', async () => {
    const settings = {
      authorized_extensions: 'png|pdf',
      min_topic_title_length: 6,
      max_topic_title_length: 255,
      min_first_post_length: 20,
      max_post_length: 64000,
      max_tags_per_topic: 8,
      max_image_size_kb: 4096,
      site_description: 'Preserve &quot; and &amp; within script JSON'
    };
    const fetcher = vi.fn(async (url: string) =>
      url.endsWith('/latest')
        ? new Response(
            `<html><title>LINUX DO</title><script id="data-preloaded" type="application/json">${JSON.stringify({ siteSettings: JSON.stringify(settings) })}</script><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></html>`,
            { headers: { 'Content-Type': 'text/html' } }
          )
        : Response.json(
            url.endsWith('/site.json')
              ? { categories: [{ id: 4, name: '技术', permission: 1 }] }
              : { current_user: { id: 1, trust_level: 2 } }
          )
    );
    await expect(loadLinuxDoTopicCreationContext({ fetcher, userAgent: 'test' })).resolves.toMatchObject({
      titleMin: 6,
      titleMax: 255,
      bodyMin: 20,
      bodyMax: 64000,
      maxTags: 8,
      maxImageBytes: 4096 * 1024,
      allowedExtensions: ['png', 'pdf']
    });
  });

  it.each([200, 403])(
    'preserves the verification requirement when HTTP %s contains a real challenge without rules',
    async (status) => {
      const fetcher = vi.fn(async (url: string) =>
        url.endsWith('/latest')
          ? new Response('<html><title>Just a moment...</title></html>', {
              status,
              headers: { 'Content-Type': 'text/html' }
            })
          : Response.json(url.endsWith('/site.json') ? { categories: [] } : { current_user: { id: 1 } })
      );
      await expect(loadLinuxDoTopicCreationContext({ fetcher, userAgent: 'test' })).rejects.toMatchObject({
        source: 'linuxdo',
        verificationRequired: true,
        status
      });
    }
  );

  it.each([200, 503])(
    'rejects explicit challenges or failed HTTP %s responses even with readable rules',
    async (status) => {
      const fetcher = vi.fn(async (url: string) =>
        url.endsWith('/latest')
          ? new Response(
              `<script id="data-preloaded" type="application/json">${JSON.stringify({ siteSettings: JSON.stringify({ authorized_extensions: 'png', min_topic_title_length: 6 }) })}</script>`,
              {
                status,
                headers: { 'Content-Type': 'text/html', ...(status === 200 ? { 'cf-mitigated': 'challenge' } : {}) }
              }
            )
          : Response.json(
              url.endsWith('/site.json') ? { categories: [{ id: 4, name: '技术' }] } : { current_user: { id: 1 } }
            )
      );
      const result = loadLinuxDoTopicCreationContext({ fetcher, userAgent: 'test' });
      if (status === 200) await expect(result).rejects.toMatchObject({ verificationRequired: true, status });
      else await expect(result).rejects.toThrow('HTTP 503');
    }
  );

  it('loads category permissions, templates, poll settings and attachment rules from authenticated bootstrap', async () => {
    const settings = {
      min_topic_title_length: 8,
      max_topic_title_length: 200,
      min_first_post_length: 30,
      max_post_length: 1000,
      max_tags_per_topic: 4,
      max_tag_length: 15,
      max_image_size_kb: 1024,
      max_attachment_size_kb: 2048,
      authorized_extensions: 'png|zip',
      poll_enabled: true,
      poll_maximum_options: 20,
      poll_minimum_trust_level_to_create: 1,
      poll_default_public: true,
      post_voting_enabled: true
    };
    const preload = JSON.stringify({ siteSettings: JSON.stringify(settings) })
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;');
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/latest')) return new Response(`<div data-preloaded="${preload}"></div>`);
      return new Response(
        JSON.stringify(
          url.endsWith('/site.json')
            ? {
                categories: [
                  { id: 4, name: '技术', permission: 1, topic_template: '模板', minimum_required_tags: 1 },
                  { id: 49, name: '公告', permission: null }
                ],
                groups: [
                  { id: 1, name: 'everyone' },
                  { id: 2, name: 'trust_level_1' }
                ]
              }
            : { current_user: { id: 1, trust_level: 2, can_create_tag: false } }
        )
      );
    });
    expect(await loadLinuxDoTopicCreationContext({ fetcher, userAgent: 'test' })).toMatchObject({
      titleMin: 8,
      titleMax: 200,
      bodyMin: 30,
      maxImageBytes: 1024 * 1024,
      maxAttachmentBytes: 2048 * 1024,
      canCreateTag: false,
      postVotingEnabled: true,
      categories: [
        { id: '4', template: '模板', canCreate: true },
        { id: '49', canCreate: false }
      ],
      pollCapabilities: { maxOptions: 20, canCreate: true, defaultPublic: true, groups: [{ name: 'trust_level_1' }] }
    });
  });

  it('uses selected tag IDs and returns unmet group metadata without offering disabled tags', async () => {
    const fetcher = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            results: [
              { id: 10, name: '允许' },
              { id: 11, name: '不可选', disabled: true }
            ],
            required_tag_group: { name: '领域', min_count: 2 }
          })
        )
    );
    const result = await searchLinuxDoTopicTags({
      categoryId: '4',
      query: '',
      selectedTags: [{ id: 3, name: '已有' }, { name: '新标签' }],
      fetcher,
      userAgent: 'test'
    });
    expect(result).toEqual({ tags: [{ id: 10, name: '允许' }], requiredGroup: { name: '领域', minCount: 2 } });
    const url = new URL(fetcher.mock.calls[0]![0]);
    expect(url.searchParams.getAll('selected_tag_ids[]')).toEqual(['3']);
    expect(url.searchParams.has('selected_tags[]')).toBe(false);
    expect(url.searchParams.get('filterForInput')).toBe('true');
  });

  it('gets a fresh CSRF token and sends the current JSON topic and object-tag protocol', async () => {
    const fetcher = vi.fn(
      async (url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify(
            url.endsWith('/session/csrf') ? { csrf: 'fresh' } : { post: { id: 101, topic_id: 12, post_number: 1 } }
          )
        )
    );
    expect(await createLinuxDoTopic({ input: input(), fetcher, userAgent: 'test' })).toMatchObject({
      status: 'posted',
      topic: { id: '12' }
    });
    const [url, init] = fetcher.mock.calls[1]!;
    expect(url).toBe('https://linux.do/posts');
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('fresh');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      nested_post: true,
      category: 4,
      tags: [{ id: 12, name: '技术' }, { name: '新标签' }],
      create_as_post_voting: true
    });
  });

  it.each([
    [200, { action: 'enqueued', success: true }, 'enqueued'],
    [200, { action: 'enqueued' }, 'unknown'],
    [200, { action: 'enqueued', success: true, errors: ['发布失败'] }, 'rejected'],
    [200, { action: 'enqueued', success: false }, 'rejected'],
    [200, null, 'unknown'],
    [200, { success: true }, 'unknown'],
    [200, { post: { id: 2, topic_id: 3, post_number: 2 } }, 'unknown'],
    [200, { errors: ['标题不合规'] }, 'rejected'],
    [408, {}, 'unknown'],
    [408, { errors: ['标题不合规'] }, 'rejected'],
    [409, {}, 'unknown'],
    [409, { errors: ['标题不合规'] }, 'rejected'],
    [422, { action: 'enqueued', success: true }, 'rejected']
  ])('classifies HTTP %s publication response %j as %s without retrying', async (status, payload, expected) => {
    const fetcher = vi.fn(async (url: string) =>
      url.endsWith('/session/csrf') ? Response.json({ csrf: 'fresh' }) : Response.json(payload, { status })
    );
    expect(await createLinuxDoTopic({ input: input(), fetcher, userAgent: 'test' })).toHaveProperty('status', expected);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('propagates transport cancellation without retrying', async () => {
    const failure = new Error('timeout');
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/session/csrf')) return new Response('{"csrf":"fresh"}');
      throw failure;
    });
    await expect(createLinuxDoTopic({ input: input(), fetcher, userAgent: 'test' })).rejects.toBe(failure);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
