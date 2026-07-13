import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({
  useCallback: <T,>(callback: T) => callback,
  useEffect: (effect: () => void | (() => void)) => effect(),
  useMemo: <T,>(factory: () => T) => factory(),
  useRef: <T,>(value: T) => ({ current: value }),
  useState: <T,>(initial: T | (() => T)) => {
    let state = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [state, (next: T | ((current: T) => T)) => {
      state = typeof next === 'function' ? (next as (current: T) => T)(state) : next;
    }];
  }
}));

const credentialMocks = vi.hoisted(() => ({
  clear: vi.fn(async () => undefined),
  load: vi.fn(async () => null as string | null),
  save: vi.fn(async () => undefined)
}));

const messageSessionMocks = vi.hoisted(() => ({
  create: vi.fn((scope: string) => ({
    sessionId: `${scope}-${messageSessionMocks.create.mock.calls.length}`,
    nonce: '0123456789abcdef0123456789abcdef'
  }))
}));

vi.mock('../nodeimageCredentials', () => ({
  clearNodeImageApiKey: credentialMocks.clear,
  loadNodeImageApiKey: credentialMocks.load,
  saveNodeImageApiKey: credentialMocks.save
}));

vi.mock('../webViewMessageGuard', async () => {
  const actual = await vi.importActual<typeof import('../webViewMessageGuard')>('../webViewMessageGuard');
  return {
    ...actual,
    createWebViewMessageSession: messageSessionMocks.create
  };
});

import { setDiagnosticWriter, type DiagnosticEvent } from '../diagnostics';
import { useNodeImageAuthController } from './useNodeImageAuthController';

function activeMessageSession() {
  const session = messageSessionMocks.create.mock.results.at(-1)?.value;
  if (!session) {
    throw new Error('NodeImage authorization did not create a message session.');
  }
  return session;
}

function nodeImageMessage(
  session: ReturnType<typeof activeMessageSession>,
  payload: Record<string, unknown>,
  url = 'https://www.nodeimage.com/'
) {
  return {
    nativeEvent: {
      data: JSON.stringify({ ...payload, ...session }),
      url
    }
  } as never;
}

afterEach(() => {
  setDiagnosticWriter(null);
  vi.clearAllMocks();
});

describe('NodeImage authorization diagnostics', () => {
  it('records one canceled authorization from intent through credential load to finish', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = useNodeImageAuthController({ notify: vi.fn() });

    const request = controller.ensureApiKey({ forceRefresh: true });
    controller.modal.close();

    await expect(request).resolves.toBeNull();
    const events = lines.map((line) => JSON.parse(line) as DiagnosticEvent)
      .filter((event) => event.area === 'credential' && event.operation === 'check');
    expect(events.map((event) => event.phase)).toEqual(['intent', 'credential', 'finish']);
    expect(events.at(-1)).toMatchObject({ outcome: 'canceled', reason: 'canceled' });
    expect(new Set(events.map((event) => event.traceId)).size).toBe(1);
  });

  it.each([
    ['save', (controller: ReturnType<typeof useNodeImageAuthController>) => controller.saveApiKey('PRIVATE_NODEIMAGE_KEY')],
    ['clear', (controller: ReturnType<typeof useNodeImageAuthController>) => controller.clearApiKey()]
  ] as const)('records one manual %s mutation from intent through persistence to finish', async (operation, mutate) => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = useNodeImageAuthController({ notify: vi.fn() });

    await mutate(controller);

    const events = lines.map((line) => JSON.parse(line) as DiagnosticEvent)
      .filter((event) => event.area === 'credential' && event.operation === operation);
    expect(events.map((event) => event.phase)).toEqual(['intent', 'persist', 'persist', 'finish']);
    expect(events.filter((event) => event.phase === 'persist').map((event) => event.state)).toEqual(['started', 'persisted']);
    expect(events.at(-1)).toMatchObject({ outcome: 'success' });
    expect(new Set(events.map((event) => event.traceId)).size).toBe(1);
    expect(lines.join('')).not.toContain('PRIVATE_NODEIMAGE_KEY');
  });

  it('persists only once when the NodeImage page posts the same API key twice concurrently', async () => {
    const firstSave = Promise.withResolvers<undefined>();
    credentialMocks.save.mockImplementationOnce(() => firstSave.promise).mockResolvedValue(undefined);
    const controller = useNodeImageAuthController({ notify: vi.fn() });
    const authorization = controller.ensureApiKey({ forceRefresh: true });
    const message = nodeImageMessage(activeMessageSession(), {
      type: 'nodeimage-api-key',
      api_key: 'PRIVATE_NODEIMAGE_KEY'
    });

    controller.modal.handleMessage(message);
    controller.modal.handleMessage(message);
    await vi.waitFor(() => expect(credentialMocks.save).toHaveBeenCalledTimes(1));
    firstSave.resolve(undefined);
    await authorization;
    await Promise.resolve();
    await Promise.resolve();

    expect(credentialMocks.save).toHaveBeenCalledTimes(1);
  });

  it('rejects a NodeImage API key message posted from the NodeSeek origin', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = useNodeImageAuthController({ notify: vi.fn() });
    const authorization = controller.ensureApiKey({ forceRefresh: true });

    controller.modal.handleMessage(nodeImageMessage(activeMessageSession(), {
      type: 'nodeimage-api-key',
      api_key: 'PRIVATE_NODEIMAGE_KEY'
    }, 'https://www.nodeseek.com/connect?target=NodeImage'));
    await Promise.resolve();
    controller.modal.close();
    await authorization;

    expect(credentialMocks.save).not.toHaveBeenCalled();
    const events = lines.map((line) => JSON.parse(line) as DiagnosticEvent);
    expect(events.filter(({ phase }) => phase === 'transport')).toHaveLength(0);
  });

  it('rejects NodeSeek authorization data posted from the NodeImage origin', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const controller = useNodeImageAuthController({ notify: vi.fn() });
    const authorization = controller.ensureApiKey({ forceRefresh: true });

    controller.modal.handleMessage(nodeImageMessage(activeMessageSession(), {
      type: 'nodeimage-auth-data',
      data: 'PRIVATE_AUTH_DATA',
      wtf: 'PRIVATE_WTF',
      sign: 'PRIVATE_SIGN'
    }));
    await Promise.resolve();
    controller.modal.close();
    await authorization;

    const events = lines.map((line) => JSON.parse(line) as DiagnosticEvent);
    expect(events.filter(({ phase }) => phase === 'transport')).toHaveLength(0);
    expect(events.filter(({ phase }) => phase === 'parse')).toHaveLength(0);
  });
});
