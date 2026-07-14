import { afterEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
  runLinuxDoAction: vi.fn(),
  runNodeSeekAction: vi.fn(),
  runYaohuoAction: vi.fn()
}));

vi.mock('react', () => ({
  useCallback: <T,>(callback: T) => callback,
  useMemo: <T,>(factory: () => T) => factory(),
  useRef: <T,>(value: T) => ({ current: value })
}));

vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() }
}));

vi.mock('expo-document-picker', () => ({
  getDocumentAsync: vi.fn()
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => JSON.stringify({
    cookieHeader: 'session=fake-credential',
    savedAt: '2026-07-10T00:00:00.000Z',
    source: 'webview'
  }))
}));

vi.mock('../nodeseekActionClient', () => ({
  runNodeSeekAction: actionMocks.runNodeSeekAction
}));

vi.mock('../linuxdoActionClient', () => ({
  runLinuxDoAction: actionMocks.runLinuxDoAction
}));

vi.mock('../yaohuoActionClient', () => ({
  runYaohuoAction: actionMocks.runYaohuoAction
}));

vi.mock('../linuxdoCookieBridge', () => ({
  clearLinuxDoAccess: vi.fn(),
  clearLinuxDoAccessForGeneration: vi.fn(),
  currentLinuxDoAccessGeneration: vi.fn(() => 1),
  linuxDoAccessSummary: vi.fn(() => ({ loggedIn: true })),
  loadLinuxDoAccess: vi.fn(async () => ({ cookieHeader: '_t=fake-credential', userAgent: 'ua' })),
  parseLinuxDoDocumentCookie: vi.fn(() => ({})),
  summarizeLinuxDoCookies: vi.fn(() => ({ names: [] }))
}));

import { clearLinuxDoAccessForGeneration } from '../linuxdoCookieBridge';
import { createRequestOwner } from '../requestOwnership';
import { createSiteSessionStates } from '../siteSessionState';
import type { TopicRepliesRefreshOptions } from '../appTypes';
import type { Fetcher } from '../request';
import type { Source, TopicDetail } from '../types';
import { setDiagnosticWriter, type DiagnosticEvent } from '../diagnostics';
import { clearExpiredLinuxDoLogin } from './topicActionHelpers';
import { useTopicActionsController } from './useTopicActionsController';
import type { TopicSessionController } from './useTopicSessionController';

function createTopicActionController({
  applyUpdate = vi.fn(),
  completeSubmission = vi.fn(),
  fetcher = vi.fn(),
  notify = vi.fn(),
  refreshTopicReplies = vi.fn(async () => undefined),
  replyContent = '',
  source = 'nodeseek'
}: {
  applyUpdate?: ReturnType<typeof vi.fn>;
  completeSubmission?: ReturnType<typeof vi.fn>;
  fetcher?: Fetcher;
  notify?: (message: string) => void;
  refreshTopicReplies?: (options?: TopicRepliesRefreshOptions) => Promise<unknown>;
  replyContent?: string;
  source?: Extract<Source, 'nodeseek' | 'linuxdo' | 'yaohuo'>;
} = {}) {
  const detail: TopicDetail = {
    source,
    id: '424242',
    title: 'private title',
    author: 'private author',
    url: 'https://www.nodeseek.com/post-42-1',
    createdAt: '2026-07-10T00:00:00.000Z',
    replyCount: 0,
    contentHtml: '<p>private body</p>',
    replies: [],
    commentId: 987654,
    liked: false
  };
  const optimisticTopicActionsRef = { current: {} };
  const siteSessionStates = createSiteSessionStates();
  siteSessionStates[source] = {
    site: source,
    status: 'logged-in',
    cookieSummary: [],
    isVerifying: false
  };
  const controller = useTopicActionsController({
    actionAbortRef: { current: null },
    clearNodeSeekLoginCookiesOnly: vi.fn(async () => undefined),
    clearYaohuoLoginState: vi.fn(async () => undefined),
    currentNodeSeekCredentialGeneration: () => 1,
    ensureNodeImageApiKey: vi.fn(async () => null),
    fetcher,
    linuxDoWebViewUserAgentRef: { current: 'ua' },
    loadYaohuoCookieForSource: vi.fn(async () => source === 'yaohuo' ? 'sidyaohuo=fake-credential' : undefined),
    nodeSeekWebViewUserAgentRef: { current: 'ua' },
    notify,
    optimisticTopicActionsRef,
    refreshTopicReplies,
    resetLinuxDoLevelState: vi.fn(),
    setActionBusy: vi.fn(),
    setOptimisticTopicActions: vi.fn(),
    showLinuxDoLogin: vi.fn(),
    showYaohuoLogin: vi.fn(),
    siteSessionStates,
    topicActionRequestOwnerRef: { current: createRequestOwner('topic') },
    topicSession: {
      state: {
        replyContent,
        replyEditTarget: null,
        replyFace: undefined,
        replyTarget: null,
        selectedTopic: detail,
        topicDetail: detail,
        topicReplies: []
      },
      commands: {
        actions: { applyUpdate },
        composer: {
          appendMarkup: vi.fn(),
          completeSubmission
        }
      }
    } as unknown as TopicSessionController,
    updateLinuxDoSession: vi.fn()
  });
  return { applyUpdate, completeSubmission, controller, detail, optimisticTopicActionsRef };
}

afterEach(() => {
  setDiagnosticWriter(null);
  vi.clearAllMocks();
});

describe('topic action auth guards', () => {
  it('marks linux.do expired only when an expired request clears stored access', async () => {
    vi.mocked(clearLinuxDoAccessForGeneration).mockResolvedValueOnce(null);
    const resetLinuxDoLevelState = vi.fn();
    const updateLinuxDoSession = vi.fn();

    await clearExpiredLinuxDoLogin({
      error: new Error('linux.do 登录已失效，请重新登录。'),
      generation: 3,
      cookieHeader: 'cf_clearance=old; _t=old',
      resetLinuxDoLevelState,
      updateLinuxDoSession
    });

    expect(clearLinuxDoAccessForGeneration).toHaveBeenCalledWith(3, 'cf_clearance=old; _t=old');
    expect(updateLinuxDoSession).toHaveBeenCalledWith({
      type: 'login-expired',
      message: 'linux.do 登录已失效，请重新登录。'
    });
    expect(resetLinuxDoLevelState).toHaveBeenCalledTimes(1);
  });

  it('traces an optimistic interaction through rollback without leaking action data', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    actionMocks.runNodeSeekAction.mockRejectedValueOnce(new Error('Network request failed token=secret https://www.nodeseek.com/private?id=987654'));
    const { applyUpdate, controller } = createTopicActionController();

    await controller.interact('like', 987654);
    await vi.waitFor(() => {
      expect(lines.some((line) => line.includes('"phase":"finish"'))).toBe(true);
    });

    const events = lines.map((line) => JSON.parse(line) as DiagnosticEvent);
    expect(events.map((event) => event.phase)).toEqual(expect.arrayContaining([
      'intent',
      'guard',
      'apply',
      'credential',
      'transport',
      'rollback',
      'finish'
    ]));
    expect(new Set(events.map((event) => event.traceId)).size).toBe(1);
    expect(events.filter((event) => event.phase === 'finish')).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      area: 'topic',
      operation: 'interaction',
      outcome: 'failure'
    });
    expect(applyUpdate).toHaveBeenCalledTimes(2);
    expect(lines.join('')).not.toMatch(/987654|424242|private title|private author|private body|fake-credential|token=secret|nodeseek\.com/);
  });

  it('records a submitted reply as partial when the follow-up refresh fails', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    actionMocks.runNodeSeekAction.mockImplementationOnce(async ({ fetcher }: { fetcher: Fetcher }) => {
      await fetcher('https://www.nodeseek.com/api/private?id=42', { method: 'POST' });
      return {};
    });
    const fetcher = vi.fn(async () => new Response('{}', {
      status: 201,
      headers: {
        'content-length': '2',
        'content-type': 'application/json; charset=utf-8'
      }
    }));
    const refreshTopicReplies = vi.fn(async () => {
      throw new Error('refresh failed https://www.nodeseek.com/private?id=42');
    });
    const replyContent = 'safe reply body that must not be logged';
    const { completeSubmission, controller } = createTopicActionController({ fetcher, replyContent, refreshTopicReplies });

    await expect(controller.submitReply()).rejects.toThrow('refresh failed');

    const events = lines.map((line) => JSON.parse(line) as DiagnosticEvent);
    expect(events[0]).toMatchObject({
      area: 'reply',
      operation: 'submit',
      phase: 'intent',
      contentLength: replyContent.length
    });
    expect(events.map((event) => event.phase)).toEqual(expect.arrayContaining([
      'guard',
      'credential',
      'transport',
      'apply',
      'finish'
    ]));
    expect(events).toContainEqual(expect.objectContaining({
      phase: 'transport',
      endpoint: 'action',
      method: 'POST',
      status: 201,
      contentType: 'application/json',
      byteCount: 2
    }));
    expect(new Set(events.map((event) => event.traceId)).size).toBe(1);
    expect(events.filter((event) => event.phase === 'finish')).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ outcome: 'partial', reason: 'refresh_failed' });
    expect(completeSubmission).toHaveBeenCalledTimes(1);
    expect(lines.join('')).not.toContain(replyContent);
    expect(lines.join('')).not.toContain('nodeseek.com');
  });

  it('records a false follow-up refresh as partial without changing submit behavior', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    actionMocks.runNodeSeekAction.mockResolvedValueOnce({});
    const refreshTopicReplies = vi.fn(async () => false);
    const { completeSubmission, controller } = createTopicActionController({
      refreshTopicReplies,
      replyContent: 'reply body'
    });

    await expect(controller.submitReply()).resolves.toBeUndefined();

    const events = lines.map((line) => JSON.parse(line) as DiagnosticEvent);
    expect(events.filter((event) => event.phase === 'finish')).toEqual([
      expect.objectContaining({ outcome: 'partial', reason: 'refresh_failed' })
    ]);
    expect(refreshTopicReplies).toHaveBeenCalledWith(expect.objectContaining({
      diagnosticTrace: expect.objectContaining({ traceId: events[0].traceId })
    }));
    expect(events).not.toContainEqual(expect.objectContaining({ refreshSucceeded: true }));
    expect(completeSubmission).toHaveBeenCalledTimes(1);
  });

  it('distinguishes local-generated and absent NodeSeek CSRF without logging request data', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    actionMocks.runNodeSeekAction.mockResolvedValue({});
    const { controller } = createTopicActionController({ replyContent: 'private reply body' });

    await controller.submitReply();
    await controller.checkIn();

    actionMocks.runLinuxDoAction.mockResolvedValueOnce({});
    const { controller: linuxDoController } = createTopicActionController({
      replyContent: 'private linux.do body',
      source: 'linuxdo'
    });
    await linuxDoController.submitReply();

    actionMocks.runYaohuoAction.mockResolvedValueOnce({ message: '操作已提交' });
    const { controller: yaohuoController } = createTopicActionController({ source: 'yaohuo' });
    await yaohuoController.favoriteOnYaohuoSite();

    const events = lines.map((line) => JSON.parse(line) as DiagnosticEvent);
    expect(events).toContainEqual(expect.objectContaining({
      operation: 'submit',
      credentialSource: 'secure-store',
      requestType: 'reply',
      csrfSource: 'local-generated'
    }));
    expect(events).toContainEqual(expect.objectContaining({
      operation: 'attendance',
      requestType: 'attendance',
      csrfSource: 'none'
    }));
    expect(events).toContainEqual(expect.objectContaining({
      source: 'linuxdo',
      operation: 'submit',
      requestType: 'reply',
      csrfSource: 'session-endpoint'
    }));
    expect(events).toContainEqual(expect.objectContaining({
      source: 'yaohuo',
      operation: 'favorite',
      requestType: 'favorite',
      csrfSource: 'none'
    }));
    expect(lines.join('')).not.toMatch(/csrf-token|private (?:reply|linux\.do) body|fake-credential|\/api\//i);
  });
});
