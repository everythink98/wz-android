import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Dispatch, SetStateAction } from 'react';

const actionMocks = vi.hoisted(() => ({
  fetchNodeSeekVoteInfo: vi.fn(),
  runLinuxDoAction: vi.fn(),
  runNodeSeekAction: vi.fn(),
  runXiaoyinsiAction: vi.fn(),
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
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: vi.fn(async (key: string) => {
    if (key === 'xiaoyinsi-auth.api-key') {
      return 'fake-xiaoyinsi-user-api-key';
    }
    if (key === 'xiaoyinsi-auth.client-id') {
      return 'fake-xiaoyinsi-client-id';
    }
    return JSON.stringify({
      cookieHeader: 'session=fake-cookie-credential',
      savedAt: '2026-07-10T00:00:00.000Z',
      source: 'webview'
    });
  })
}));

vi.mock('../nodeseekActionClient', () => ({
  fetchNodeSeekVoteInfo: actionMocks.fetchNodeSeekVoteInfo,
  runNodeSeekAction: actionMocks.runNodeSeekAction
}));

vi.mock('../linuxdoActionClient', () => ({
  runLinuxDoAction: actionMocks.runLinuxDoAction
}));

vi.mock('../yaohuoActionClient', () => ({
  runYaohuoAction: actionMocks.runYaohuoAction
}));

vi.mock('../xiaoyinsiActionClient', () => ({
  runXiaoyinsiAction: actionMocks.runXiaoyinsiAction
}));

vi.mock('../linuxdoCookieBridge', () => ({
  clearLinuxDoAccess: vi.fn(),
  clearLinuxDoAccessForGeneration: vi.fn(),
  currentLinuxDoAccessGeneration: vi.fn(() => 1),
  linuxDoAccessSummary: vi.fn(() => ({ loggedIn: true })),
  loadLinuxDoAccess: vi.fn(async () => ({ cookieHeader: '_t=fake-credential', userAgent: 'ua' })),
  parseLinuxDoDocumentCookie: vi.fn(() => ({})),
  summarizeLinuxDoCookies: vi.fn(() => ({ names: [], hasClearance: false }))
}));

import { clearLinuxDoAccessForGeneration, summarizeLinuxDoCookies } from '../linuxdoCookieBridge';
import { Alert } from 'react-native';
import { getDocumentAsync } from 'expo-document-picker';
import { createRequestOwner } from '../requestOwnership';
import { createSiteSessionStates } from '../siteSessionState';
import type { TopicRepliesRefreshOptions } from '../appTypes';
import type { Fetcher } from '../request';
import type { Reply, Source, TopicDetail } from '../types';
import { setDiagnosticWriter, type DiagnosticEvent } from '../diagnostics';
import { clearExpiredLinuxDoLogin } from './topicActionHelpers';
import { useTopicActionsController } from './useTopicActionsController';
import type { TopicSessionController } from './useTopicSessionController';

function createTopicActionController({
  applyUpdate = vi.fn(),
  appendMarkup = vi.fn(),
  completeSubmission = vi.fn(),
  fetcher = vi.fn(),
  notify = vi.fn(),
  refreshTopicReplies = vi.fn(async () => undefined),
  refreshXiaoyinsiAuthorization = vi.fn(async () => true),
  replyContent = '',
  replyEditTarget = null,
  setActionBusy = vi.fn(),
  showXiaoyinsiLogin = vi.fn(),
  source = 'nodeseek',
  topicPatch = {}
}: {
  applyUpdate?: ReturnType<typeof vi.fn>;
  appendMarkup?: ReturnType<typeof vi.fn>;
  completeSubmission?: ReturnType<typeof vi.fn>;
  fetcher?: Fetcher;
  notify?: (message: string) => void;
  refreshTopicReplies?: (options?: TopicRepliesRefreshOptions) => Promise<unknown>;
  refreshXiaoyinsiAuthorization?: () => Promise<boolean>;
  replyContent?: string;
  replyEditTarget?: Reply | null;
  setActionBusy?: ReturnType<typeof vi.fn>;
  showXiaoyinsiLogin?: (message?: string) => void;
  source?: Extract<Source, 'nodeseek' | 'linuxdo' | 'yaohuo' | 'xiaoyinsi'>;
  topicPatch?: Partial<TopicDetail>;
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
    ...(source === 'xiaoyinsi' ? { canCreatePost: true } : {}),
    liked: false,
    ...topicPatch
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
    refreshXiaoyinsiAuthorization,
    resetLinuxDoLevelState: vi.fn(),
    setActionBusy: setActionBusy as Dispatch<SetStateAction<boolean>>,
    setOptimisticTopicActions: vi.fn(),
    showLinuxDoLogin: vi.fn(),
    showXiaoyinsiLogin,
    showYaohuoLogin: vi.fn(),
    siteSessionStates,
    topicActionRequestOwnerRef: { current: createRequestOwner('topic') },
    topicSession: {
      state: {
        replyContent,
        replyEditTarget,
        replyFace: undefined,
        replyTarget: null,
        selectedTopic: detail,
        topicDetail: detail,
        topicReplies: []
      },
      commands: {
        actions: { applyUpdate },
        composer: {
          appendMarkup,
          completeSubmission
        }
      }
    } as unknown as TopicSessionController,
    updateLinuxDoSession: vi.fn()
  });
  return {
    applyUpdate,
    completeSubmission,
    controller,
    detail,
    optimisticTopicActionsRef,
    refreshXiaoyinsiAuthorization,
    setActionBusy,
    showXiaoyinsiLogin
  };
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

  it('records retained linux.do clearance as cookie-loaded instead of verification success', async () => {
    vi.mocked(clearLinuxDoAccessForGeneration).mockResolvedValueOnce({
      cookieHeader: 'cf_clearance=retained',
      savedAt: '2026-07-18T00:00:00.000Z',
      source: 'webview'
    });
    vi.mocked(summarizeLinuxDoCookies).mockReturnValueOnce({
      hasClearance: true,
      loggedIn: false,
      names: ['cf_clearance']
    });
    const updateLinuxDoSession = vi.fn();

    await clearExpiredLinuxDoLogin({
      error: new Error('linux.do 登录已失效，请重新登录。'),
      generation: 3,
      cookieHeader: 'cf_clearance=retained; _t=expired',
      resetLinuxDoLevelState: vi.fn(),
      updateLinuxDoSession
    });

    expect(updateLinuxDoSession).toHaveBeenCalledWith({
      type: 'cookie-loaded',
      cookieSummary: ['cf_clearance'],
      hasVerification: true,
      loggedIn: false,
      at: expect.any(String)
    });
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
    expect(lines.join('')).not.toMatch(/987654|424242|private title|private author|private body|fake-(?:credential|cookie-credential|xiaoyinsi)|token=secret|nodeseek\.com/);
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
    expect(lines.join('')).not.toMatch(/csrf-token|private (?:reply|linux\.do) body|fake-(?:credential|cookie-credential|xiaoyinsi)|\/api\//i);
  });

  it('[REG-XIAOYINSI-012] applies a confirmed 小隐寺 like locally without reloading the topic', async () => {
    actionMocks.runXiaoyinsiAction.mockResolvedValueOnce({ success: true });
    const { applyUpdate, controller, setActionBusy } = createTopicActionController({
      source: 'xiaoyinsi',
      topicPatch: { canLike: true, liked: false }
    });

    await controller.interact('like', 987654);

    expect(actionMocks.runXiaoyinsiAction).toHaveBeenCalledWith(expect.objectContaining({
      credentials: {
        apiKey: 'fake-xiaoyinsi-user-api-key',
        clientId: 'fake-xiaoyinsi-client-id'
      },
      request: {
        path: '/post_actions',
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'id=987654&post_action_type_id=2'
      }
    }));
    expect(applyUpdate).toHaveBeenCalledWith({
      type: 'interaction',
      patch: { commentId: 987654, type: 'like', mode: 'add', reactionId: 'heart' }
    });
    expect(setActionBusy).not.toHaveBeenCalled();
  });

  it('[REG-XIAOYINSI-011] releases image-upload busy state after inserting the Markdown', async () => {
    vi.mocked(getDocumentAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///cache/test.png', name: 'test.png', mimeType: 'image/png', lastModified: 0 }]
    });
    actionMocks.runXiaoyinsiAction.mockResolvedValueOnce({ short_url: 'upload://test.jpeg' });
    const events: string[] = [];
    const setActionBusy = vi.fn((busy: boolean) => { events.push(`busy:${busy}`); });
    const appendMarkup = vi.fn(() => { events.push('markup'); });
    const { controller } = createTopicActionController({ source: 'xiaoyinsi', setActionBusy, appendMarkup });

    await controller.uploadReplyImage();

    expect(events).toEqual(['busy:true', 'markup', 'busy:false']);
  });

  it('[REG-XIAOYINSI-009] allows canceling an existing 小隐寺 like when Discourse reports can_act=false', async () => {
    actionMocks.runXiaoyinsiAction.mockResolvedValueOnce({ success: true });
    const notify = vi.fn();
    const { applyUpdate, controller, setActionBusy } = createTopicActionController({
      notify,
      source: 'xiaoyinsi',
      topicPatch: { canLike: false, liked: true }
    });

    await controller.interact('like', 987654);

    expect(actionMocks.runXiaoyinsiAction).toHaveBeenCalledWith(expect.objectContaining({
      request: {
        path: '/post_actions/987654?post_action_type_id=2',
        method: 'DELETE',
        headers: {},
        body: undefined
      }
    }));
    expect(applyUpdate).toHaveBeenCalledWith({
      type: 'interaction',
      patch: { commentId: 987654, type: 'like', mode: 'remove', reactionId: 'heart' }
    });
    expect(setActionBusy).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalledWith('当前帖子不能点赞');
  });

  it('[REG-XIAOYINSI-003] cancels a 小隐寺 topic bookmark even when Discourse omits the bookmark record id', async () => {
    actionMocks.runXiaoyinsiAction.mockResolvedValueOnce({ success: true });
    const notify = vi.fn();
    const { applyUpdate, controller, setActionBusy } = createTopicActionController({
      notify,
      source: 'xiaoyinsi',
      topicPatch: { bookmarked: true, bookmarkId: undefined }
    });

    await controller.bookmarkOnXiaoyinsiSite();

    expect(actionMocks.runXiaoyinsiAction).toHaveBeenCalledWith(expect.objectContaining({
      request: {
        path: '/t/424242/remove_bookmarks',
        method: 'PUT',
        headers: {},
        body: undefined
      }
    }));
    expect(applyUpdate).toHaveBeenCalledWith({ type: 'bookmark', bookmarked: false });
    expect(setActionBusy).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalledWith('当前收藏记录不完整，请刷新主题后再试。');
  });

  it('[REG-XIAOYINSI-007] closes a 小隐寺 edit composer without applying unconfirmed markdown locally', async () => {
    actionMocks.runXiaoyinsiAction.mockResolvedValueOnce({ success: true });
    const refreshTopicReplies = vi.fn(async () => true);
    const editTarget: Reply = {
      commentId: 101,
      floor: 2,
      author: 'alice',
      createdAt: '2026-07-10T00:01:00.000Z',
      contentHtml: '<p>old</p>',
      canEdit: true
    };
    const { applyUpdate, completeSubmission, controller } = createTopicActionController({
      source: 'xiaoyinsi',
      replyContent: 'server must confirm this body',
      replyEditTarget: editTarget,
      refreshTopicReplies,
      topicPatch: { canCreatePost: false }
    });

    await controller.submitReply();

    expect(actionMocks.runXiaoyinsiAction).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({ path: '/posts/101.json', method: 'PUT' })
    }));
    expect(completeSubmission).toHaveBeenCalledWith();
    expect(refreshTopicReplies).toHaveBeenCalledWith(expect.objectContaining({ nocache: true, targetReply: editTarget }));
    expect(applyUpdate).not.toHaveBeenCalled();
  });

  it('rechecks 小隐寺 authorization after 403 without treating it as an automatic logout', async () => {
    actionMocks.runXiaoyinsiAction.mockRejectedValueOnce(Object.assign(new Error('没有权限执行该操作'), {
      source: 'xiaoyinsi',
      status: 403,
      reason: 'permission',
      authorizationCheckRequired: true
    }));
    const notify = vi.fn();
    const { controller, refreshXiaoyinsiAuthorization, showXiaoyinsiLogin } = createTopicActionController({
      notify,
      source: 'xiaoyinsi',
      topicPatch: { canLike: true }
    });

    await controller.interact('like', 987654);

    expect(refreshXiaoyinsiAuthorization).toHaveBeenCalledTimes(1);
    expect(showXiaoyinsiLogin).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('没有权限执行该操作');
  });

  it('[REG-XIAOYINSI-012] removes a confirmed 小隐寺 reply locally and refreshes only the reply slice', async () => {
    actionMocks.runXiaoyinsiAction.mockResolvedValueOnce({ success: true });
    const refreshTopicReplies = vi.fn(async () => true);
    const { applyUpdate, controller } = createTopicActionController({ source: 'xiaoyinsi', refreshTopicReplies });
    const reply: Reply = {
      commentId: 101,
      floor: 2,
      author: 'alice',
      createdAt: '2026-07-10T00:01:00.000Z',
      contentHtml: '<p>reply</p>',
      canDelete: true
    };

    controller.deleteReply(reply);
    const buttons = vi.mocked(Alert.alert).mock.calls[0]?.[2] || [];
    buttons[1]?.onPress?.();

    await vi.waitFor(() => {
      expect(applyUpdate).toHaveBeenCalledWith({ type: 'reply-deleted', reply });
    });
    expect(refreshTopicReplies).toHaveBeenCalledWith(expect.objectContaining({
      silent: true,
      afterSubmit: true,
      targetReply: reply,
      excludeReply: reply
    }));
  });

  it('REG-WRITE-003 REG-WRITE-004 applies the confirmed yaohuo favorite locally without global busy', async () => {
    actionMocks.runYaohuoAction.mockResolvedValueOnce({ ok: true, message: '收藏成功', favoriteId: 987 });
    const { applyUpdate, controller, setActionBusy } = createTopicActionController({ source: 'yaohuo' });

    await controller.favoriteOnYaohuoSite();

    expect(actionMocks.runYaohuoAction).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        method: 'GET',
        path: '/bbs/Share.aspx?action=fav&siteid=1000&classid=177&id=424242'
      })
    }));
    expect(applyUpdate).toHaveBeenCalledWith({
      type: 'bookmark',
      bookmarked: true,
      bookmarkId: 987
    });
    expect(setActionBusy).not.toHaveBeenCalled();
  });

  it('REG-WRITE-003 cancels a confirmed yaohuo favorite and clears the visible state', async () => {
    actionMocks.runYaohuoAction.mockResolvedValueOnce({ ok: true, message: '已取消原站收藏' });
    const { applyUpdate, controller } = createTopicActionController({
      source: 'yaohuo',
      topicPatch: { bookmarked: true, bookmarkId: 987 }
    });

    await controller.favoriteOnYaohuoSite();

    expect(actionMocks.runYaohuoAction).toHaveBeenCalledWith(expect.objectContaining({
      request: {
        method: 'POST',
        path: '/bbs/favlist.aspx?action=delete&siteid=1000&favtypeid=0&id=987',
        headers: { accept: '*/*' }
      }
    }));
    expect(applyUpdate).toHaveBeenCalledWith({
      type: 'bookmark',
      bookmarked: false,
      bookmarkId: undefined
    });
  });
});

describe('topic poll submission', () => {
  const nodeSeekPoll = {
    id: '2443',
    title: 'NodeSeek poll',
    options: [
      { id: '71', label: '选项 A' },
      { id: '72', label: '选项 B' }
    ]
  };

  it('[REG-WRITE-008] keeps the NodeSeek selection and sends no request when confirmation is canceled', async () => {
    actionMocks.runNodeSeekAction.mockResolvedValueOnce({});
    const { applyUpdate, controller } = createTopicActionController();

    await controller.votePoll(nodeSeekPoll, ['72']);

    expect(Alert.alert).toHaveBeenCalledWith(
      '确认提交投票？',
      '提交后不可修改。',
      expect.any(Array),
      expect.objectContaining({
        cancelable: true,
        onDismiss: expect.any(Function)
      })
    );
    const buttons = vi.mocked(Alert.alert).mock.calls[0]?.[2] || [];
    buttons[0]?.onPress?.();

    expect(actionMocks.runNodeSeekAction).not.toHaveBeenCalled();
    expect(applyUpdate).not.toHaveBeenCalled();
  });

  it('[REG-WRITE-008] sends one NodeSeek POST after confirmation even when submit is pressed twice', async () => {
    actionMocks.runNodeSeekAction.mockResolvedValue({});
    actionMocks.fetchNodeSeekVoteInfo.mockResolvedValue({
      id: '2443',
      voted: true,
      options: [
        { id: '71', label: '选项 A', count: 2, selected: false },
        { id: '72', label: '选项 B', count: 6, selected: true }
      ]
    });
    const notify = vi.fn();
    const { applyUpdate, controller } = createTopicActionController({ notify });

    await controller.votePoll(nodeSeekPoll, ['72']);

    expect(actionMocks.runNodeSeekAction).not.toHaveBeenCalled();
    const buttons = vi.mocked(Alert.alert).mock.calls[0]?.[2] || [];
    buttons[1]?.onPress?.();
    buttons[1]?.onPress?.();

    await vi.waitFor(() => {
      expect(actionMocks.runNodeSeekAction).toHaveBeenCalledTimes(1);
      expect(actionMocks.fetchNodeSeekVoteInfo).toHaveBeenCalledTimes(1);
    });
    expect(actionMocks.runNodeSeekAction).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        path: '/api/vote/voteforitem',
        method: 'POST'
      })
    }));
    expect(actionMocks.runNodeSeekAction.mock.invocationCallOrder[0]).toBeLessThan(
      actionMocks.fetchNodeSeekVoteInfo.mock.invocationCallOrder[0]
    );
    expect(applyUpdate).toHaveBeenCalledWith({
      type: 'poll-vote',
      patch: expect.objectContaining({
        pollId: '2443',
        optionIds: ['72'],
        confirmedPoll: expect.objectContaining({
          id: '2443',
          voted: true,
          options: expect.arrayContaining([
            expect.objectContaining({ id: '72', count: 6, selected: true })
          ])
        })
      })
    });
    expect(notify).toHaveBeenCalledWith('投票已提交');
  });

  it('[REG-WRITE-007] keeps a submitted NodeSeek vote without inventing counts when result GET fails', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    actionMocks.runNodeSeekAction.mockResolvedValueOnce({ success: true });
    actionMocks.fetchNodeSeekVoteInfo.mockRejectedValueOnce(new Error('result refresh failed'));
    const notify = vi.fn();
    const { applyUpdate, controller } = createTopicActionController({ notify });

    await controller.votePoll(nodeSeekPoll, ['72']);
    const buttons = vi.mocked(Alert.alert).mock.calls[0]?.[2] || [];
    buttons[1]?.onPress?.();

    await vi.waitFor(() => {
      expect(applyUpdate).toHaveBeenCalledWith({
        type: 'poll-vote',
        patch: expect.objectContaining({
          pollId: '2443',
          optionIds: ['72'],
          preserveUnknownCounts: true
        })
      });
    });
    expect(actionMocks.runNodeSeekAction).toHaveBeenCalledTimes(1);
    expect(actionMocks.fetchNodeSeekVoteInfo).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('提交成功但结果刷新失败，请手动刷新。');
    expect(lines.map((line) => JSON.parse(line) as DiagnosticEvent)).toContainEqual(
      expect.objectContaining({ phase: 'finish', outcome: 'partial', reason: 'refresh_failed' })
    );
  });

  it('[REG-WRITE-008] does not add confirmation to LinuxDo or Yaohuo polls', async () => {
    actionMocks.runLinuxDoAction.mockResolvedValueOnce({});
    actionMocks.runYaohuoAction.mockResolvedValueOnce({});
    const { controller: linuxDoController } = createTopicActionController({ source: 'linuxdo' });
    const { controller: yaohuoController } = createTopicActionController({ source: 'yaohuo' });

    await linuxDoController.votePoll({
      id: 'linuxdo-poll',
      name: 'poll_name',
      postId: '424242',
      options: [{ id: '1', label: 'A' }]
    }, ['1']);
    await yaohuoController.votePoll({
      id: 'yaohuo-poll',
      options: [{ id: '1', label: 'A' }]
    }, ['1']);

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(actionMocks.runLinuxDoAction).toHaveBeenCalledTimes(1);
    expect(actionMocks.runYaohuoAction).toHaveBeenCalledTimes(1);
  });

  it('[REG-XIAOYINSI-012] applies a confirmed 小隐寺 vote locally', async () => {
    actionMocks.runXiaoyinsiAction.mockResolvedValueOnce({ success: true });
    const { applyUpdate, controller } = createTopicActionController({ source: 'xiaoyinsi' });
    const poll = {
      id: 'xiaoyinsi-poll',
      name: 'poll_name',
      postId: '424242',
      options: [{ id: '1', label: 'A' }]
    };

    await controller.votePoll(poll, ['1']);

    expect(actionMocks.runXiaoyinsiAction).toHaveBeenCalledTimes(1);
    expect(applyUpdate).toHaveBeenCalledWith({
      type: 'poll-vote',
      patch: {
        pollId: 'xiaoyinsi-poll',
        pollName: 'poll_name',
        pollPostId: '424242',
        optionIds: ['1']
      }
    });
  });
});
