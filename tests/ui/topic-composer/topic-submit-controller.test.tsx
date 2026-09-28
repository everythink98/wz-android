import { createTopicEditTransport } from '../../helpers/topicEditingTransport';
import { loadLinuxDoTopicEditContext } from '@/sources/linuxdo/topicEditing';
import { loadNodeSeekTopicEditContext } from '@/sources/nodeseek/topicEditing';
import { loadYaohuoTopicEditContext } from '@/sources/yaohuo/topicEditing';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Buffer } from 'buffer';
import { Alert } from 'react-native';
import type { DatabaseSync } from 'node:sqlite';
import { useTopicComposerController } from '@/features/topic-composer/useTopicComposerController';
import type { TopicComposerRouteRuntimeValue } from '@/features/topic-composer/TopicComposerRouteRuntime';
import { loadLinuxDoTopicCreationContext } from '@/sources/linuxdo/topicCreation';
import { createSiteSessionStates, siteSessionIdentityKey } from '@/domain/session/siteSessionState';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { prepareRequestToSend } from '@/platform/network/request';
import { loadTopicDraft, readTopicSubmissionAttempt } from '@/platform/persistence/topicDrafts';
import type { ComposerSnapshot } from '@/domain/forum/structuredComposer';
import type { TopicCreationSource } from '@/domain/forum/topicComposer';
import { projectTestAccountSessions, testAccountUser } from '../../helpers/accountSessions';

const mockDatabases = new Map<string, DatabaseSync>();
let mockSqlFailure = '';
let mockDraftSaveGate: (() => Promise<void>) | undefined;
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: async (name: string) => {
    const { DatabaseSync } = jest.requireActual<typeof import('node:sqlite')>('node:sqlite');
    const db = mockDatabases.get(name) || new DatabaseSync(':memory:');
    mockDatabases.set(name, db);
    const parameters = (args: unknown[]) => (Array.isArray(args[0]) ? args[0] : args) as (string | number | null)[];
    const check = (sql: string) => {
      if (mockSqlFailure && sql.includes(mockSqlFailure)) {
        mockSqlFailure = '';
        throw new Error('disk full');
      }
    };
    return {
      execAsync: async (sql: string) => {
        check(sql);
        db.exec(sql);
      },
      runAsync: async (sql: string, ...args: unknown[]) => {
        check(sql);
        if (sql.includes('INSERT INTO topic_drafts') && mockDraftSaveGate) {
          const gate = mockDraftSaveGate;
          mockDraftSaveGate = undefined;
          await gate();
        }
        return db.prepare(sql).run(...parameters(args));
      },
      getFirstAsync: async (sql: string, ...args: unknown[]) => {
        check(sql);
        return db.prepare(sql).get(...parameters(args)) ?? null;
      },
      getAllAsync: async (sql: string, ...args: unknown[]) => {
        check(sql);
        return db.prepare(sql).all(...parameters(args));
      },
      closeAsync: async () => undefined
    };
  }
}));

let sequence = 0;
async function setup(source: TopicCreationSource = 'nodeseek', editing = false) {
  const id = editing ? String(40000 + ++sequence) : `submit-${++sequence}`;
  const editTransport = createTopicEditTransport(source, id);
  const sessions = projectTestAccountSessions(
    createSiteSessionStates(
      Object.fromEntries(
        (['nodeseek', 'linuxdo', 'yaohuo'] as const).map((site) => [
          site,
          {
            site,
            status: 'logged-in',
            cookieSummary: ['fixture'],
            isVerifying: false,
            currentUser: { ...testAccountUser(site), id }
          }
        ])
      )
    )
  );
  let postedResponse: () => Promise<Response> = async () =>
    new Response(JSON.stringify({ success: true, redirect: '/post-123-1' }));
  let requiredGroup = false;
  let beforeDispatch: (() => void) | undefined;
  const fetcher = jest.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    if (editing) {
      beforeDispatch?.();
      return editTransport.fetcher(url, init);
    }
    if (init?.method === 'POST' && !url.endsWith('/session/csrf')) beforeDispatch?.();
    const request = prepareRequestToSend(init);
    if (request?.method === 'POST' && !url.endsWith('/session/csrf')) return postedResponse();
    if (url.endsWith('/new-discussion')) {
      const config = Buffer.from(
        JSON.stringify({ user: { rank: 2 }, allCategory: [{ key: 'tech', cn_text: '技术' }] })
      ).toString('base64');
      return new Response(`<script>decode('${config}')</script>`);
    }
    if (url.endsWith('/latest')) {
      const settings = {
        min_topic_title_length: 6,
        min_first_post_length: 20,
        max_post_length: 64000,
        max_tags_per_topic: 8,
        authorized_extensions: 'png|pdf',
        post_voting_enabled: true
      };
      const preload = JSON.stringify({ siteSettings: JSON.stringify(settings) }).replace(/"/g, '&quot;');
      return new Response(`<div data-preloaded="${preload}"></div>`);
    }
    if (url.endsWith('/site.json'))
      return new Response(
        JSON.stringify({
          categories: [
            { id: 4, name: '技术', permission: 1 },
            { id: 5, name: '反馈', permission: 1, topic_template: '反馈模板' }
          ],
          groups: []
        })
      );
    if (url.endsWith('/session/current.json'))
      return new Response(JSON.stringify({ current_user: { id: 2, trust_level: 2, can_create_tag: true } }));
    if (url.includes('/tags/filter/search'))
      return new Response(
        JSON.stringify({
          results: [],
          ...(requiredGroup ? { required_tag_group: { name: '领域', min_count: 2 } } : {})
        })
      );
    if (url.endsWith('/session/csrf')) return new Response('{"csrf":"fixture"}');
    throw new Error(`Unexpected request ${url}`);
  });
  let ticketCurrent = true;
  const runtime: TopicComposerRouteRuntimeValue = {
    enabledSources: ['nodeseek', 'linuxdo', 'yaohuo'],
    sessions,
    sessionEpochs: { ...initialForumSessionEpochs },
    appActive: true,
    fetcher,
    ensureNetworkProxyReady: async () => undefined,
    ensureWritableSession: async (site) => ({
      source: site,
      identityKey: siteSessionIdentityKey(runtime.sessions[site]),
      sessionEpoch: 0
    }),
    isWritableSessionTicketCurrent: () => ticketCurrent,
    ensureNodeImageApiKey: async () => null,
    getUserAgent: () => 'fixture',
    getTopic: async () => {
      throw new Error('No cached topic in this fixture');
    },
    getTopicEditContext: (options) => {
      const input = { ...options, fetcher };
      return options.source === 'linuxdo'
        ? loadLinuxDoTopicEditContext(input)
        : options.source === 'nodeseek'
          ? loadNodeSeekTopicEditContext(input)
          : loadYaohuoTopicEditContext(input);
    },
    getEmojiUrls: async () => ({}),
    getLinuxDoTopicCreationContext: ({ signal }) =>
      loadLinuxDoTopicCreationContext({ fetcher, userAgent: 'fixture', signal }),
    openAccount: jest.fn<TopicComposerRouteRuntimeValue['openAccount']>(),
    notify: jest.fn()
  };
  const onPosted = jest.fn();
  const onAccepted = jest.fn();
  const onEdited = jest.fn();
  const hook = await renderHook(
    ({ value, active = true }: { value: TopicComposerRouteRuntimeValue; active?: boolean }) =>
      useTopicComposerController({
        runtime: value,
        intent: editing ? { kind: 'edit', source, topicId: '123' } : { kind: 'create', initialSource: source },
        active,
        onPosted,
        onAccepted,
        onEdited
      }),
    { initialProps: { value: runtime } }
  );
  return {
    ...hook,
    editTransport,
    onEdited,
    runtime,
    source,
    fetcher,
    onPosted,
    onAccepted,
    posts: () => fetcher.mock.calls.filter(([url, init]) => init?.method === 'POST' && !url.endsWith('/session/csrf')),
    response: (fn: () => Promise<Response>) => {
      postedResponse = fn;
    },
    requireGroup: () => {
      requiredGroup = true;
    },
    expireAtDispatch: () => {
      beforeDispatch = () => {
        ticketCurrent = false;
      };
    }
  };
}

async function ready(test: Awaited<ReturnType<typeof setup>>) {
  await waitFor(() => expect(test.result.current.context?.source).toBe(test.source));
  await act(() =>
    test.result.current.change((draft) => ({
      ...draft,
      title: '这是一个完整主题标题',
      body: '这是长度足够的正文，用来验证发布之前的保存、检查和结果处理。',
      categoryId: test.source === 'linuxdo' ? '4' : 'tech'
    }))
  );
}
function snapshot(markdown: string, validationIssues: ComposerSnapshot['validationIssues'] = []): ComposerSnapshot {
  return { markdown, validationIssues, mode: 'source', revision: 3, isEmpty: false, pendingNodeSeekPolls: [] };
}
beforeEach(() => {
  mockSqlFailure = '';
  mockDraftSaveGate = undefined;
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('创建主题发布控制器', () => {
  it.each([false, true])(
    'clears corrected editor errors without dropping other field errors (edit=%s)',
    async (editing) => {
      const test = await setup('nodeseek', editing);
      await ready(test);
      const pendingNodeSeekPolls = [
        { localId: 'poll_local_1', fingerprint: '', title: '', options: [], multiple: false, isPublic: true }
      ];
      await act(() => test.result.current.change((draft) => ({ ...draft, title: '', body: '', pendingNodeSeekPolls })));
      await act(async () => {
        await test.result.current.submit();
      });
      expect(test.result.current.errors).toMatchObject({
        title: '请输入标题',
        body: '请输入正文',
        poll: '请输入投票标题'
      });

      await act(() => test.result.current.acceptSnapshot({ ...snapshot(''), mode: 'rich', pendingNodeSeekPolls }));
      expect(test.result.current.errors.body).toBe('请输入正文');
      expect(test.result.current.errors.poll).toBe('请输入投票标题');
      await act(() => test.result.current.acceptSnapshot(snapshot('已经补充完整的正文内容。')));
      expect(test.result.current.errors).toEqual({ title: '请输入标题' });
      await act(async () => {
        await test.result.current.submit();
      });
      expect(test.result.current.errors).toEqual({ title: '请输入标题' });
      expect(test.posts()).toHaveLength(0);
      expect(test.editTransport.writes()).toHaveLength(0);
    }
  );

  it.each(['nodeseek', 'linuxdo', 'yaohuo'] as const)(
    'preserves untouched raw body across consecutive %s edits without publishing',
    async (source) => {
      const test = await setup(source, true);
      await waitFor(() => expect(test.result.current.editContext?.source).toBe(source));
      const original = test.result.current.draft!.body;
      expect(original).toBe(test.editTransport.state.body);
      await act(async () => {
        await test.result.current.submit();
      });
      expect(test.editTransport.writes()).toHaveLength(0);
      await act(() => {
        test.result.current.change((value) => ({ ...value, title: '第一次编辑' }));
        if (source !== 'yaohuo')
          test.result.current.acceptSnapshot({ ...snapshot('编辑器初始化时的归一化文本'), revision: 0 });
      });
      await act(async () => {
        await test.result.current.submit();
      });
      expect(test.result.current.error).toBe('');
      expect(test.onEdited).toHaveBeenCalledWith(source, '123');
      expect(test.onPosted).not.toHaveBeenCalled();
      expect(test.editTransport.state.body).toBe(original);
      expect(test.editTransport.writes()).toHaveLength(1);
      expect(
        await loadTopicDraft(source, siteSessionIdentityKey(test.runtime.sessions[source]), 'edit:123')
      ).toBeNull();
      await test.unmount();
      const returned = await renderHook(() =>
        useTopicComposerController({
          runtime: test.runtime,
          intent: { kind: 'edit', source, topicId: '123' },
          active: true,
          onPosted: test.onPosted,
          onAccepted: test.onAccepted,
          onEdited: test.onEdited
        })
      );
      await waitFor(() => expect(returned.result.current.editContext).not.toBeNull());
      expect(test.onEdited).toHaveBeenCalledTimes(1);
      expect(returned.result.current.draft?.title).toBe('第一次编辑');
      await act(() => returned.result.current.change((value) => ({ ...value, title: '第二次编辑' })));
      await act(async () => {
        await returned.result.current.submit();
      });
      expect(test.editTransport.writes()).toHaveLength(2);
      expect(test.editTransport.state.title).toBe('第二次编辑');
      expect(test.editTransport.state.body).toBe(original);
    }
  );

  it.each(['reviewLatest', 'rebaseEdit'] as const)(
    'keeps the draft and reports a local save failure during %s',
    async (action) => {
      const test = await setup('nodeseek', true);
      await waitFor(() => expect(test.result.current.editContext).not.toBeNull());
      await act(() => test.result.current.change((value) => ({ ...value, title: '必须保留的本机标题' })));
      mockSqlFailure = 'INSERT INTO topic_drafts';
      await act(async () => {
        await expect(test.result.current[action]()).resolves.toBeUndefined();
      });
      expect(test.result.current.error).toContain('disk');
      expect(test.result.current.draft?.title).toBe('必须保留的本机标题');
      expect(test.editTransport.writes()).toHaveLength(0);
    }
  );

  it.each(['nodeseek', 'yaohuo'] as const)('confirms %s editing charges before any save request', async (source) => {
    const test = await setup(source, true);
    await waitFor(() => expect(test.result.current.editContext).not.toBeNull());
    await act(() =>
      test.result.current.change((value) =>
        value.source === 'nodeseek' ? { ...value, rank: 255 } : { ...value, additionalReward: '1000' }
      )
    );
    let accept = false;
    const dialog = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === (accept ? '确认保存' : '取消'))?.onPress?.();
    });
    await act(async () => {
      await test.result.current.submit();
    });
    expect(dialog).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining(source === 'nodeseek' ? '10 鸡腿' : '1000 妖晶'),
      expect.any(Array),
      expect.any(Object)
    );
    expect(test.editTransport.writes()).toHaveLength(0);
    accept = true;
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.editTransport.writes()).toHaveLength(1);
    expect(test.onEdited).toHaveBeenCalledTimes(1);
  });

  it('keeps local conflicting edits until the user reviews and explicitly rebases them', async () => {
    const test = await setup('nodeseek', true);
    await waitFor(() => expect(test.result.current.editContext).not.toBeNull());
    await act(() => test.result.current.change((value) => ({ ...value, title: '本机标题' })));
    test.editTransport.state.body = '其他客户端修改的正文';
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.result.current.attempt?.status).toBe('conflict');
    expect(test.editTransport.writes()).toHaveLength(0);
    await act(async () => {
      await test.result.current.reviewLatest();
    });
    expect(test.result.current.draft?.title).toBe('本机标题');
    expect(test.result.current.draft?.body).not.toBe(test.editTransport.state.body);
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === '继续编辑')?.onPress?.();
    });
    await act(async () => {
      await test.result.current.rebaseEdit();
    });
    expect(test.result.current.draft).toMatchObject({ title: '本机标题', body: test.editTransport.state.body });
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.onEdited).toHaveBeenCalledTimes(1);
    expect(test.editTransport.writes()).toHaveLength(1);
  });

  it('restores a partial edit and sends only remaining body after remount', async () => {
    const test = await setup('linuxdo', true);
    await waitFor(() => expect(test.result.current.editContext).not.toBeNull());
    test.editTransport.respond((path) =>
      path === '/posts/789.json' ? new Response('{"errors":["正文拒绝"]}', { status: 422 }) : undefined
    );
    await act(() => test.result.current.change((value) => ({ ...value, title: '已保存标题', body: '待保存正文' })));
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.result.current.attempt?.status).toBe('partial');
    expect(test.result.current.draft?.edit?.original.title).toBe('已保存标题');
    await test.unmount();
    test.editTransport.respond(undefined);
    const resumed = await renderHook(() =>
      useTopicComposerController({
        runtime: test.runtime,
        intent: { kind: 'edit', source: 'linuxdo', topicId: '123' },
        active: true,
        onPosted: test.onPosted,
        onAccepted: test.onAccepted,
        onEdited: test.onEdited
      })
    );
    await waitFor(() => expect(resumed.result.current.context?.source).toBe('linuxdo'));
    expect(resumed.result.current.error).toContain('部分修改已保存');
    expect(resumed.result.current.draft?.body).toBe('待保存正文');
    await act(async () => {
      await resumed.result.current.submit();
    });
    expect(test.editTransport.writes().map((row) => row.path)).toEqual([
      '/t/-/123.json',
      '/posts/789.json',
      '/posts/789.json'
    ]);
    expect(test.onEdited).toHaveBeenCalledTimes(1);
  });

  it.each(['acknowledge', 'restart'] as const)(
    'retains confirmed edit steps after local persistence fails and %s',
    async (recovery) => {
      const test = await setup('linuxdo', true);
      await waitFor(() => expect(test.result.current.editContext).not.toBeNull());
      test.editTransport.respond((path) => {
        if (path !== '/posts/789.json') return undefined;
        mockSqlFailure = 'INSERT INTO topic_drafts';
        return new Response('{"errors":["正文拒绝"]}', { status: 422 });
      });
      await act(() => test.result.current.change((value) => ({ ...value, title: '已确认标题', body: '待保存正文' })));
      await act(async () => {
        await test.result.current.submit();
      });
      expect(test.result.current.attempt?.status).toBe('unknown');
      const identity = siteSessionIdentityKey(test.runtime.sessions.linuxdo);
      await act(() =>
        test.result.current.change((value) => ({ ...value, title: '之后继续修改的标题', body: '之后继续修改的正文' }))
      );
      let resumed = test;
      if (recovery === 'acknowledge') {
        jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
          buttons?.find((button) => button.text === '已核对，未保存')?.onPress?.();
        });
        mockSqlFailure = 'INSERT INTO topic_drafts';
        await act(async () => {
          await test.result.current.acknowledgeUnknown();
        });
        expect(test.result.current.attempt?.status).toBe('unknown');
        expect(await readTopicSubmissionAttempt('linuxdo', identity, 'edit:123')).toMatchObject({
          confirmed: { title: '已确认标题' }
        });
        await act(async () => {
          await test.result.current.acknowledgeUnknown();
        });
        expect(test.result.current.attempt).toBeNull();
      } else {
        await act(async () => {
          await test.result.current.flush();
        });
        await test.unmount();
        resumed = {
          ...test,
          ...(await renderHook(() =>
            useTopicComposerController({
              runtime: test.runtime,
              intent: { kind: 'edit', source: 'linuxdo', topicId: '123' },
              active: true,
              onPosted: test.onPosted,
              onAccepted: test.onAccepted,
              onEdited: test.onEdited
            })
          ))
        };
        await waitFor(() => expect(resumed.result.current.editContext).not.toBeNull());
      }
      expect(resumed.result.current.draft?.edit?.original.title).toBe('已确认标题');
      expect(resumed.result.current.draft?.title).toBe('之后继续修改的标题');
      expect(resumed.result.current.draft?.body).toBe('之后继续修改的正文');
      await act(() => resumed.result.current.change((value) => ({ ...value, title: '已确认标题' })));
      test.editTransport.respond(undefined);
      await act(async () => {
        await resumed.result.current.submit();
      });
      expect(test.editTransport.writes().map((row) => row.path)).toEqual([
        '/t/-/123.json',
        '/posts/789.json',
        '/posts/789.json'
      ]);
      expect(test.onEdited).toHaveBeenCalledTimes(1);
    }
  );

  it('preserves a late editor snapshot while confirmed fields are being saved locally', async () => {
    const test = await setup('linuxdo', true);
    await waitFor(() => expect(test.result.current.editContext).not.toBeNull());
    let release: (() => void) | undefined;
    test.editTransport.respond((path) => {
      if (path !== '/posts/789.json') return undefined;
      mockDraftSaveGate = () =>
        new Promise<void>((resolve) => {
          release = resolve;
        });
      return new Response('{"errors":["正文拒绝"]}', { status: 422 });
    });
    await act(() => test.result.current.change((value) => ({ ...value, title: '已确认标题', body: '已提交正文' })));
    let pending: Promise<void> | undefined;
    await act(() => {
      pending = test.result.current.submit();
    });
    await waitFor(() => expect(release).toBeDefined());
    await act(() => test.result.current.acceptSnapshot(snapshot('编辑器晚到的最新正文')));
    await act(async () => {
      release!();
      await pending;
    });
    expect(test.result.current.draft?.body).toBe('编辑器晚到的最新正文');
    await act(async () => {
      await test.result.current.flush();
    });
    expect(
      await loadTopicDraft('linuxdo', siteSessionIdentityKey(test.runtime.sessions.linuxdo), 'edit:123')
    ).toMatchObject({
      body: '编辑器晚到的最新正文',
      edit: { original: { title: '已确认标题' } }
    });
  });

  it('retains an unknown edit and blocks a second save', async () => {
    const test = await setup('nodeseek', true);
    await waitFor(() => expect(test.result.current.editContext).not.toBeNull());
    await act(() => test.result.current.change((value) => ({ ...value, title: '待核对标题' })));
    test.editTransport.respond(() => {
      throw new Error('connection lost');
    });
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.result.current.attempt?.status).toBe('unknown');
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.editTransport.writes()).toHaveLength(1);
    expect(test.onEdited).not.toHaveBeenCalled();
    expect(
      await loadTopicDraft('nodeseek', siteSessionIdentityKey(test.runtime.sessions.nodeseek), 'edit:123')
    ).toMatchObject({ title: '待核对标题' });
  });

  it('does not submit editing content after the account ticket expires', async () => {
    const test = await setup('nodeseek', true);
    await waitFor(() => expect(test.result.current.editContext).not.toBeNull());
    await act(() => test.result.current.change((value) => ({ ...value, title: '另一账号不能发送此稿' })));
    test.expireAtDispatch();
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.editTransport.writes()).toHaveLength(0);
    expect(test.onEdited).not.toHaveBeenCalled();
  });
  it.each(['posted', 'enqueued', 'rejected', 'unknown'] as const)(
    'settles a %s receipt while its retained route is inactive and allows editing on return',
    async (status) => {
      const test = await setup('linuxdo');
      await ready(test);
      const previousDraft = test.result.current.draft!;
      let respond!: (response: Response) => void;
      test.response(
        () =>
          new Promise((resolve) => {
            respond = resolve;
          })
      );
      let submitting!: Promise<void>;
      await act(() => {
        submitting = test.result.current.submit();
      });
      await waitFor(() => expect(test.posts()).toHaveLength(1));
      await test.rerender({ value: test.runtime, active: false });
      await act(async () => {
        respond(
          new Response(
            JSON.stringify(
              status === 'posted'
                ? { post: { id: 101, topic_id: 123, post_number: 1 } }
                : status === 'enqueued'
                  ? { success: true, action: 'enqueued' }
                  : status === 'rejected'
                    ? { errors: ['Mock rejected'] }
                    : {}
            ),
            { status: status === 'rejected' ? 422 : 200 }
          )
        );
        await submitting;
      });
      expect((await readTopicSubmissionAttempt('linuxdo', previousDraft.identityKey))?.status).toBe(status);
      expect(test.onPosted).not.toHaveBeenCalled();
      expect(test.onAccepted).not.toHaveBeenCalled();
      await test.rerender({ value: test.runtime, active: true });
      expect(test.result.current.attempt?.status).toBe(status);
      if (status === 'posted' || status === 'enqueued') {
        expect(test.result.current.draft?.id).not.toBe(previousDraft.id);
        expect(test.result.current.draft?.body).toBe('');
      } else expect(test.result.current.draft?.body).toBe(previousDraft.body);
      await act(() => test.result.current.change((draft) => ({ ...draft, title: '返回后继续编辑' })));
      let allowed = false;
      await act(async () => {
        allowed = await test.result.current.leave();
      });
      expect(allowed).toBe(true);
      expect((await loadTopicDraft('linuxdo', previousDraft.identityKey))?.title).toBe('返回后继续编辑');
      expect(test.posts()).toHaveLength(1);
    }
  );

  it('does not reconcile or resend a submission while its original request is pending', async () => {
    const test = await setup();
    await ready(test);
    let respond!: (value: Response) => void;
    test.response(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        })
    );
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === '已核对，未发布')?.onPress?.();
    });
    let pending!: Promise<void>;
    await act(() => {
      pending = test.result.current.submit();
    });
    await waitFor(() => expect(test.posts()).toHaveLength(1));
    await act(async () => {
      await test.result.current.acknowledgeUnknown();
      await test.result.current.submit();
    });
    const reconciled = alert.mock.calls.length;
    await act(async () => {
      respond(new Response(JSON.stringify({ success: true, redirect: '/post-123-1' })));
      await pending;
    });
    expect(reconciled).toBe(0);
    expect(test.posts()).toHaveLength(1);
    expect(test.onPosted).toHaveBeenCalledTimes(1);
  });

  it('分类切换先读取最后输入，不用新分类模板覆盖尚未自动保存的正文', async () => {
    const test = await setup('linuxdo');
    await ready(test);
    await act(() =>
      test.result.current.change((draft) =>
        draft.source === 'linuxdo' ? { ...draft, body: '旧模板', appliedTemplate: '旧模板' } : draft
      )
    );
    test.result.current.editorRef.current = {
      requestSnapshot: async () => snapshot('旧模板\n刚刚输入的最后一个字'),
      insertMarkup: async () => undefined,
      beginImageUpload: async () => 'upload-placeholder',
      finishImageUpload: async () => undefined
    };
    await act(async () => {
      await test.result.current.changeCategory('5');
    });
    expect(test.result.current.draft).toMatchObject({ categoryId: '5', body: '旧模板\n刚刚输入的最后一个字' });
  });
  it('取得最后输入并落盘后发送一次，成功仅清理提交的草稿版本', async () => {
    const test = await setup();
    await ready(test);
    test.result.current.editorRef.current = {
      requestSnapshot: async () => snapshot('最后输入的中文字符字'),
      insertMarkup: async () => undefined,
      beginImageUpload: async () => 'upload-placeholder',
      finishImageUpload: async () => undefined
    };
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.posts()).toHaveLength(1);
    expect(JSON.parse(String(test.posts()[0]![1]?.body))).toHaveProperty('content', '最后输入的中文字符字');
    expect(test.onPosted).toHaveBeenCalledWith(expect.objectContaining({ id: '123' }));
    const identity = siteSessionIdentityKey(test.runtime.sessions.nodeseek);
    expect(await loadTopicDraft('nodeseek', identity)).toBeNull();
    expect(await readTopicSubmissionAttempt('nodeseek', identity)).toHaveProperty('status', 'posted');
  });

  it('编辑器报告未完成节点时保留完整正文并定位错误，零发布请求', async () => {
    const test = await setup();
    await ready(test);
    test.result.current.editorRef.current = {
      requestSnapshot: async () => snapshot('尚未完成的投票', [{ code: 'poll-invalid', message: '请补充投票选项' }]),
      insertMarkup: async () => undefined,
      beginImageUpload: async () => 'upload-placeholder',
      finishImageUpload: async () => undefined
    };
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.result.current.errors.body).toBe('请补充投票选项');
    expect(test.posts()).toHaveLength(0);
    expect(await loadTopicDraft('nodeseek', siteSessionIdentityKey(test.runtime.sessions.nodeseek))).toHaveProperty(
      'body',
      '尚未完成的投票'
    );
  });

  it('发送后连接中断保留未知记录，再次点击不能重复发送', async () => {
    const test = await setup();
    await ready(test);
    test.response(async () => {
      throw new Error('connection lost');
    });
    await act(async () => {
      await Promise.all([test.result.current.submit(), test.result.current.submit()]);
    });
    expect(test.result.current.attempt?.status).toBe('unknown');
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.posts()).toHaveLength(1);
    expect(test.result.current.attempt?.status).toBe('unknown');
    expect(await loadTopicDraft('nodeseek', siteSessionIdentityKey(test.runtime.sessions.nodeseek))).not.toBeNull();
  });

  it('发送守卫拒绝过期凭证时记录明确未发送并允许修正后重试', async () => {
    const test = await setup();
    await ready(test);
    test.expireAtDispatch();
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.result.current.attempt?.status).toBe('rejected');
    expect(test.onPosted).not.toHaveBeenCalled();
    expect(test.result.current.error).toContain('账号已变化');
  });

  it('返回成功前账号变化，只结算原账号记录且不跳转新账号页面', async () => {
    const test = await setup();
    await ready(test);
    let finish!: (response: Response) => void;
    test.response(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    let submitting!: Promise<void>;
    await act(() => {
      submitting = test.result.current.submit();
    });
    await waitFor(() => expect(test.posts()).toHaveLength(1));
    const originalIdentity = siteSessionIdentityKey(test.runtime.sessions.nodeseek);
    const next = {
      ...test.runtime,
      sessions: {
        ...test.runtime.sessions,
        nodeseek: {
          ...test.runtime.sessions.nodeseek,
          currentUser: { ...testAccountUser('nodeseek'), id: 'other-account' }
        }
      }
    };
    await test.rerender({ value: next });
    await waitFor(() => expect(test.result.current.draft?.identityKey).toBe('nodeseek:other-account'));
    await act(async () => {
      finish(new Response('{"success":true,"redirect":"/post-123-1"}'));
      await submitting;
    });
    expect(test.onPosted).not.toHaveBeenCalled();
    expect(await loadTopicDraft('nodeseek', originalIdentity)).toBeNull();
    expect(test.result.current.draft?.identityKey).toBe('nodeseek:other-account');
  });

  it('linux.do 发布前重新核对必选标签组，缺少组时不发送', async () => {
    const test = await setup('linuxdo');
    await ready(test);
    test.requireGroup();
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.result.current.errors.tags).toContain('领域');
    expect(test.posts()).toHaveLength(0);
  });

  it('审核回执只关闭编辑页，不把审核ID作为主题ID', async () => {
    const test = await setup('linuxdo');
    await ready(test);
    test.response(async () => new Response('{"success":true,"action":"enqueued","pending_post":{"id":99}}'));
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.onAccepted).toHaveBeenCalledTimes(1);
    expect(test.onPosted).not.toHaveBeenCalled();
    expect(test.runtime.notify).toHaveBeenCalledWith(expect.stringContaining('审核'));
  });

  it('原站成功后的本机结算失败保留发送门禁，不能再次发布', async () => {
    const test = await setup();
    await ready(test);
    test.response(async () => {
      mockSqlFailure = 'UPDATE topic_submission_attempts';
      return new Response('{"success":true}');
    });
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.result.current.error).toContain('本机记录保存失败');
    expect(test.onAccepted).not.toHaveBeenCalled();
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.posts()).toHaveLength(1);
    expect(await loadTopicDraft('nodeseek', siteSessionIdentityKey(test.runtime.sessions.nodeseek))).not.toBeNull();
  });
});
