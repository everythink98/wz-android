import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Alert, AppState } from 'react-native';
import { Buffer } from 'buffer';
import type { DatabaseSync } from 'node:sqlite';
import * as DocumentPicker from 'expo-document-picker';
import { projectTestAccountSessions, testAccountUser } from '../../helpers/accountSessions';
import { createSiteSessionStates, siteSessionIdentityKey } from '@/domain/session/siteSessionState';
import {
  emptyTopicDraft,
  type TopicCreationSource,
  type TopicDraft,
  type TopicDraftAttachment
} from '@/domain/forum/topicComposer';
import { loadTopicDraft, saveTopicDraft } from '@/platform/persistence/topicDrafts';
import { prepareRequestToSend, type Fetcher } from '@/platform/network/request';
import { currentNodeImageApiKeyGeneration } from '@/sources/nodeimage/credentials';
import { loadLinuxDoTopicCreationContext } from '@/sources/linuxdo/topicCreation';
import { useTopicComposerController } from '@/features/topic-composer/useTopicComposerController';
import type { TopicComposerRouteRuntimeValue } from '@/features/topic-composer/TopicComposerRouteRuntime';
import type { ComposerSnapshot } from '@/domain/forum/structuredComposer';
import type { LinuxDoReadRecovery } from '@/domain/session/sessionContracts';
import type { StructuredReplyComposerHandle } from '@/ui/composer/StructuredReplyComposer';
import { createTopicProofTransport } from '../../helpers/topicCreationTransport';

let mockDatabase: DatabaseSync | undefined;
let mockDiskFailure = false;
let mockMissingFiles = false;
const mockDeletedFiles: string[] = [];
const mockCopiedFiles = new Set<string>();
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: async () => {
    const { DatabaseSync } = jest.requireActual<typeof import('node:sqlite')>('node:sqlite');
    const db = (mockDatabase ??= new DatabaseSync(':memory:'));
    const check = (sql: string) => {
      if (mockDiskFailure && /INSERT INTO topic_drafts|DELETE FROM topic_drafts/.test(sql))
        throw new Error('disk unavailable');
    };
    return {
      execAsync: async (sql: string) => {
        check(sql);
        db.exec(sql);
      },
      runAsync: async (sql: string, ...args: (string | number | null)[]) => {
        check(sql);
        return db.prepare(sql).run(...args);
      },
      getFirstAsync: async (sql: string, ...args: (string | number | null)[]) => db.prepare(sql).get(...args) ?? null,
      getAllAsync: async (sql: string, ...args: (string | number | null)[]) => db.prepare(sql).all(...args)
    };
  }
}));
jest.mock('expo-file-system', () => {
  const uri = (parts: (string | { uri: string })[]) =>
    parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = uri(parts);
    }
    create() {}
  }
  class File extends Directory {
    get exists() {
      return !mockMissingFiles && (!this.uri.includes('/attachment-') || mockCopiedFiles.has(this.uri));
    }
    size = 20;
    copy(target: File) {
      mockCopiedFiles.add(target.uri);
    }
    delete() {
      mockDeletedFiles.push(this.uri);
    }
    open() {
      return { readBytes: () => Array.from('GIF89a1234567', (letter) => letter.charCodeAt(0)), close() {} };
    }
  }
  return { Directory, File, Paths: { document: 'file:///private' } };
});
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('@/sources/nodeimage/credentials', () => ({ currentNodeImageApiKeyGeneration: jest.fn() }));
jest.mock('@/platform/media/prepareUploadImage', () => ({
  prepareUploadImage: async (file: unknown) => ({ file, cleanup() {} })
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function response(body: string, status = 200) {
  return {
    ok: status < 400,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
    headers: new Headers()
  } as Response;
}
const config = Buffer.from(
  JSON.stringify({ user: { rank: 2 }, allCategory: [{ key: 'tech', cn_text: '技术' }] })
).toString('base64');
function runtimeFor(id = '123', fetcher?: Fetcher): TopicComposerRouteRuntimeValue {
  const states = createSiteSessionStates();
  for (const site of ['nodeseek', 'linuxdo', 'yaohuo'] as const)
    states[site] = { ...states[site], status: 'logged-in', currentUser: { ...testAccountUser(site), id } };
  const sessions = projectTestAccountSessions(states);
  return {
    enabledSources: ['nodeseek', 'linuxdo', 'yaohuo'],
    sessions,
    sessionEpochs: { nodeseek: 0, linuxdo: 0, yaohuo: 0 },
    appActive: true,
    fetcher:
      fetcher ||
      (async (_url, init) => {
        prepareRequestToSend(init);
        return response(`<script>decode('${config}')</script>`);
      }),
    ensureNetworkProxyReady: async () => {},
    ensureWritableSession: async (source) => ({
      source,
      identityKey: siteSessionIdentityKey(sessions[source]),
      sessionEpoch: 0
    }),
    isWritableSessionTicketCurrent: () => true,
    ensureNodeImageApiKey: async () => 'fixture-key',
    getUserAgent: () => 'fixture',
    getTopic: async () => {
      throw new Error('No cached topic in this fixture');
    },
    getTopicEditContext: async () => {
      throw new Error('Unexpected edit context request');
    },
    getEmojiUrls: async () => ({}),
    getLinuxDoTopicCreationContext: ({ signal }) =>
      loadLinuxDoTopicCreationContext({
        fetcher: fetcher || (async () => response('{}')),
        userAgent: 'fixture',
        signal
      }),
    openAccount: () => {},
    notify: () => {}
  };
}
function storedDraft(id = 'draft-one'): TopicDraft {
  return {
    ...emptyTopicDraft('nodeseek', 'nodeseek:123'),
    id,
    revision: 1,
    title: '保留的标题',
    body: '保留的正文',
    categoryId: 'tech'
  };
}
function attachment(draft: TopicDraft, id = 'file-one'): TopicDraftAttachment {
  return {
    id,
    uri: `file:///private/topic-draft-attachments/${draft.source}/account-${encodeURIComponent(draft.identityKey)}/${draft.id}/${id}.gif`,
    name: `${id}.gif`,
    mimeType: 'image/gif',
    size: 20,
    kind: 'image',
    status: 'queued',
    description: ''
  };
}
function snapshot(markdown: string): ComposerSnapshot {
  return { markdown, revision: 1, mode: 'rich', isEmpty: !markdown, validationIssues: [], pendingNodeSeekPolls: [] };
}
function editorHandle(overrides: Partial<StructuredReplyComposerHandle> = {}): StructuredReplyComposerHandle {
  return {
    requestSnapshot: async () => snapshot('保留的正文'),
    insertMarkup: async () => {},
    beginImageUpload: async () => 'upload-placeholder',
    finishImageUpload: async () => {},
    ...overrides
  };
}
async function setup(saved = storedDraft(), runtime = runtimeFor()) {
  await saveTopicDraft(saved);
  const hook = await renderHook(
    ({ owner }: { owner: TopicComposerRouteRuntimeValue }) =>
      useTopicComposerController({
        runtime: owner,
        intent: { kind: 'create', initialSource: saved.source },
        active: true,
        onPosted: () => {},
        onAccepted: () => {}
      }),
    { initialProps: { owner: runtime } }
  );
  await waitFor(() => expect(hook.result.current.context?.source).toBe(saved.source));
  return hook;
}

beforeEach(() => {
  jest.mocked(DocumentPicker.getDocumentAsync).mockReset();
  mockDiskFailure = false;
  mockMissingFiles = false;
  mockDeletedFiles.length = 0;
  mockCopiedFiles.clear();
  mockDatabase?.exec(
    'DELETE FROM topic_drafts; DELETE FROM discarded_topic_drafts; DELETE FROM topic_submission_attempts; DELETE FROM topic_creation_preferences;'
  );
  jest.mocked(currentNodeImageApiKeyGeneration).mockReturnValue(1);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('topic draft lifecycle', () => {
  it('opens the local picker without waiting for upload network preparation', async () => {
    const owner = runtimeFor();
    const hook = await setup(storedDraft(), owner);
    const prepare = jest.fn<() => Promise<void>>().mockRejectedValue(new Error('网络不可用'));
    await hook.rerender({ owner: { ...owner, ensureNetworkProxyReady: prepare } });
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({ canceled: true, assets: null });
    await act(async () => {
      await hook.result.current.pickAttachments('image');
    });
    expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledTimes(1);
    expect(prepare).not.toHaveBeenCalled();
    expect(hook.result.current.error).toBe('');
  });

  it('opens only one document picker for repeated attachment taps', async () => {
    const picker = deferred<DocumentPicker.DocumentPickerResult>();
    jest.mocked(DocumentPicker.getDocumentAsync).mockClear().mockReturnValue(picker.promise);
    const hook = await setup();
    let first!: ReturnType<typeof hook.result.current.pickAttachments>;
    let second!: typeof first;
    await act(() => {
      first = hook.result.current.pickAttachments('image');
      second = hook.result.current.pickAttachments('image');
    });
    await waitFor(() => expect(DocumentPicker.getDocumentAsync).toHaveBeenCalled());
    const calls = jest.mocked(DocumentPicker.getDocumentAsync).mock.calls.length;
    await act(async () => {
      picker.resolve({ canceled: true, assets: null });
      await Promise.all([first, second]);
    });
    expect(calls).toBe(1);
  });

  it.each(['nodeseek', 'linuxdo', 'yaohuo'] as const)(
    'keeps completed %s rules on foreground return and refreshes them only on explicit retry or session change',
    async (source) => {
      const transport = createTopicProofTransport('success');
      const fetcher = jest.fn<Fetcher>(transport.fetcher);
      const owner = runtimeFor('123', fetcher);
      const saved = emptyTopicDraft(source, `${source}:123`);
      const hook = await setup(saved, owner);
      await waitFor(() => expect(hook.result.current.contextLoading).toBe(false));
      const loaded = hook.result.current.context;
      const calls = fetcher.mock.calls.length;
      await hook.rerender({ owner: { ...owner, appActive: false } });
      await hook.rerender({ owner });
      expect(hook.result.current.context).toBe(loaded);
      expect(hook.result.current.contextLoading).toBe(false);
      expect(fetcher).toHaveBeenCalledTimes(calls);
      await act(() => hook.result.current.reloadContext());
      await waitFor(() => expect(hook.result.current.contextLoading).toBe(false));
      expect(fetcher.mock.calls.length).toBeGreaterThan(calls);
      const refreshed = fetcher.mock.calls.length;
      await hook.rerender({ owner: { ...owner, sessionEpochs: { ...owner.sessionEpochs, [source]: 1 } } });
      await waitFor(() => expect(hook.result.current.contextLoading).toBe(false));
      expect(fetcher.mock.calls.length).toBeGreaterThan(refreshed);
    }
  );

  it('treats the current category as a no-op and leaves missing-tag guidance inline after a category change', async () => {
    const transport = createTopicProofTransport('success');
    const owner = runtimeFor('123', transport.fetcher);
    const original = owner.getLinuxDoTopicCreationContext;
    owner.getLinuxDoTopicCreationContext = async (options) => ({
      ...(await original(options)),
      categories: [
        { id: '4', name: '技术' },
        { id: '5', name: '反馈', minimumTags: 2 }
      ]
    });
    const saved = { ...emptyTopicDraft('linuxdo', 'linuxdo:123'), categoryId: '4', body: '正文' };
    const hook = await setup(saved, owner);
    const requestSnapshot = jest.fn(async () => snapshot(saved.body));
    hook.result.current.editorRef.current = editorHandle({ requestSnapshot });
    await act(async () => {
      await hook.result.current.changeCategory('4');
    });
    expect(requestSnapshot).not.toHaveBeenCalled();
    await act(async () => {
      await hook.result.current.changeCategory('5');
    });
    expect(requestSnapshot).toHaveBeenCalledTimes(1);
    expect(hook.result.current.draft?.categoryId).toBe('5');
    expect(hook.result.current.errors).toEqual({});
  });

  it('captures the outgoing editor only once when switching sites', async () => {
    const transport = createTopicProofTransport('success');
    const saved = storedDraft();
    const hook = await setup(saved, runtimeFor('123', transport.fetcher));
    const requestSnapshot = jest.fn(async () => snapshot(saved.body));
    hook.result.current.editorRef.current = editorHandle({ requestSnapshot });
    await act(async () => {
      await hook.result.current.switchSource('linuxdo');
    });
    await waitFor(() => expect(hook.result.current.draft?.source).toBe('linuxdo'));
    expect(requestSnapshot).toHaveBeenCalledTimes(1);
    expect((await loadTopicDraft('nodeseek', saved.identityKey))?.body).toBe(saved.body);
  });

  it('retains all valid picked files and reports the invalid file by name', async () => {
    const transport = createTopicProofTransport('success');
    const saved = emptyTopicDraft('linuxdo', 'linuxdo:123');
    let uploads = 0;
    const hook = await setup(
      saved,
      runtimeFor('123', async (url, init) => {
        if (!url.endsWith('/uploads.json')) return transport.fetcher(url, init);
        prepareRequestToSend(init);
        uploads++;
        return response('{"url":"https://img.invalid/file.pdf"}');
      })
    );
    hook.result.current.editorRef.current = editorHandle();
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({
      canceled: false,
      assets: ['first.pdf', 'invalid.exe', 'last.pdf'].map((name) => ({
        uri: `file:///${name}`,
        name,
        mimeType: 'application/octet-stream',
        size: 20,
        lastModified: 0
      }))
    });
    await act(async () => {
      await hook.result.current.pickAttachments('attachment');
    });
    expect(hook.result.current.draft?.attachments.map((file) => file.name)).toEqual(['first.pdf', 'last.pdf']);
    expect(hook.result.current.error).toContain('invalid.exe');
    expect(uploads).toBe(2);
    expect(transport.writes).toEqual([]);
  });

  it('hands a challenged tag search to dedicated verification and resumes only that read', async () => {
    const transport = createTopicProofTransport('success');
    const tagUrls: string[] = [];
    let blocked = true;
    const fetcher: Fetcher = (url, init) => {
      if (String(url).includes('/tags/filter/search')) {
        tagUrls.push(String(url));
        return Promise.resolve(
          blocked
            ? response('<title>Just a moment...</title>', 403)
            : response(JSON.stringify({ results: [{ id: 9, name: 'OpenAI' }] }))
        );
      }
      return transport.fetcher(url, init);
    };
    const openAccount = jest.fn<
      (_source: TopicCreationSource, _message?: string, _recovery?: LinuxDoReadRecovery) => Promise<boolean>
    >(async () => true);
    const saved = {
      ...emptyTopicDraft('linuxdo', 'linuxdo:123'),
      categoryId: '4',
      title: '保留的标题',
      body: '保留的正文',
      tags: [{ id: 7, name: '人工智能' }]
    };
    const hook = await setup(saved, { ...runtimeFor('123', fetcher), openAccount });
    let searching!: ReturnType<typeof hook.result.current.searchTags>;
    await act(() => {
      searching = hook.result.current.searchTags('open');
    });
    await waitFor(() => expect(openAccount).toHaveBeenCalledTimes(1));
    const recovery = openAccount.mock.calls[0][2]!;
    expect(recovery.isCurrent?.()).toBe(true);
    await act(async () => {
      expect(await recovery.resume()).toBe('verification-required');
    });
    expect(openAccount).toHaveBeenCalledTimes(1);
    blocked = false;
    await act(async () => {
      expect(await recovery.resume()).toBe('completed');
      expect(await searching).toEqual({ tags: [{ id: 9, name: 'OpenAI' }] });
    });
    expect(tagUrls).toHaveLength(3);
    for (const url of tagUrls) {
      expect(new URL(url).searchParams.get('q')).toBe('open');
      expect(new URL(url).searchParams.getAll('selected_tag_ids[]')).toEqual(['7']);
    }
    expect(hook.result.current.draft).toMatchObject({ title: saved.title, body: saved.body, tags: saved.tags });
    expect(transport.writes).toEqual([]);
  });

  it('recovers creation rules through the dedicated verification callback without another page reload', async () => {
    const transport = createTopicProofTransport('success');
    let blocked = true;
    const runtime = runtimeFor('123', transport.fetcher);
    const openAccount = jest.fn<
      (_source: TopicCreationSource, _message?: string, _recovery?: LinuxDoReadRecovery) => Promise<boolean>
    >(async () => true);
    const owner = {
      ...runtime,
      openAccount,
      getLinuxDoTopicCreationContext: async (input: Parameters<typeof runtime.getLinuxDoTopicCreationContext>[0]) => {
        if (blocked)
          throw Object.assign(new Error('linux.do 需要完成 Cloudflare 验证'), {
            verificationRequired: true,
            source: 'linuxdo'
          });
        return runtime.getLinuxDoTopicCreationContext(input);
      }
    };
    const hook = await renderHook(() =>
      useTopicComposerController({
        runtime: owner,
        intent: { kind: 'create', initialSource: 'linuxdo' },
        active: true,
        onPosted: () => {},
        onAccepted: () => {}
      })
    );
    await waitFor(() => expect(openAccount).toHaveBeenCalledTimes(1));
    blocked = false;
    await act(async () => {
      expect(await openAccount.mock.calls[0][2]!.resume()).toBe('completed');
    });
    await waitFor(() => expect(hook.result.current.context?.source).toBe('linuxdo'));
    expect(hook.result.current.contextError).toBe('');
    expect(transport.writes).toEqual([]);
  });

  it.each(['cancel', 'abort', 'account'] as const)(
    'settles a pending tag verification on %s without a late read or write',
    async (action) => {
      const transport = createTopicProofTransport('success');
      let reads = 0;
      let blocked = true;
      const fetcher: Fetcher = (url, init) => {
        if (String(url).includes('/tags/filter/search')) {
          reads += 1;
          return Promise.resolve(
            blocked ? response('<title>Just a moment...</title>', 403) : response('{"results":[]}')
          );
        }
        return transport.fetcher(url, init);
      };
      const openAccount = jest.fn<
        (_source: TopicCreationSource, _message?: string, _recovery?: LinuxDoReadRecovery) => Promise<boolean>
      >(async () => true);
      const hook = await setup(
        { ...emptyTopicDraft('linuxdo', 'linuxdo:123'), categoryId: '4' },
        { ...runtimeFor('123', fetcher), openAccount }
      );
      const abort = new AbortController();
      let searching!: ReturnType<typeof hook.result.current.searchTags>;
      await act(() => {
        searching = hook.result.current.searchTags('old', abort.signal);
        void searching.catch(() => undefined);
      });
      await waitFor(() => expect(openAccount).toHaveBeenCalledTimes(1));
      const recovery = openAccount.mock.calls[0][2]!;
      if (action === 'account') await hook.rerender({ owner: { ...runtimeFor('456', fetcher), openAccount } });
      await act(async () => {
        if (action === 'cancel') recovery.cancel!();
        if (action === 'abort') abort.abort();
        expect(await recovery.resume()).toBe('stale');
        if (action === 'cancel') await expect(searching).rejects.toThrow('验证已取消');
        else expect(await searching).toBeUndefined();
      });
      expect(reads).toBe(1);
      expect(transport.writes).toEqual([]);
      if (action === 'cancel') {
        blocked = false;
        await act(async () => {
          expect(await hook.result.current.searchTags('new')).toEqual({ tags: [] });
        });
        expect(reads).toBe(2);
      }
    }
  );

  it('reads tags only for an explicit search and includes the current selection once', async () => {
    const transport = createTopicProofTransport('success');
    const tagUrls: string[] = [];
    const fetcher: Fetcher = (url, init) => {
      if (String(url).includes('/tags/filter/search')) tagUrls.push(String(url));
      return transport.fetcher(url, init);
    };
    const saved = { ...emptyTopicDraft('linuxdo', 'linuxdo:123'), categoryId: '4' };
    const hook = await setup(saved, runtimeFor('123', fetcher));
    expect(tagUrls).toEqual([]);
    await act(async () =>
      hook.result.current.change((draft) =>
        draft.source === 'linuxdo' ? { ...draft, tags: [{ id: 7, name: '技术' }] } : draft
      )
    );
    expect(tagUrls).toEqual([]);
    await act(async () => {
      await hook.result.current.searchTags('交流');
    });
    expect(tagUrls).toHaveLength(1);
    const params = new URL(tagUrls[0]).searchParams;
    expect(params.get('q')).toBe('交流');
    expect(params.getAll('selected_tag_ids[]')).toEqual(['7']);
    expect(transport.writes).toEqual([]);
  });

  it('does not send cancelled tag searches or report their late errors', async () => {
    const transport = createTopicProofTransport('success');
    const pending = deferred<Response>();
    let requests = 0;
    const fetcher: Fetcher = (url, init) => {
      if (String(url).includes('/tags/filter/search')) {
        requests += 1;
        return pending.promise;
      }
      return transport.fetcher(url, init);
    };
    const hook = await setup(
      { ...emptyTopicDraft('linuxdo', 'linuxdo:123'), categoryId: '4' },
      runtimeFor('123', fetcher)
    );
    const abort = new AbortController();
    abort.abort();
    await act(async () => {
      await hook.result.current.searchTags('取消', abort.signal);
    });
    expect(requests).toBe(0);
    const active = new AbortController();
    let search!: ReturnType<typeof hook.result.current.searchTags>;
    await act(() => {
      search = hook.result.current.searchTags('旧查询', active.signal);
    });
    await waitFor(() => expect(requests).toBe(1));
    active.abort();
    await act(async () => {
      pending.reject(new Error('旧查询连接失败'));
      await search;
    });
    expect(hook.result.current.error).toBe('');
  });

  it('restores a draft without reading context in the background and loads rules automatically on foreground entry', async () => {
    const saved = storedDraft();
    await saveTopicDraft(saved);
    const fetcher = jest.fn<Fetcher>(async () => response(`<script>decode('${config}')</script>`));
    const owner = { ...runtimeFor('123', fetcher), appActive: false };
    const hook = await renderHook(
      ({ value }: { value: TopicComposerRouteRuntimeValue }) =>
        useTopicComposerController({
          runtime: value,
          intent: { kind: 'create', initialSource: saved.source },
          active: true,
          onPosted: () => {},
          onAccepted: () => {}
        }),
      { initialProps: { value: owner } }
    );
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.draft).toMatchObject({ title: saved.title, body: saved.body });
    expect(fetcher).not.toHaveBeenCalled();
    expect(hook.result.current.contextError).toBe('');
    await hook.rerender({ value: { ...owner, appActive: true } });
    await waitFor(() => expect(hook.result.current.context?.source).toBe('nodeseek'));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(hook.result.current.contextError).toBe('');
    expect(hook.result.current.draft).toMatchObject({ title: saved.title, body: saved.body });
  });

  it('cancels a context read on backgrounding and ignores its late response before reloading in the foreground', async () => {
    const pending = deferred<Response>();
    const fetcher = jest.fn<Fetcher>();
    fetcher
      .mockReturnValueOnce(pending.promise)
      .mockImplementation(async () => response(`<script>decode('${config}')</script>`));
    const owner = runtimeFor('123', fetcher);
    const saved = storedDraft();
    await saveTopicDraft(saved);
    const hook = await renderHook(
      ({ value }: { value: TopicComposerRouteRuntimeValue }) =>
        useTopicComposerController({
          runtime: value,
          intent: { kind: 'create', initialSource: saved.source },
          active: true,
          onPosted: () => {},
          onAccepted: () => {}
        }),
      { initialProps: { value: owner } }
    );
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const signal = fetcher.mock.calls[0]![1]?.signal;
    await hook.rerender({ value: { ...owner, appActive: false } });
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      pending.resolve(response('<html>late invalid response</html>'));
    });
    expect(hook.result.current.context).toBeNull();
    expect(hook.result.current.contextError).toBe('');
    expect(hook.result.current.contextNeedsVerification).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await hook.rerender({ value: owner });
    await waitFor(() => expect(hook.result.current.context?.source).toBe('nodeseek'));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(hook.result.current.contextError).toBe('');
  });

  it.each(['nodeseek', 'linuxdo', 'yaohuo'] as const)(
    'uploads a picked %s image without another confirmation even when its provider omits the MIME type',
    async (source) => {
      const saved = { ...emptyTopicDraft(source, `${source}:123`), revision: 1 };
      const transport = createTopicProofTransport('success');
      let uploads = 0;
      const hook = await setup(
        saved,
        runtimeFor('123', async (url, init) => {
          if (init?.method !== 'POST') return transport.fetcher(url, init);
          prepareRequestToSend(init);
          uploads++;
          return response(
            JSON.stringify({
              url: 'https://img.invalid/picker.png',
              code: 200,
              data: { url: 'https://img.invalid/picker.png' }
            })
          );
        })
      );
      jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({
        canceled: false,
        assets: [{ uri: 'file:///picker.png', name: 'picker.png', size: 20, lastModified: 0 }]
      });
      const prompt = jest
        .spyOn(Alert, 'alert')
        .mockImplementation((_title, _message, buttons) =>
          buttons?.find((button) => button.text === '取消')?.onPress?.()
        );
      await act(async () => {
        await hook.result.current.pickAttachments('image', true);
      });
      expect(hook.result.current.error).toBe('');
      expect((await loadTopicDraft(source, saved.identityKey))?.attachments[0]).toMatchObject({
        name: 'picker.png',
        mimeType: 'image/png',
        status: 'uploaded'
      });
      expect(prompt).not.toHaveBeenCalled();
      expect(uploads).toBe(1);
      expect(transport.writes).toEqual([]);
    }
  );

  it.each([
    ['linuxdo', 'csrf', 'network', 'failed'],
    ['linuxdo', 'csrf', 502, 'failed'],
    ['linuxdo', 'upload', 422, 'failed'],
    ['linuxdo', 'upload', 403, 'failed'],
    ['nodeseek', 'upload', 401, 'failed'],
    ['nodeseek', 'upload', 422, 'failed'],
    ['yaohuo', 'upload', 422, 'failed'],
    ['linuxdo', 'upload', 408, 'unknown'],
    ...(['nodeseek', 'linuxdo', 'yaohuo'] as const).flatMap((source) =>
      [502, 'network'].map((outcome) => [source, 'upload', outcome, 'unknown'])
    )
  ])('retains %s %s %s as %s without retrying the request', async (site, phase, outcome, expected) => {
    const source = site as TopicCreationSource;
    const saved = { ...emptyTopicDraft(source, `${source}:123`), revision: 1 };
    saved.attachments = [
      {
        ...attachment(saved),
        ...(source === 'linuxdo' ? { name: 'notes.pdf', mimeType: 'application/pdf', kind: 'attachment' as const } : {})
      }
    ];
    const transport = createTopicProofTransport('success');
    const uploads: string[] = [];
    const fetcher: Fetcher = async (url, init) => {
      prepareRequestToSend(init);
      const upload = init?.method === 'POST';
      if (upload) uploads.push(url);
      if (upload || (phase === 'csrf' && url.endsWith('/session/csrf'))) {
        if (outcome === 'network') throw new Error('connection lost');
        return response('{"errors":["Upload rejected"],"message":"Upload rejected"}', Number(outcome));
      }
      return transport.fetcher(url, init);
    };
    const hook = await setup(saved, runtimeFor('123', fetcher));
    await act(async () => {
      await hook.result.current.uploadFiles(saved.attachments, false);
    });
    expect(uploads).toHaveLength(phase === 'csrf' ? 0 : 1);
    expect(hook.result.current.draft?.attachments[0]?.status).toBe(expected);
    expect((await loadTopicDraft(source, saved.identityKey))?.attachments[0]?.status).toBe(expected);
    expect(mockDeletedFiles).toEqual([]);
  });

  it('clears a prior snapshot failure only after a successful flush of the same already-saved revision', async () => {
    const saved = storedDraft();
    const hook = await setup(saved);
    const requestSnapshot = jest.fn<() => Promise<ComposerSnapshot>>();
    requestSnapshot.mockRejectedValueOnce(new Error('无法取得最新正文，草稿已保留'));
    requestSnapshot.mockResolvedValue(snapshot(saved.body));
    hook.result.current.editorRef.current = editorHandle({ requestSnapshot });
    await act(async () => {
      expect(await hook.result.current.leave()).toBe(false);
    });
    expect(hook.result.current.saveStatus).toContain('无法取得最新正文');
    await act(async () => {
      expect(await hook.result.current.leave()).toBe(true);
    });
    expect(hook.result.current.saveStatus).toBe('已保存到本机');
    expect((await loadTopicDraft(saved.source, saved.identityKey))?.revision).toBe(saved.revision);
  });

  it('persists confirmed text across a picker without racing the paused editor on resume', async () => {
    const saved = storedDraft();
    const hook = await setup(saved);
    const onAppState = jest.mocked(AppState.addEventListener).mock.calls.findLast(([event]) => event === 'change')![1];
    const requestSnapshot = jest.fn(async () => {
      throw new Error('无法取得最新正文，草稿已保留');
    });
    hook.result.current.editorRef.current = editorHandle({ requestSnapshot });
    await act(() => hook.result.current.acceptSnapshot(snapshot('最后确认的正文'), saved.id));
    await act(() => onAppState('background'));
    await waitFor(async () => {
      expect((await loadTopicDraft(saved.source, saved.identityKey))?.body).toBe('最后确认的正文');
    });
    expect(requestSnapshot).not.toHaveBeenCalled();
    await act(() => onAppState('active'));
    expect(requestSnapshot).not.toHaveBeenCalled();
    expect(hook.result.current.saveStatus).toBe('已保存到本机');
    await act(async () => {
      hook.result.current.acceptSnapshot(snapshot('最后确认的正文和最后输入的字'), saved.id);
    });
    await waitFor(async () => {
      expect((await loadTopicDraft(saved.source, saved.identityKey))?.body).toBe('最后确认的正文和最后输入的字');
    });
    await act(() => onAppState('active'));
    expect(requestSnapshot).not.toHaveBeenCalled();
    expect(hook.result.current.saveStatus).toBe('已保存到本机');
  });

  it('keeps background disk failures visible and refuses leaving until the confirmed draft can be saved', async () => {
    const saved = storedDraft();
    const hook = await setup(saved);
    const onAppState = jest.mocked(AppState.addEventListener).mock.calls.findLast(([event]) => event === 'change')![1];
    const requestSnapshot = jest.fn(async () => snapshot('未落盘的正文'));
    hook.result.current.editorRef.current = editorHandle({ requestSnapshot });
    await act(() => hook.result.current.acceptSnapshot(snapshot('未落盘的正文'), saved.id));
    mockDiskFailure = true;
    await act(() => onAppState('background'));
    await waitFor(() => expect(hook.result.current.saveStatus).toContain('disk unavailable'));
    expect(requestSnapshot).not.toHaveBeenCalled();
    await act(async () => {
      expect(await hook.result.current.leave()).toBe(false);
    });
    expect((await loadTopicDraft(saved.source, saved.identityKey))?.body).toBe(saved.body);
    expect(hook.result.current.draft?.body).toBe('未落盘的正文');
  });

  it('does not replace the new account save status with an old snapshot rejection', async () => {
    const hook = await setup();
    const previous = deferred<ComposerSnapshot>();
    const requestSnapshot = jest.fn<() => Promise<ComposerSnapshot>>();
    requestSnapshot.mockReturnValueOnce(previous.promise).mockResolvedValue(snapshot('保留的正文'));
    hook.result.current.editorRef.current = editorHandle({ requestSnapshot });
    let leaving!: Promise<boolean>;
    await act(() => {
      leaving = hook.result.current.leave();
    });
    await hook.rerender({ owner: runtimeFor('456') });
    await waitFor(() => expect(hook.result.current.draft?.identityKey).toBe('nodeseek:456'));
    const status = hook.result.current.saveStatus;
    await act(async () => {
      previous.reject(new Error('无法取得最新正文，草稿已保留'));
      expect(await leaving).toBe(false);
    });
    expect(hook.result.current.saveStatus).toBe(status);
  });

  it('automatically retries the optional emoji catalog without losing rules or the draft', async () => {
    const transport = createTopicProofTransport('success');
    const first = deferred<Record<string, string>>();
    const previous = deferred<Record<string, string>>();
    const getEmojiUrls = jest
      .fn<TopicComposerRouteRuntimeValue['getEmojiUrls']>()
      .mockReturnValueOnce(first.promise)
      .mockRejectedValueOnce(new Error('still offline'))
      .mockReturnValueOnce(previous.promise)
      .mockResolvedValue({ heart: 'https://linux.do/recovered-heart.png' });
    const notify = jest.fn();
    const owner = { ...runtimeFor('123', transport.fetcher), getEmojiUrls, notify };
    const saved = { ...emptyTopicDraft('linuxdo', 'linuxdo:123'), revision: 1, body: '保留的草稿' };
    const hook = await setup(saved, owner);
    const rules = hook.result.current.context;
    await waitFor(() => expect(getEmojiUrls).toHaveBeenCalledTimes(1));
    jest.useFakeTimers();
    try {
      await act(async () => first.reject(new Error('offline')));
      await act(async () => jest.advanceTimersByTimeAsync(1_000));
      expect(getEmojiUrls).toHaveBeenCalledTimes(2);
      await act(async () => jest.advanceTimersByTimeAsync(2_000));
      expect(getEmojiUrls).toHaveBeenCalledTimes(3);
      const previousSignal = getEmojiUrls.mock.calls[2]![0].signal;
      await hook.rerender({ owner: { ...owner, appActive: false } });
      expect(previousSignal?.aborted).toBe(true);
      await act(async () => previous.resolve({ heart: 'https://linux.do/obsolete-heart.png' }));
      await act(async () => jest.advanceTimersByTimeAsync(60_000));
      expect(getEmojiUrls).toHaveBeenCalledTimes(3);
      expect(hook.result.current.emojiUrls).toEqual({});
      await hook.rerender({ owner });
      await act(async () => jest.advanceTimersByTimeAsync(1));
      expect(hook.result.current.emojiUrls).toEqual({ heart: 'https://linux.do/recovered-heart.png' });
      await act(async () => jest.advanceTimersByTimeAsync(60_000));
      expect(getEmojiUrls).toHaveBeenCalledTimes(4);
      expect(hook.result.current.context).toBe(rules);
      expect(hook.result.current.contextLoading).toBe(false);
      expect(hook.result.current.draft?.body).toBe(saved.body);
      expect(notify).not.toHaveBeenCalled();
      expect(transport.writes).toEqual([]);
    } finally {
      first.resolve({});
      previous.resolve({});
      await hook.unmount();
      jest.useRealTimers();
    }
  });

  it.each(['identity', 'new document'] as const)('isolates an emoji catalog after a change of %s', async (change) => {
    const transport = createTopicProofTransport('success');
    const previous = deferred<Record<string, string>>();
    const current = deferred<Record<string, string>>();
    const getEmojiUrls = jest
      .fn<TopicComposerRouteRuntimeValue['getEmojiUrls']>()
      .mockReturnValueOnce(previous.promise)
      .mockReturnValue(current.promise);
    const owner = { ...runtimeFor('123', transport.fetcher), getEmojiUrls };
    const saved = { ...emptyTopicDraft('linuxdo', 'linuxdo:123'), revision: 1, body: '旧草稿' };
    const hook = await setup(saved, owner);
    await waitFor(() => expect(getEmojiUrls).toHaveBeenCalledTimes(1));
    const previousSignal = getEmojiUrls.mock.calls[0]![0].signal;
    if (change === 'identity') {
      await hook.rerender({ owner: { ...runtimeFor('456', transport.fetcher), getEmojiUrls } });
    } else {
      jest
        .spyOn(Alert, 'alert')
        .mockImplementation((_title, _message, buttons) =>
          buttons?.find((button) => button.text === '丢弃')?.onPress?.()
        );
      await act(async () => hook.result.current.discard());
    }
    await waitFor(() => expect(getEmojiUrls).toHaveBeenCalledTimes(2));
    expect(previousSignal?.aborted).toBe(true);
    const draft = hook.result.current.draft;
    expect(draft?.id).not.toBe(saved.id);
    jest.useFakeTimers();
    try {
      await act(async () => previous.resolve({ heart: 'https://linux.do/obsolete-heart.png' }));
      await act(async () => jest.advanceTimersByTimeAsync(60_000));
      expect(getEmojiUrls).toHaveBeenCalledTimes(2);
      expect(hook.result.current.emojiUrls).toEqual({});
      await act(async () => current.resolve({ heart: 'https://linux.do/current-heart.png' }));
      expect(hook.result.current.emojiUrls).toEqual({ heart: 'https://linux.do/current-heart.png' });
      expect(hook.result.current.draft).toEqual(draft);
      expect(transport.writes).toEqual([]);
    } finally {
      previous.resolve({});
      current.resolve({});
      await hook.unmount();
      jest.useRealTimers();
    }
  });

  it('keeps loaded linux.do rules usable when the optional emoji read requires verification', async () => {
    const transport = createTopicProofTransport('success');
    const emojis = deferred<Record<string, string>>();
    const notify = jest.fn();
    const owner = {
      ...runtimeFor('123', transport.fetcher),
      getEmojiUrls: () => emojis.promise,
      notify
    };
    const saved = { ...emptyTopicDraft('linuxdo', 'linuxdo:123'), revision: 1 };
    const hook = await setup(saved, owner);
    const loaded = hook.result.current.context;
    expect(hook.result.current.contextLoading).toBe(false);
    await act(async () => {
      emojis.reject(
        Object.assign(new Error('linux.do 需要完成 Cloudflare 验证'), {
          source: 'linuxdo',
          verificationRequired: true
        })
      );
    });
    await waitFor(() => expect(hook.result.current.contextLoading).toBe(false));
    expect(hook.result.current.context).toEqual(loaded);
    expect(hook.result.current.contextError).toBe('');
    expect(hook.result.current.contextNeedsVerification).toBe(false);
    expect(notify).not.toHaveBeenCalled();
    expect(transport.writes).toEqual([]);
  });

  it('loads linux.do creation rules through the managed read capability instead of the write transport', async () => {
    const runtime = runtimeFor();
    const loadRules = jest.fn(async () => ({
      source: 'linuxdo' as const,
      categories: [{ id: '4', name: '技术', canCreate: true }],
      titleMin: 6,
      titleMax: 255,
      bodyMin: 20,
      bodyMax: 64000,
      maxTags: 8,
      canCreateTag: false,
      postVotingEnabled: false,
      allowedExtensions: ['png'],
      maxImageBytes: 4096 * 1024,
      maxAttachmentBytes: 4096 * 1024,
      canUploadAttachments: true,
      pollCapabilities: { groups: [], canUseStaffResults: false }
    }));
    const native = jest.fn<Fetcher>(async () => response('Cloudflare challenge', 403));
    const owner = { ...runtime, fetcher: native, getLinuxDoTopicCreationContext: loadRules };
    const hook = await renderHook(() =>
      useTopicComposerController({
        runtime: owner,
        intent: { kind: 'create', initialSource: 'linuxdo' },
        active: true,
        onPosted: () => {},
        onAccepted: () => {}
      })
    );
    await waitFor(() => expect(hook.result.current.context?.source).toBe('linuxdo'));
    expect(loadRules).toHaveBeenCalledTimes(1);
    expect(loadRules).toHaveBeenCalledWith({ source: 'linuxdo', signal: expect.any(AbortSignal) });
    expect(native).not.toHaveBeenCalled();
  });

  it.each([true, false])('offers explicit account verification only for an authentication error (%s)', async (auth) => {
    const failure = Object.assign(new Error('规则读取受阻'), auth ? { loginRequired: true } : { status: 403 });
    const openAccount = jest.fn<TopicComposerRouteRuntimeValue['openAccount']>();
    const runtime = {
      ...runtimeFor(),
      getLinuxDoTopicCreationContext: async () => {
        throw failure;
      },
      openAccount
    };
    const hook = await renderHook(() =>
      useTopicComposerController({
        runtime,
        intent: { kind: 'create', initialSource: 'linuxdo' },
        active: true,
        onPosted: () => {},
        onAccepted: () => {}
      })
    );
    await waitFor(() => expect(hook.result.current.contextError).toBe('规则读取受阻'));
    expect(hook.result.current.contextNeedsVerification).toBe(auth);
    expect(openAccount).not.toHaveBeenCalled();
  });

  it('retains the edited draft and refuses leaving or changing sites when durable save fails', async () => {
    const hook = await setup();
    await act(() => hook.result.current.change((draft) => ({ ...draft, title: '未保存的新标题' })));
    mockDiskFailure = true;
    await act(async () => {
      expect(await hook.result.current.leave()).toBe(false);
      await hook.result.current.switchSource('yaohuo');
    });
    expect(hook.result.current.source).toBe('nodeseek');
    expect(hook.result.current.draft?.title).toBe('未保存的新标题');
    expect(hook.result.current.saveStatus).toContain('保存失败');
    mockDiskFailure = false;
    await act(async () => {
      expect(await hook.result.current.leave()).toBe(true);
    });
    expect((await loadTopicDraft('nodeseek', 'nodeseek:123'))?.title).toBe('未保存的新标题');
  });

  it('retains the original account draft after a failed account transition and restores the new account only after retry saves it', async () => {
    const hook = await setup();
    await act(() => hook.result.current.change((draft) => ({ ...draft, body: '账号 A 的未保存内容' })));
    mockDiskFailure = true;
    await hook.rerender({ owner: runtimeFor('456') });
    await waitFor(() => expect(hook.result.current.error).toContain('disk unavailable'));
    expect(hook.result.current.draft?.identityKey).toBe('nodeseek:123');
    await act(() => hook.result.current.change((draft) => ({ ...draft, body: '不能写入账号 B' })));
    expect(hook.result.current.draft?.body).toBe('账号 A 的未保存内容');
    mockDiskFailure = false;
    await act(() => hook.result.current.retryDraft());
    await waitFor(() => expect(hook.result.current.draft?.identityKey).toBe('nodeseek:456'));
    expect(hook.result.current.draft?.body).toBe('');
    expect((await loadTopicDraft('nodeseek', 'nodeseek:123'))?.body).toBe('账号 A 的未保存内容');
  });

  it('does not overwrite another writer or leave after CAS rejects the current version', async () => {
    const saved = storedDraft();
    const hook = await setup(saved);
    await act(() => hook.result.current.change((draft) => ({ ...draft, title: '此页改动' })));
    await saveTopicDraft({ ...saved, revision: 50, title: '其他页面改动' });
    await act(async () => {
      expect(await hook.result.current.leave()).toBe(false);
    });
    expect(hook.result.current.draft?.title).toBe('此页改动');
    expect((await loadTopicDraft('nodeseek', 'nodeseek:123'))?.title).toBe('其他页面改动');
  });

  it('persists missing-file recovery with a newer revision and preserves the rest of the draft', async () => {
    const saved = storedDraft();
    saved.attachments = [attachment(saved)];
    mockMissingFiles = true;
    const hook = await setup(saved);
    expect(hook.result.current.draft?.body).toBe(saved.body);
    const restored = await loadTopicDraft('nodeseek', 'nodeseek:123');
    expect(restored?.revision).toBe(2);
    expect(restored?.attachments[0]).toMatchObject({ status: 'failed', error: '本机附件已丢失或变化，请重新选择文件' });
  });

  it('keeps the draft and all attachment files when discard cannot commit', async () => {
    const saved = storedDraft();
    saved.attachments = [attachment(saved)];
    const hook = await setup(saved);
    jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_title, _message, buttons) =>
        buttons?.find((button) => button.text === '丢弃')?.onPress?.()
      );
    mockDiskFailure = true;
    await act(async () => {
      await hook.result.current.discard();
    });
    expect(hook.result.current.draft?.id).toBe(saved.id);
    expect(mockDeletedFiles).toEqual([]);
    expect((await loadTopicDraft('nodeseek', saved.identityKey))?.id).toBe(saved.id);
  });

  it('starts one transient placeholder per file before HTTP and durably records each link before replacing it', async () => {
    const begin = deferred<string>();
    const firstUpload = deferred<Response>();
    const saved = storedDraft();
    saved.attachments = [attachment(saved), attachment(saved, 'file-two')];
    let posts = 0;
    const hook = await setup(
      saved,
      runtimeFor('123', async (url, init) => {
        prepareRequestToSend(init);
        if (url.includes('api.nodeimage')) {
          posts++;
          return posts === 1 ? firstUpload.promise : response('{"url":"https://img.invalid/two.gif"}');
        }
        return response(`<script>decode('${config}')</script>`);
      })
    );
    const beginImageUpload = jest
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(begin.promise)
      .mockResolvedValueOnce('second-placeholder');
    const finishImageUpload = jest.fn(async (id: string, markup?: string) => {
      if (!markup) return;
      const savedNow = await loadTopicDraft(saved.source, saved.identityKey);
      const index = id === 'first-placeholder' ? 0 : 1;
      expect(savedNow?.attachments[index]).toMatchObject({ status: 'uploaded', markup });
      expect(savedNow?.body).toBe(saved.body);
    });
    const insertMarkup = jest.fn(async () => {});
    hook.result.current.editorRef.current = editorHandle({ beginImageUpload, finishImageUpload, insertMarkup });
    let pending!: Promise<string | undefined>;
    await act(() => {
      pending = hook.result.current.uploadFiles(saved.attachments);
    });
    await waitFor(() => expect(beginImageUpload).toHaveBeenCalledTimes(1));
    expect(posts).toBe(0);
    expect((await loadTopicDraft(saved.source, saved.identityKey))?.body).toBe(saved.body);
    await act(async () => {
      begin.resolve('first-placeholder');
    });
    await waitFor(() => expect(posts).toBe(1));
    await act(async () => {
      firstUpload.resolve(response('{"url":"https://img.invalid/one.gif"}'));
      await pending;
    });
    expect(beginImageUpload).toHaveBeenCalledTimes(2);
    expect(finishImageUpload).toHaveBeenNthCalledWith(1, 'first-placeholder', expect.stringContaining('/one.gif'));
    expect(finishImageUpload).toHaveBeenNthCalledWith(2, 'second-placeholder', expect.stringContaining('/two.gif'));
    expect(insertMarkup).not.toHaveBeenCalled();
    expect(posts).toBe(2);
  });

  it('clears a failed upload placeholder while preserving the local file and unknown receipt', async () => {
    const saved = storedDraft();
    saved.attachments = [attachment(saved)];
    const hook = await setup(
      saved,
      runtimeFor('123', async (url, init) => {
        prepareRequestToSend(init);
        if (url.includes('api.nodeimage')) throw new Error('connection lost');
        return response(`<script>decode('${config}')</script>`);
      })
    );
    const finishImageUpload = jest.fn(async () => {});
    hook.result.current.editorRef.current = editorHandle({ finishImageUpload });
    await act(async () => {
      await hook.result.current.uploadFiles(saved.attachments);
    });
    expect(finishImageUpload).toHaveBeenCalledWith('upload-placeholder');
    expect((await loadTopicDraft(saved.source, saved.identityKey))?.attachments[0]).toMatchObject({
      uri: saved.attachments[0]!.uri,
      status: 'unknown'
    });
    expect(mockDeletedFiles).toEqual([]);
  });

  it('sends no upload when the editor rejects its placeholder and preserves the file for retry', async () => {
    const saved = storedDraft();
    saved.attachments = [attachment(saved)];
    let posts = 0;
    const hook = await setup(
      saved,
      runtimeFor('123', async (url, init) => {
        prepareRequestToSend(init);
        if (url.includes('api.nodeimage')) posts++;
        return response(`<script>decode('${config}')</script>`);
      })
    );
    hook.result.current.editorRef.current = editorHandle({
      beginImageUpload: async () => {
        throw new Error('请先退出预览');
      }
    });
    await act(async () => {
      await hook.result.current.uploadFiles(saved.attachments);
    });
    expect(posts).toBe(0);
    expect(hook.result.current.error).toBe('请先退出预览');
    expect((await loadTopicDraft(saved.source, saved.identityKey))?.attachments[0]).toMatchObject({
      uri: saved.attachments[0]!.uri,
      status: 'failed',
      error: '请先退出预览'
    });
    expect(mockDeletedFiles).toEqual([]);
  });

  it('keeps an uploaded link in the original account when its response arrives after an account switch', async () => {
    const upload = deferred<Response>();
    let sent = false;
    const fetcher: Fetcher = async (url, init) => {
      prepareRequestToSend(init);
      if (url.includes('api.nodeimage')) {
        sent = true;
        return upload.promise;
      }
      return response(`<script>decode('${config}')</script>`);
    };
    const saved = storedDraft();
    saved.attachments = [attachment(saved)];
    const hook = await setup(saved, runtimeFor('123', fetcher));
    const oldFinish = jest.fn(async () => {});
    const newFinish = jest.fn(async () => {});
    hook.result.current.editorRef.current = editorHandle({ finishImageUpload: oldFinish });
    let pending!: Promise<string | undefined>;
    await act(() => {
      pending = hook.result.current.uploadFiles(saved.attachments);
    });
    await waitFor(() => expect(sent).toBe(true));
    await hook.rerender({ owner: runtimeFor('456', fetcher) });
    hook.result.current.editorRef.current = editorHandle({ finishImageUpload: newFinish });
    await act(async () => {
      upload.resolve(response('{"links":{"direct":"https://img.invalid/one.gif"}}'));
      await pending;
    });
    await waitFor(() => expect(hook.result.current.draft?.identityKey).toBe('nodeseek:456'));
    expect(hook.result.current.draft?.attachments).toEqual([]);
    const original = await loadTopicDraft('nodeseek', 'nodeseek:123');
    expect(original?.attachments[0]).toMatchObject({
      status: 'uploaded',
      markup: expect.stringContaining('https://img.invalid/one.gif')
    });
    expect(oldFinish).toHaveBeenCalledWith('upload-placeholder');
    expect(newFinish).not.toHaveBeenCalled();
  });

  it('captures the NodeImage credential generation after key acquisition', async () => {
    let posts = 0;
    const owner = runtimeFor('123', async (url, init) => {
      prepareRequestToSend(init);
      if (url.includes('api.nodeimage')) {
        posts++;
        return response('{"url":"https://img.invalid/new-key.gif"}');
      }
      return response(`<script>decode('${config}')</script>`);
    });
    owner.ensureNodeImageApiKey = async () => {
      jest.mocked(currentNodeImageApiKeyGeneration).mockReturnValue(2);
      return 'new-key';
    };
    const saved = storedDraft();
    saved.attachments = [attachment(saved)];
    const hook = await setup(saved, owner);
    const beginImageUpload = jest.fn(async () => 'host-upload-placeholder');
    const finishImageUpload = jest.fn(async () => {});
    hook.result.current.editorRef.current = editorHandle({ beginImageUpload, finishImageUpload });
    await act(async () => {
      await hook.result.current.uploadFiles(saved.attachments, false);
    });
    expect(hook.result.current.error).toBe('');
    expect(posts).toBe(1);
    expect(hook.result.current.draft?.attachments[0]?.status).toBe('uploaded');
    expect(beginImageUpload).not.toHaveBeenCalled();
    expect(finishImageUpload).not.toHaveBeenCalled();
  });

  it('makes staying during an upload explicit and preserves a confirmed link when editor insertion fails', async () => {
    const upload = deferred<Response>();
    let sent = false;
    const saved = storedDraft();
    saved.attachments = [attachment(saved)];
    const hook = await setup(
      saved,
      runtimeFor('123', async (url, init) => {
        prepareRequestToSend(init);
        if (url.includes('api.nodeimage')) {
          sent = true;
          return upload.promise;
        }
        return response(`<script>decode('${config}')</script>`);
      })
    );
    hook.result.current.editorRef.current = editorHandle({
      finishImageUpload: async (_id, markup) => {
        if (markup) throw new Error('编辑器插入失败');
      }
    });
    let pending!: Promise<string | undefined>;
    await act(() => {
      pending = hook.result.current.uploadFiles(saved.attachments);
    });
    await waitFor(() => expect(sent).toBe(true));
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      expect(buttons?.map((button) => button.text)).toEqual(['留在此页', '取消剩余上传', '等待上传完成']);
      buttons?.[0]?.onPress?.();
    });
    await act(async () => {
      expect(await hook.result.current.leave()).toBe(false);
    });
    await act(async () => {
      upload.resolve(response('{"url":"https://img.invalid/retained.gif"}'));
      await pending;
    });
    expect((await loadTopicDraft('nodeseek', saved.identityKey))?.attachments[0]?.status).toBe('uploaded');
    expect(hook.result.current.error).toContain('图片已上传，可在“更多 → 图片上传记录”中再次插入');
  });

  it('retains picked files without uploading when the picker returns in the background', async () => {
    const picker = deferred<DocumentPicker.DocumentPickerResult>();
    jest.mocked(DocumentPicker.getDocumentAsync).mockReturnValueOnce(picker.promise);
    let posts = 0;
    const owner = runtimeFor('123', async (_url, init) => {
      prepareRequestToSend(init);
      if (init?.method === 'POST') posts++;
      return response(`<script>decode('${config}')</script>`);
    });
    const prompt = jest.spyOn(Alert, 'alert');
    const saved = storedDraft();
    const hook = await setup(saved, owner);
    let pending!: Promise<string | undefined | void>;
    await act(() => {
      pending = hook.result.current.pickAttachments('image');
    });
    await waitFor(() => expect(DocumentPicker.getDocumentAsync).toHaveBeenCalled());
    await hook.rerender({ owner: { ...owner, appActive: false } });
    await act(async () => {
      picker.resolve({
        canceled: false,
        assets: [{ uri: 'file:///picker.gif', name: 'picker.gif', mimeType: 'image/gif', size: 20, lastModified: 0 }]
      });
      await pending;
    });
    expect(hook.result.current.draft?.attachments).toHaveLength(1);
    expect((await loadTopicDraft('nodeseek', saved.identityKey))?.attachments[0]).toMatchObject({
      name: 'picker.gif',
      status: 'queued'
    });
    expect(prompt).not.toHaveBeenCalled();
    expect(posts).toBe(0);
    expect(hook.result.current.error).toBe('站点或账号已变化，请重新确认后重试');
    await hook.rerender({ owner });
    expect(hook.result.current.draft?.attachments).toHaveLength(1);
  });

  it('rejects picked files when the writable ticket expires even before the foreground commit', async () => {
    const picker = deferred<DocumentPicker.DocumentPickerResult>();
    jest.mocked(DocumentPicker.getDocumentAsync).mockReturnValueOnce(picker.promise);
    const owner = runtimeFor();
    const hook = await setup(storedDraft(), owner);
    const prompt = jest.spyOn(Alert, 'alert');
    let pending!: Promise<string | undefined | void>;
    await act(() => {
      pending = hook.result.current.pickAttachments('image');
    });
    await waitFor(() => expect(DocumentPicker.getDocumentAsync).toHaveBeenCalled());
    await hook.rerender({
      owner: { ...owner, appActive: false, isWritableSessionTicketCurrent: () => false }
    });
    await act(async () => {
      picker.resolve({
        canceled: false,
        assets: [{ uri: 'file:///picker.gif', name: 'picker.gif', mimeType: 'image/gif', size: 20, lastModified: 0 }]
      });
      await pending;
    });
    expect(hook.result.current.draft?.attachments).toEqual([]);
    expect(prompt).not.toHaveBeenCalled();
    expect(hook.result.current.error).toBe('站点或账号已变化，请重新确认后重试');
  });

  it('ignores a picker result returned after its account was replaced', async () => {
    const picker = deferred<DocumentPicker.DocumentPickerResult>();
    jest.mocked(DocumentPicker.getDocumentAsync).mockReturnValueOnce(picker.promise);
    const hook = await setup();
    let pending!: Promise<string | undefined | void>;
    await act(() => {
      pending = hook.result.current.pickAttachments('image');
    });
    await waitFor(() => expect(DocumentPicker.getDocumentAsync).toHaveBeenCalled());
    await hook.rerender({ owner: runtimeFor('456') });
    await waitFor(() => expect(hook.result.current.draft?.identityKey).toBe('nodeseek:456'));
    await act(async () => {
      picker.resolve({
        canceled: false,
        assets: [{ uri: 'file:///picker.gif', name: 'picker.gif', mimeType: 'image/gif', size: 20, lastModified: 0 }]
      });
      await pending;
    });
    expect(hook.result.current.draft?.attachments).toEqual([]);
  });

  it('retains earlier uploaded files and marks a dispatched canceled upload unknown before allowing leave', async () => {
    const waiting = deferred<Response>();
    let posts = 0;
    const saved = storedDraft();
    saved.attachments = [attachment(saved), attachment(saved, 'file-two')];
    const hook = await setup(
      saved,
      runtimeFor('123', async (url, init) => {
        prepareRequestToSend(init);
        if (url.includes('api.nodeimage')) {
          posts++;
          return posts === 1 ? response('{"url":"https://img.invalid/first.gif"}') : waiting.promise;
        }
        return response(`<script>decode('${config}')</script>`);
      })
    );
    let pending!: Promise<string | undefined>;
    await act(() => {
      pending = hook.result.current.uploadFiles(saved.attachments, false);
    });
    await waitFor(() => expect(posts).toBe(2));
    jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_title, _message, buttons) =>
        buttons?.find((button) => button.text === '取消剩余上传')?.onPress?.()
      );
    await act(async () => {
      expect(await hook.result.current.leave()).toBe(true);
      await pending;
    });
    expect((await loadTopicDraft('nodeseek', saved.identityKey))?.attachments.map((file) => file.status)).toEqual([
      'uploaded',
      'unknown'
    ]);
    waiting.resolve(response('{"url":"https://img.invalid/late.gif"}'));
    jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_title, _message, buttons) =>
        buttons?.find((button) => button.text === '取消')?.onPress?.()
      );
    await act(async () => {
      await hook.result.current.uploadFiles([hook.result.current.draft!.attachments[1]], false);
    });
    expect(posts).toBe(2);
  });

  it('settles 20 repeated picker and upload cancellation/retry cycles without losing receipts or retaining files', async () => {
    const saved = storedDraft();
    const transport = createTopicProofTransport('success');
    const responses: (Response | Promise<Response>)[] = [];
    const requests: Promise<Response>[] = [];
    const signals: AbortSignal[] = [];
    const held = new Set<ReturnType<typeof deferred<Response>>>();
    const pickers = new Set<ReturnType<typeof deferred<DocumentPicker.DocumentPickerResult>>>();
    const actions: Promise<unknown>[] = [];
    let active = 0;
    let peak = 0;
    const hook = await setup(
      saved,
      runtimeFor('123', (url, init) => {
        if (url !== 'https://api.nodeimage.com/api/upload') return transport.fetcher(url, init);
        prepareRequestToSend(init);
        signals.push(init!.signal!);
        const result = responses.shift();
        const request = (async () => {
          peak = Math.max(peak, ++active);
          try {
            if (!result) throw new Error('Unexpected upload in pressure fixture');
            return await result;
          } finally {
            active--;
          }
        })();
        requests.push(request);
        return request;
      })
    );
    hook.result.current.editorRef.current = editorHandle();
    let choice = '取消剩余上传';
    const alerts = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const selected = buttons?.find((button) => button.text === choice);
      expect(selected).toBeDefined();
      selected?.onPress?.();
    });
    const success = (cycle: number, name: string) =>
      response(JSON.stringify({ url: `https://img.invalid/${cycle}-${name}.gif` }));
    try {
      for (let cycle = 0; cycle < 20; cycle++) {
        const canceledPicker = deferred<DocumentPicker.DocumentPickerResult>();
        pickers.add(canceledPicker);
        jest.mocked(DocumentPicker.getDocumentAsync).mockReturnValueOnce(canceledPicker.promise);
        let selecting: Promise<unknown>[] = [];
        await act(() => {
          selecting = Array.from({ length: 20 }, () => hook.result.current.pickAttachments('image', true));
          actions.push(...selecting);
        });
        await waitFor(() => expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledTimes(cycle * 2 + 1));
        await act(async () => {
          canceledPicker.resolve({ canceled: true, assets: null });
          await Promise.all(selecting);
        });
        pickers.delete(canceledPicker);
        expect(hook.result.current.draft?.attachments).toEqual([]);
        expect(requests).toHaveLength(cycle * 5);

        const canceledUpload = deferred<Response>();
        held.add(canceledUpload);
        responses.push(success(cycle, 'first'), canceledUpload.promise);
        jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({
          canceled: false,
          assets: [0, 1, 2].map((index) => ({
            uri: `file:///picked-${cycle}-${index}.gif`,
            name: `picked-${index}.gif`,
            mimeType: 'image/gif',
            size: 20,
            lastModified: 0
          }))
        });
        await act(() => {
          selecting = Array.from({ length: 20 }, () => hook.result.current.pickAttachments('image', true));
          actions.push(...selecting);
        });
        await waitFor(() => expect(requests).toHaveLength(cycle * 5 + 2));
        expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledTimes(cycle * 2 + 2);
        expect(active).toBe(1);
        choice = '取消剩余上传';
        await act(async () => {
          expect(await hook.result.current.leave()).toBe(true);
          await Promise.all(selecting);
        });
        expect(signals.at(-1)?.aborted).toBe(true);
        const canceled = await loadTopicDraft(saved.source, saved.identityKey);
        expect(canceled?.attachments.map((file) => file.status)).toEqual(['uploaded', 'unknown', 'queued']);
        await act(async () => {
          canceledUpload.resolve(success(cycle, 'late'));
          await Promise.all(requests);
        });
        held.delete(canceledUpload);
        expect(await loadTopicDraft(saved.source, saved.identityKey)).toEqual(canceled);
        expect(active).toBe(0);

        choice = '取消';
        await act(async () => {
          await hook.result.current.uploadFiles(hook.result.current.draft!.attachments, false);
        });
        expect(requests).toHaveLength(cycle * 5 + 2);
        choice = '已核对，重新上传';
        responses.push(response('{"message":"Synthetic rejected upload"}', 422));
        await act(async () => {
          await hook.result.current.uploadFiles(hook.result.current.draft!.attachments, false);
        });
        expect(requests).toHaveLength(cycle * 5 + 3);
        expect((await loadTopicDraft(saved.source, saved.identityKey))?.attachments.map((file) => file.status)).toEqual(
          ['uploaded', 'failed', 'queued']
        );

        const recovering = deferred<Response>();
        held.add(recovering);
        responses.push(recovering.promise, success(cycle, 'third'));
        let retries: Promise<unknown>[] = [];
        await act(() => {
          retries = Array.from({ length: 20 }, () =>
            hook.result.current.uploadFiles(hook.result.current.draft!.attachments, false)
          );
          actions.push(...retries);
        });
        await waitFor(() => expect(requests).toHaveLength(cycle * 5 + 4));
        expect(active).toBe(1);
        await act(async () => {
          recovering.resolve(success(cycle, 'second'));
          await Promise.all(retries);
        });
        held.delete(recovering);
        expect(requests).toHaveLength(cycle * 5 + 5);
        const complete = await loadTopicDraft(saved.source, saved.identityKey);
        expect(complete?.body).toBe(saved.body);
        expect(complete?.attachments.map((file) => file.status)).toEqual(['uploaded', 'uploaded', 'uploaded']);
        for (const [index, name] of ['first', 'second', 'third'].entries())
          expect(complete?.attachments[index]?.markup).toContain(`/${cycle}-${name}.gif`);
        expect(hook.result.current.uploading).toBe(false);
        expect(hook.result.current.error).toBe('');
        await act(async () => {
          for (const file of complete!.attachments) await hook.result.current.removeAttachment(file);
        });
        expect((await loadTopicDraft(saved.source, saved.identityKey))?.attachments).toEqual([]);
        expect(mockDeletedFiles).toHaveLength((cycle + 1) * 3);
        expect(active).toBe(0);
      }
      expect(peak).toBe(1); // The production queue awaits each file before dispatching the next one.
      expect(alerts).toHaveBeenCalledTimes(60);
      expect(new Set(mockDeletedFiles).size).toBe(60);
      expect(responses).toEqual([]);
      expect(transport.blockedRequests).toBe(0);
    } finally {
      await hook.unmount();
      await act(async () => {
        for (const picker of pickers) picker.resolve({ canceled: true, assets: null });
        for (const item of held) item.resolve(success(99, 'cleanup'));
        await Promise.allSettled([...actions, ...requests]);
      });
    }
  }, 40_000);

  it('does not delete an attachment file while removing its durable reference fails', async () => {
    const saved = storedDraft();
    saved.attachments = [attachment(saved)];
    const hook = await setup(saved);
    mockDiskFailure = true;
    await act(async () => {
      await hook.result.current.removeAttachment(saved.attachments[0]);
    });
    expect(mockDeletedFiles).toEqual([]);
    expect((await loadTopicDraft('nodeseek', saved.identityKey))?.attachments).toHaveLength(1);
    await act(async () => {
      expect(await hook.result.current.leave()).toBe(false);
    });
  });
});
