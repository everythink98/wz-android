import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryObserver } from '@tanstack/react-query';
import { useAccountRuntime } from '@/features/account/useAccountRuntime';
import { accountQueryKeys, appQueryClient } from '@/platform/query/serverState';
import { discourseReadingQueryKey } from '@/platform/query/discourseReadingRuntime';
import { accountSessionSnapshotFromEvent, createAccountSessionSnapshot } from '@/domain/session/siteSessionState';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { setLinuxDoCookieResponseBarrier } from '@/platform/network/managedCookies';
import type { DiagnosticEvent } from '@/platform/diagnostics/diagnosticPolicy';
import type { Fetcher } from '@/platform/network/request';
import type { Source } from '@/domain/forum/models';
import { QueryTestWrapper } from '../QueryTestWrapper';
import { fireEvent, render } from '../render';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}));

jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    WebView: React.forwardRef(function MockWebView(props: Record<string, unknown>, ref: unknown) {
      React.useImperativeHandle(ref, () => ({ stopLoading: jest.fn(), injectJavaScript: jest.fn() }), []);
      React.useEffect(() => {
        mockWebViewLoads.push((props.source as { uri?: string })?.uri || '');
      }, []);
      return React.createElement(View, { ...props, testID: 'login-webview' });
    })
  };
});
let mockWebViewLoads: string[] = [];
jest.mock('@/platform/network/managedCookies', () => ({
  ...jest.requireActual('@/platform/network/managedCookies'),
  setLinuxDoCookieResponseBarrier: jest.fn(async () => undefined),
  readManagedCookieHeader: jest.fn(async () => ({ status: 'ok', header: 'test-session=fixture' }))
}));

let events: DiagnosticEvent[] = [];
function seedAccount(username = 'alice') {
  appQueryClient.setQueryData(
    accountQueryKeys.snapshot('linuxdo'),
    accountSessionSnapshotFromEvent(createAccountSessionSnapshot('linuxdo'), {
      type: 'session-updated',
      loggedIn: true,
      currentUser: { source: 'linuxdo', id: username, username, url: `https://linux.do/u/${username}` }
    })
  );
}

async function renderRuntime(fetcher: Fetcher) {
  seedAccount();
  const notify = jest.fn();
  const openUser = async () => undefined;
  const loginNavigation = { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true };
  return renderHook(
    ({ enabledSources }: { enabledSources: readonly Source[] }) =>
      useAccountRuntime({
        appActive: true,
        enabledSources,
        fetcher,
        loginNavigation,
        notify,
        nodeSeekRecoveryThreshold: 1,
        openUser,
        ready: false,
        screen: 'search',
        webViewBlockMessage: ''
      }),
    { initialProps: { enabledSources: ['linuxdo'] }, wrapper: QueryTestWrapper }
  );
}

beforeEach(() => {
  mockWebViewLoads = [];
  events = [];
  setDiagnosticWriter((line) => {
    events.push(JSON.parse(line) as DiagnosticEvent);
  });
});
afterEach(() => setDiagnosticWriter(null));

it.each(['current', 'stale', 'identity-changed'] as const)(
  'settles %s NodeSeek verification without requiring public readers to log in',
  async (state) => {
    let runtime!: ReturnType<typeof useAccountRuntime>;
    const notify = jest.fn();
    const fetcher: Fetcher = async () =>
      new Response('<html><meta name="nodeseekAccountState" content="anonymous"></html>', {
        headers: { 'content-type': 'text/html' }
      });
    function Harness() {
      runtime = useAccountRuntime({
        appActive: true,
        enabledSources: ['nodeseek'],
        fetcher,
        loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
        notify,
        nodeSeekRecoveryThreshold: 1,
        openUser: async () => undefined,
        ready: false,
        screen: 'topic',
        webViewBlockMessage: ''
      });
      return runtime.hosts.element;
    }
    const view = await render(<Harness />, { wrapper: QueryTestWrapper });
    await act(async () => {
      if (state === 'identity-changed') {
        appQueryClient.setQueryData(
          accountQueryKeys.snapshot('nodeseek'),
          accountSessionSnapshotFromEvent(createAccountSessionSnapshot('nodeseek'), {
            type: 'session-updated',
            loggedIn: true,
            currentUser: { source: 'nodeseek', id: '42', username: 'alice', url: 'https://www.nodeseek.com/space/42' }
          })
        );
      }
    });
    const resume = jest.fn(async () => 'completed' as const);
    await act(async () =>
      runtime.hosts.requestNodeSeekVerification('需要验证', {
        queryKey: ['nodeseek-public-topic'],
        isCurrent: () => state !== 'stale',
        resume
      })
    );
    expect(runtime.read.accountSessionViewModels.nodeseek.isLoggedIn).toBe(state === 'identity-changed');
    await fireEvent.press(view.getByText('检测登录'));
    await waitFor(() => expect(runtime.hosts.surfaces.nodeseek).toBe(false));
    expect(resume).toHaveBeenCalledTimes(state === 'current' ? 1 : 0);
    expect(runtime.read.accountSessionViewModels.nodeseek.isLoggedIn).toBe(false);
    expect(notify).not.toHaveBeenCalledWith('NodeSeek当前未登录。');
    await view.unmount();
  }
);

it('keeps a blocked reading recovery in one panel until explicit retry, then waits for cookie handoff', async () => {
  jest.useFakeTimers({ doNotFake: ['performance'] });
  let clock = 0;
  const monotonic = jest.spyOn(performance, 'now').mockImplementation(() => clock);
  let challenged = true;
  const bodies: string[] = [];
  const fetcher: Fetcher = async (url, init) => {
    if (url.endsWith('/session/csrf')) return new Response(JSON.stringify({ csrf: 'fixture' }));
    bodies.push(String(init?.body));
    return challenged
      ? new Response('<title>Just a moment...</title>', {
          status: 403,
          headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' }
        })
      : new Response('');
  };
  seedAccount();
  let runtime!: ReturnType<typeof useAccountRuntime>;
  const notify = jest.fn();
  function Harness({ appActive = true }: { appActive?: boolean }) {
    runtime = useAccountRuntime({
      appActive,
      enabledSources: ['linuxdo'],
      fetcher,
      loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
      notify,
      nodeSeekRecoveryThreshold: 1,
      openUser: async () => undefined,
      ready: false,
      screen: 'search',
      webViewBlockMessage: ''
    });
    return runtime.hosts.element;
  }
  const view = await render(<Harness />, { wrapper: QueryTestWrapper });
  const advance = async (milliseconds: number) =>
    act(async () => {
      for (let elapsed = 0; elapsed < milliseconds; elapsed += 1000) {
        clock += 1000;
        await jest.advanceTimersByTimeAsync(1000);
      }
    });
  try {
    const reading = runtime.read.readGateway.reading!;
    const scope = reading.scope();
    const session = reading.begin('12');
    session.visible([1]);
    session.active(true);
    await advance(1000);
    expect(runtime.hosts.linuxDoVerificationVisible).toBe(true);
    expect(reading.scope()).toBe(scope);
    session.visible([2]);
    await advance(10000);
    expect(mockWebViewLoads).toEqual(['https://linux.do/challenge']);
    expect(bodies).toHaveLength(1);
    expect(reading.state()['12'].readPosts[2]).toBeUndefined();
    await fireEvent.press(view.getByText('检测状态'));
    expect(bodies).toHaveLength(2);
    expect(runtime.hosts.linuxDoVerificationVisible).toBe(true);
    expect(view.queryByTestId('login-webview')).toBeNull();
    expect(view.getByText('请求仍被站点拦截，尚未恢复。')).toBeTruthy();
    await view.rerender(<Harness appActive={false} />);
    await view.rerender(<Harness appActive />);
    await advance(10000);
    expect(bodies).toHaveLength(2);
    expect(view.queryByTestId('login-webview')).toBeNull();
    expect(mockWebViewLoads).toEqual(['https://linux.do/challenge']);
    await fireEvent.press(view.getByText('重新验证'));
    await advance(1000);
    let release!: () => void;
    jest.mocked(setLinuxDoCookieResponseBarrier).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    challenged = false;
    await fireEvent.press(view.getByText('检测状态'));
    expect(bodies).toHaveLength(2);
    expect(runtime.hosts.linuxDoVerificationVisible).toBe(true);
    await act(async () => release());
    expect(bodies).toHaveLength(3);
    expect(bodies[2]).toBe(bodies[0]);
    expect(reading.scope()).toBe(scope);
    expect(reading.state()['12'].server.lastReadPostNumber).toBe(1);
    expect(runtime.hosts.linuxDoVerificationVisible).toBe(false);
    expect(notify).toHaveBeenCalledWith('linux.do 阅读记录已同步。');
  } finally {
    await view.unmount();
    monotonic.mockRestore();
    jest.useRealTimers();
  }
});

it.each([
  ['handoff', 'close'],
  ['csrf', 'back'],
  ['timings', 'background'],
  ['handoff', 'source'],
  ['handoff', 'identity']
] as const)('ends reading recovery during %s on %s without late sends or reopened panels', async (stage, exit) => {
  jest.useFakeTimers({ doNotFake: ['performance'] });
  let clock = 0;
  const monotonic = jest.spyOn(performance, 'now').mockImplementation(() => clock);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let posts = 0;
  let csrf = 0;
  const fetcher: Fetcher = async (url) => {
    if (url.endsWith('/session/csrf')) {
      if (++csrf === 2 && stage === 'csrf') await pending;
      return new Response(JSON.stringify({ csrf: 'fixture' }));
    }
    if (++posts === 1)
      return new Response('<title>Just a moment...</title>', {
        status: 403,
        headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' }
      });
    if (stage === 'timings') await pending;
    return new Response('');
  };
  seedAccount();
  const notify = jest.fn();
  let runtime!: ReturnType<typeof useAccountRuntime>;
  function Harness({ active = true, enabled = true }: { active?: boolean; enabled?: boolean }) {
    runtime = useAccountRuntime({
      appActive: active,
      enabledSources: enabled ? ['linuxdo'] : [],
      fetcher,
      loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
      notify,
      nodeSeekRecoveryThreshold: 1,
      openUser: async () => undefined,
      ready: false,
      screen: 'search',
      webViewBlockMessage: ''
    });
    return runtime.hosts.element;
  }
  const view = await render(<Harness />, { wrapper: QueryTestWrapper });
  try {
    const session = runtime.read.readGateway.reading!.begin('12');
    session.visible([1]);
    session.active(true);
    await act(async () => {
      clock += 1000;
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(posts).toBe(1);
    await act(async () => {
      clock += 10000;
      await jest.advanceTimersByTimeAsync(10000);
    });
    if (stage === 'handoff') jest.mocked(setLinuxDoCookieResponseBarrier).mockImplementationOnce(() => pending);
    await fireEvent.press(view.getByText('检测状态'));
    expect(view.getByText('正在检测原请求是否恢复，可以随时返回。')).toBeTruthy();
    if (exit === 'close') await fireEvent.press(view.getByLabelText('关闭'));
    if (exit === 'back')
      await act(async () => {
        expect(runtime.hosts.closeTopmostSurface()).toBe('linuxdo-panel-closed');
      });
    if (exit === 'source') await view.rerender(<Harness enabled={false} />);
    if (exit === 'identity')
      await act(async () => {
        seedAccount('bob');
      });
    if (exit === 'background') await view.rerender(<Harness active={false} />);
    await act(async () => {
      release();
    });
    if (exit === 'background') {
      await view.rerender(<Harness />);
      expect(view.getByText(/检测因切到后台而中断/)).toBeTruthy();
      await fireEvent.press(view.getByText('返回原页面'));
    }
    await act(async () => {
      clock += 30000;
      await jest.advanceTimersByTimeAsync(30000);
    });
    expect(posts).toBe(stage === 'timings' ? 2 : 1);
    expect(runtime.hosts.linuxDoVerificationVisible).toBe(false);
    expect(mockWebViewLoads).toEqual(['https://linux.do/challenge']);
  } finally {
    release();
    await view.unmount();
    monotonic.mockRestore();
    jest.useRealTimers();
  }
});

it('suppresses canceled query notifications until a new explicit request produces a new error', async () => {
  jest.useFakeTimers();
  const queryKey = ['cancel-recovery-query'];
  let attempts = 0;
  const observer = new QueryObserver(appQueryClient, {
    queryKey,
    retry: false,
    queryFn: async () => {
      ++attempts;
      throw new Error('blocked');
    }
  });
  const unsubscribe = observer.subscribe(() => undefined);
  const hook = await renderRuntime(async () => new Response('{}'));
  const resume = jest.fn(async () => 'verification-required' as const);
  try {
    await act(async () => {
      await observer.refetch();
    });
    await act(async () => {
      expect(await hook.result.current.hosts.showLinuxDoVerification('page', { queryKey, resume })).toBe(true);
    });
    await act(async () => {
      hook.result.current.hosts.closeTopmostSurface();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });
    await act(async () => {
      expect(await hook.result.current.hosts.showLinuxDoVerification('duplicate', { queryKey, resume })).toBe(false);
    });
    const previousAttempts = attempts;
    await act(async () => {
      await observer.refetch();
    });
    expect(attempts).toBe(previousAttempts + 1);
    await act(async () => {
      expect(await hook.result.current.hosts.showLinuxDoVerification('new request', { queryKey, resume })).toBe(true);
    });
    expect(resume).not.toHaveBeenCalled();
  } finally {
    await act(async () => {
      hook.result.current.hosts.closePanels();
    });
    await hook.unmount();
    unsubscribe();
    observer.destroy();
    jest.useRealTimers();
  }
});

it('accepts an explicitly current read recovery without an active Query observer', async () => {
  const hook = await renderRuntime(async () => new Response('{}'));
  const resume = jest.fn(async () => 'completed' as const);
  await act(async () => {
    expect(
      await hook.result.current.hosts.showLinuxDoVerification('page', {
        queryKey: ['explicit-detail-refresh'],
        isCurrent: () => true,
        resume
      })
    ).toBe(true);
  });
  expect(hook.result.current.hosts.linuxDoVerificationVisible).toBe(true);
  await act(async () => {
    hook.result.current.hosts.closePanels();
  });
  await hook.unmount();
});

it('accepts fresh server reading after changing the NodeSeek recovery setting', async () => {
  seedAccount();
  let lastRead = 20;
  const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(
    async () => new Response(JSON.stringify({ id: 12, last_read_post_number: lastRead, highest_post_number: 250 }))
  );
  const options = {
    appActive: true,
    enabledSources: ['linuxdo'] as Source[],
    fetcher,
    loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
    notify: jest.fn(),
    openUser: async () => undefined,
    ready: false,
    screen: 'search' as const,
    webViewBlockMessage: ''
  };
  const hook = await renderHook(
    ({ threshold }: { threshold: number }) => useAccountRuntime({ ...options, nodeSeekRecoveryThreshold: threshold }),
    { initialProps: { threshold: 1 }, wrapper: QueryTestWrapper }
  );
  try {
    const reading = hook.result.current.read.readGateway.reading!;
    await act(async () => {
      await hook.result.current.read.readGateway.getTopicReading('12', { trackVisit: true });
      await hook.result.current.read.readGateway.getTopicReading('12', { trackVisit: true });
    });
    expect(reading.state()['12'].server.lastReadPostNumber).toBe(20);
    await hook.rerender({ threshold: 2 });
    lastRead = 200;
    await act(async () => {
      await hook.result.current.read.readGateway.getTopicReading('12', { trackVisit: true });
    });
    expect(hook.result.current.read.readGateway.reading!.state()['12'].server.lastReadPostNumber).toBe(200);
    expect(hook.result.current.read.readGateway.reading).toBe(reading);
    expect(fetcher).toHaveBeenCalledTimes(3);
  } finally {
    await hook.unmount();
  }
});

it.each(['csrf', 'timings'] as const)(
  'preserves in-flight %s and paused reading when its transport changes',
  async (stage) => {
    jest.useFakeTimers({ doNotFake: ['performance'] });
    let clock = 0;
    const monotonic = jest.spyOn(performance, 'now').mockImplementation(() => clock);
    let complete!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      complete = resolve;
    });
    const oldFetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async (url) =>
      url.endsWith(stage === 'csrf' ? '/session/csrf' : '/topics/timings')
        ? pending
        : new Response(JSON.stringify({ csrf: 'same-transport-identity' }))
    );
    const nextFetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async () => new Response(''));
    const options = {
      enabledSources: ['linuxdo'] as Source[],
      loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
      notify: jest.fn(),
      nodeSeekRecoveryThreshold: 1,
      openUser: async () => undefined,
      ready: false,
      screen: 'search' as const,
      webViewBlockMessage: ''
    };
    seedAccount();
    const hook = await renderHook(
      (props: { fetcher: Fetcher; appActive: boolean }) => useAccountRuntime({ ...options, ...props }),
      { initialProps: { fetcher: oldFetcher, appActive: true }, wrapper: QueryTestWrapper }
    );
    const advance = async (milliseconds: number) => {
      await act(async () => {
        for (let elapsed = 0; elapsed < milliseconds; elapsed += 1000) {
          clock += 1000;
          await jest.advanceTimersByTimeAsync(1000);
        }
      });
    };
    const postBodies = () =>
      [...oldFetcher.mock.calls, ...nextFetcher.mock.calls]
        .filter(([url]) => url.endsWith('/topics/timings'))
        .map(([, init]) => Object.fromEntries(new URLSearchParams(init?.body as string)));
    try {
      const reading = hook.result.current.read.readGateway.reading!;
      const session = reading.begin('12');
      session.visible([1]);
      session.active(true);
      await advance(1000);
      const heldSignal = oldFetcher.mock.calls.at(-1)?.[1]?.signal;
      session.visible([2]);
      await advance(5000);
      await hook.rerender({ fetcher: nextFetcher, appActive: false });
      expect(heldSignal?.aborted).toBe(false);
      await act(async () => {
        complete(
          stage === 'csrf' ? new Response(JSON.stringify({ csrf: 'same-transport-identity' })) : new Response('')
        );
      });
      expect(postBodies()).toEqual([
        { topic_id: '12', topic_time: '1000', 'timings[1]': '1000' },
        { topic_id: '12', topic_time: '5000', 'timings[2]': '5000' }
      ]);
      await advance(10000);
      expect(postBodies()).toHaveLength(2);
      session.visible([3]);
      await hook.rerender({ fetcher: nextFetcher, appActive: true });
      await advance(1000);
      await act(async () => session.end());
      expect(postBodies()).toEqual([
        { topic_id: '12', topic_time: '1000', 'timings[1]': '1000' },
        { topic_id: '12', topic_time: '5000', 'timings[2]': '5000' },
        { topic_id: '12', topic_time: '1000', 'timings[3]': '1000' }
      ]);
      expect(nextFetcher.mock.calls.every(([url]) => url.endsWith('/topics/timings'))).toBe(true);
      expect(reading.state()['12'].anchor).toEqual({ floor: 3 });
    } finally {
      complete(new Response(''));
      await hook.unmount();
      monotonic.mockRestore();
      jest.useRealTimers();
    }
  }
);

it.each(
  (['csrf', 'timings'] as const).flatMap((stage) =>
    (['changed', 'anonymous', 'disabled'] as const).map((transition) => ({ stage, transition }))
  )
)('isolates pending reading at $stage when the account becomes $transition', async ({ stage, transition }) => {
  jest.useFakeTimers({ doNotFake: ['performance'] });
  let clock = 0;
  const monotonic = jest.spyOn(performance, 'now').mockImplementation(() => clock);
  let complete!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    complete = resolve;
  });
  let held = false;
  const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async (url) => {
    if (!held && url.endsWith(stage === 'csrf' ? '/session/csrf' : '/topics/timings')) {
      held = true;
      return pending;
    }
    return url.endsWith('/session/csrf') ? new Response(JSON.stringify({ csrf: 'current-token' })) : new Response('');
  });
  let hook: Awaited<ReturnType<typeof renderRuntime>> | undefined;
  const advance = async (milliseconds: number) => {
    await act(async () => {
      for (let elapsed = 0; elapsed < milliseconds; elapsed += 1000) {
        clock += 1000;
        await jest.advanceTimersByTimeAsync(1000);
      }
    });
  };
  const postBodies = () =>
    fetcher.mock.calls
      .filter(([url]) => url.endsWith('/topics/timings'))
      .map(([, init]) => Object.fromEntries(new URLSearchParams(init?.body as string)));
  try {
    hook = await renderRuntime(fetcher);
    const oldReading = hook.result.current.read.readGateway.reading!;
    const oldScope = oldReading.scope();
    const oldSession = oldReading.begin('12');
    oldSession.visible([1]);
    oldSession.active(true);
    await advance(1000);
    expect(held).toBe(true);
    oldSession.visible([2]);
    await advance(5000);
    const expectedOldPosts = stage === 'timings' ? 1 : 0;
    expect(postBodies()).toHaveLength(expectedOldPosts);
    const heldSignal = fetcher.mock.calls[stage === 'csrf' ? 0 : 1][1]?.signal;

    if (transition === 'disabled') await hook.rerender({ enabledSources: [] });
    else
      await act(async () => {
        if (transition === 'changed') seedAccount('bob');
        else appQueryClient.setQueryData(accountQueryKeys.snapshot('linuxdo'), createAccountSessionSnapshot('linuxdo'));
      });
    await waitFor(() => expect(heldSignal?.aborted).toBe(true));
    expect(appQueryClient.getQueryData(discourseReadingQueryKey(oldScope))).toBeUndefined();
    const current = hook.result.current.read.readGateway.reading!;
    expect(current.state()).toEqual({});
    const newSession = current.begin('13');
    newSession.visible([1]);
    newSession.active(true);
    await advance(1000);
    await act(async () => newSession.end());
    expect(postBodies().map((body) => body.topic_id)).toEqual([
      ...(stage === 'timings' ? ['12'] : []),
      ...(transition === 'changed' ? ['13'] : [])
    ]);
    await act(async () => {
      complete(
        stage === 'csrf'
          ? new Response(JSON.stringify({ csrf: 'stale-token' }))
          : new Response(JSON.stringify({ errors: ['登录状态已失效'] }), { status: 401 })
      );
    });
    await advance(30000);
    expect(postBodies()).toHaveLength(expectedOldPosts + (transition === 'changed' ? 1 : 0));
    expect(current.state()['12']).toBeUndefined();
    if (transition === 'changed') {
      expect(hook.result.current.read.accountSessionViewModels.linuxdo.currentUser?.username).toBe('bob');
      expect(current.state()['13'].server.lastReadPostNumber).toBe(1);
      expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/session/csrf'))).toHaveLength(2);
    } else {
      expect(current.scope()).toBeNull();
      expect(current.state()).toEqual({});
    }
    if (transition === 'disabled') {
      await hook.rerender({ enabledSources: ['linuxdo'] });
      oldSession.visible([3]);
      oldSession.active(true);
      await advance(1000);
      expect(postBodies()).toHaveLength(expectedOldPosts);
      expect(current.state()).toEqual({});
      const resumed = hook.result.current.read.readGateway.reading!.begin('13');
      resumed.visible([1]);
      resumed.active(true);
      await advance(1000);
      await act(async () => resumed.end());
      expect(postBodies().at(-1)?.topic_id).toBe('13');
    }
    await act(async () => oldSession.end());
    expect(hook.result.current.hosts.linuxDoVerificationVisible).toBe(false);
  } finally {
    complete(new Response(''));
    await hook?.unmount();
    monotonic.mockRestore();
    jest.useRealTimers();
  }
});

it('pauses reading behind read recovery and resumes without replacing account progress', async () => {
  jest.useFakeTimers({ doNotFake: ['performance'] });
  let clock = 0;
  const monotonic = jest.spyOn(performance, 'now').mockImplementation(() => clock);
  const queryKey = ['reading-recovery-overlay'];
  const observer = new QueryObserver(appQueryClient, {
    queryKey,
    queryFn: async () => ({}),
    initialData: {},
    staleTime: Infinity
  });
  const unsubscribe = observer.subscribe(() => undefined);
  const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async (url) =>
    url.endsWith('/session/csrf') ? new Response(JSON.stringify({ csrf: 'test' })) : new Response('')
  );
  let hook: Awaited<ReturnType<typeof renderRuntime>> | undefined;
  const advance = async (milliseconds: number) => {
    await act(async () => {
      for (let elapsed = 0; elapsed < milliseconds; elapsed += 1000) {
        clock += 1000;
        await jest.advanceTimersByTimeAsync(1000);
      }
    });
  };
  try {
    hook = await renderRuntime(fetcher);
    const reading = hook.result.current.read.readGateway.reading!;
    const scope = reading.scope();
    const plan = hook.result.current.read.readGateway.getReadPlan('linuxdo', 'topic');
    const session = reading.begin('12');
    session.visible([1], { floor: 1 });
    session.active(true);
    await advance(1000);
    expect(reading.state()['12'].readPosts[1]).toBe(true);
    await act(async () => {
      await hook!.result.current.hosts.showLinuxDoVerification('读取需要验证', {
        queryKey,
        resume: async () => 'completed'
      });
    });
    expect(hook.result.current.hosts.linuxDoVerificationVisible).toBe(true);
    expect(hook.result.current.read.readGateway.getReadPlan('linuxdo', 'topic')).toEqual(plan);
    session.visible([2], { floor: 2 });
    await advance(10000);
    expect(reading.state()['12'].readPosts[2]).toBeUndefined();
    expect(reading.state()['12'].anchor).toEqual({ floor: 1 });
    expect(reading.scope()).toBe(scope);
    await act(async () => hook!.result.current.hosts.closePanels());
    expect(hook.result.current.hosts.linuxDoVerificationVisible).toBe(false);
    expect(hook.result.current.read.readGateway.reading).toBe(reading);
    await advance(1000);
    expect(reading.state()['12'].readPosts[2]).toBe(true);
    await act(async () => session.end());
    expect(
      fetcher.mock.calls
        .filter(([url]) => url.endsWith('/topics/timings'))
        .reduce((total, [, init]) => total + Number(new URLSearchParams(init?.body as string).get('topic_time')), 0)
    ).toBe(2000);
  } finally {
    await hook?.unmount();
    unsubscribe();
    monotonic.mockRestore();
    jest.useRealTimers();
  }
});

it.each(['loading', 'ready'] as const)(
  'preserves the same login page across background and foreground: %s',
  async (phase) => {
    seedAccount();
    const fetcher = jest.fn(async () => new Response('{}'));
    const options = {
      enabledSources: ['linuxdo'] as Source[],
      fetcher,
      loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
      notify: jest.fn(),
      nodeSeekRecoveryThreshold: 1,
      openUser: async () => undefined,
      ready: false,
      screen: 'search' as const,
      webViewBlockMessage: ''
    };
    let runtime!: ReturnType<typeof useAccountRuntime>;
    function Harness({ appActive }: { appActive: boolean }) {
      runtime = useAccountRuntime({ ...options, appActive });
      return runtime.hosts.element;
    }
    const view = await render(<Harness appActive />, { wrapper: QueryTestWrapper });
    await act(async () => runtime.center.handleAccountCenterCommand({ type: 'open-login', site: 'linuxdo' }));
    const webView = await view.findByTestId('login-webview');
    if (phase === 'ready') await fireEvent(webView, 'loadEnd', { nativeEvent: {} });
    const epoch = runtime.read.forumSessionEpochs.linuxdo;
    const handoffs = jest.mocked(setLinuxDoCookieResponseBarrier).mock.calls.length;

    await view.rerender(<Harness appActive={false} />);
    expect(view.getByTestId('login-webview')).toBe(webView);
    await view.rerender(<Harness appActive />);
    expect(view.getByTestId('login-webview')).toBe(webView);
    expect(runtime.hosts.linuxDoVerificationVisible).toBe(true);
    expect(runtime.read.forumSessionEpochs.linuxdo).toBe(epoch);
    expect(setLinuxDoCookieResponseBarrier).toHaveBeenCalledTimes(handoffs);
    expect(fetcher).not.toHaveBeenCalled();
  }
);

it.each(['anonymous', 'same', 'changed', 'unknown'] as const)(
  'settles concurrent login contradictions through one account probe: %s',
  async (outcome) => {
    let complete!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      complete = resolve;
    });
    const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async (input) => {
      if (input.includes('/session/current.json')) return pending;
      if (input.includes('/session/csrf')) return new Response(JSON.stringify({ csrf: 'token' }));
      return new Response(JSON.stringify({ errors: ['您需要登录才能执行此操作。'] }), { status: 403 });
    });
    const hook = await renderRuntime(fetcher);
    const epoch = hook.result.current.read.forumSessionEpochs.linuxdo;
    await act(async () => {
      await expect(
        hook.result.current.read.readGateway.searchTopics({ source: 'linuxdo', query: 'AI' })
      ).rejects.toMatchObject({ reason: 'account-recheck-required' });
      hook.result.current.write.requestAccountRecheck('linuxdo', epoch, 'trace-987');
    });
    await waitFor(() =>
      expect(fetcher.mock.calls.filter(([url]) => url.includes('/session/current.json'))).toHaveLength(1)
    );
    await waitFor(() =>
      expect(hook.result.current.read.accountSessionViewModels.linuxdo).toMatchObject({
        isLoggedIn: true,
        isVerifying: true
      })
    );
    expect(hook.result.current.read.readGateway.getReadPlan('linuxdo', 'search')).toMatchObject({
      lane: 'authenticated'
    });
    await act(async () => {
      complete(
        outcome === 'unknown'
          ? new Response(JSON.stringify({ errors: ['您需要登录才能执行此操作。'] }), { status: 403 })
          : new Response(
              JSON.stringify({
                current_user: outcome === 'anonymous' ? null : { username: outcome === 'changed' ? 'bob' : 'alice' }
              })
            )
      );
    });
    await waitFor(() => expect(hook.result.current.read.accountSessionViewModels.linuxdo.isVerifying).toBe(false));
    expect(hook.result.current.read.accountSessionViewModels.linuxdo.isLoggedIn).toBe(outcome !== 'anonymous');
    expect(hook.result.current.read.forumSessionEpochs.linuxdo).toBe(
      epoch + (outcome === 'anonymous' || outcome === 'changed' ? 1 : 0)
    );
    expect(hook.result.current.read.readGateway.getReadPlan('linuxdo', 'search')).toMatchObject({
      lane: outcome === 'anonymous' ? 'public' : 'authenticated'
    });
    if (outcome === 'changed')
      expect(hook.result.current.read.accountSessionViewModels.linuxdo.currentUser?.username).toBe('bob');
    if (outcome === 'unknown') expect(hook.result.current.read.accountSessionViewModels.linuxdo.lastError).toBeTruthy();
    expect(fetcher.mock.calls.filter(([url]) => url.includes('/session/current.json'))).toHaveLength(1);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'account-reconcile',
          phase: 'intent',
          parentTraceId: expect.stringMatching(/^trace-/)
        }),
        expect.objectContaining({
          operation: 'account-reconcile',
          phase: 'guard',
          reason: 'duplicate',
          parentTraceId: 'trace-987'
        }),
        expect.objectContaining({ operation: 'account-reconcile', phase: 'finish' })
      ])
    );
  }
);

it('ignores stale, disabled, anonymous and login-surface recheck requests', async () => {
  const fetcher = jest.fn(async () => new Response('{}'));
  const hook = await renderRuntime(fetcher);
  const epoch = hook.result.current.read.forumSessionEpochs.linuxdo;
  const request = hook.result.current.write.requestAccountRecheck;
  await act(async () => {
    request('linuxdo', epoch - 1);
  });
  await hook.rerender({ enabledSources: [] });
  await act(async () => {
    request('linuxdo', epoch);
  });
  await hook.rerender({ enabledSources: ['linuxdo'] });
  await act(async () => {
    appQueryClient.setQueryData(accountQueryKeys.snapshot('linuxdo'), createAccountSessionSnapshot('linuxdo'));
    hook.result.current.write.requestAccountRecheck('linuxdo', epoch);
    appQueryClient.setQueryData(accountQueryKeys.snapshot('linuxdo'), {
      ...createAccountSessionSnapshot('linuxdo'),
      identityTrust: 'none'
    });
    hook.result.current.write.requestAccountRecheck('linuxdo', epoch);
    seedAccount();
    hook.result.current.hosts.showLinuxDoVerification('需要验证');
    hook.result.current.write.requestAccountRecheck('linuxdo', epoch);
  });
  expect(fetcher).not.toHaveBeenCalled();
});

it('discards a recheck result when its source is disabled while the probe is in flight', async () => {
  let complete!: (response: Response) => void;
  const fetcher = jest.fn(
    () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      })
  );
  const hook = await renderRuntime(fetcher);
  const epoch = hook.result.current.read.forumSessionEpochs.linuxdo;
  await act(async () => {
    hook.result.current.write.requestAccountRecheck('linuxdo', epoch);
  });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  await hook.rerender({ enabledSources: [] });
  expect(setLinuxDoCookieResponseBarrier).toHaveBeenLastCalledWith(true, 'source-change');
  await act(async () => {
    complete(new Response(JSON.stringify({ current_user: null })));
  });
  expect(appQueryClient.getQueryData(accountQueryKeys.snapshot('linuxdo'))).toMatchObject({
    status: 'logged-in',
    currentUser: { username: 'alice' }
  });
  expect(hook.result.current.read.forumSessionEpochs.linuxdo).toBe(epoch);
});

it('awaits the native cookie handoff before probing after login closes', async () => {
  const fetcher = jest.fn(
    async () => new Response(JSON.stringify({ current_user: { id: 'alice', username: 'alice' } }))
  );
  const hook = await renderRuntime(fetcher);
  await act(async () => {
    await hook.result.current.hosts.showLinuxDoVerification('登录');
  });
  let release!: () => void;
  jest.mocked(setLinuxDoCookieResponseBarrier).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  await act(async () => {
    hook.result.current.hosts.closePanels();
  });
  expect(setLinuxDoCookieResponseBarrier).toHaveBeenLastCalledWith(false, 'surface-close', expect.any(Number));
  expect(fetcher).not.toHaveBeenCalled();
  const callsBeforeDuplicateClose = jest.mocked(setLinuxDoCookieResponseBarrier).mock.calls.length;
  await act(async () => {
    hook.result.current.hosts.closePanels();
  });
  expect(jest.mocked(setLinuxDoCookieResponseBarrier).mock.calls).toHaveLength(callsBeforeDuplicateClose);
  await act(async () => {
    release();
  });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
});
