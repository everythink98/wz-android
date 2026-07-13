import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const proxyMocks = vi.hoisted(() => ({
  loadNetworkProxyState: vi.fn()
}));

vi.mock('react', () => ({
  useCallback: <T,>(callback: T) => callback,
  useEffect: (effect: () => void | (() => void)) => { effect(); },
  useLayoutEffect: (effect: () => void) => { effect(); },
  useMemo: <T,>(factory: () => T) => factory(),
  useRef: <T,>(value: T) => ({ current: value }),
  useState: <T,>(initial: T | (() => T)) => [
    typeof initial === 'function' ? (initial as () => T)() : initial,
    vi.fn()
  ]
}));

vi.mock('react-native', () => ({ NativeModules: { NetworkProxyModule: {} } }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn()
}));
vi.mock('./networkProxy', async () => ({
  ...await vi.importActual<typeof import('./networkProxy')>('./networkProxy'),
  loadNetworkProxyState: proxyMocks.loadNetworkProxyState
}));

import { setDiagnosticWriter } from './diagnostics';
import { useNetworkProxyController } from './app/useNetworkProxyController';

const rootDir = path.resolve(__dirname, '..');

function readSource(...parts: string[]) {
  return readFileSync(path.join(rootDir, ...parts), 'utf8');
}

afterEach(() => {
  setDiagnosticWriter(null);
  vi.clearAllMocks();
});

describe('network proxy controller guard', () => {
  it('records only safe state when loading a saved proxy', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    proxyMocks.loadNetworkProxyState.mockResolvedValueOnce({
      enabled: true,
      activeId: 'private-profile-id',
      profiles: [{
        id: 'private-profile-id',
        name: 'private name',
        protocol: 'socks5',
        host: 'private.proxy.example',
        port: 1080,
        username: 'private-user',
        password: 'private-pass'
      }]
    });

    useNetworkProxyController({ notify: vi.fn() });

    await vi.waitFor(() => {
      expect(lines.some((line) => JSON.parse(line).phase === 'finish')).toBe(true);
    });
    const serialized = lines.join('');
    const events = lines.map((line) => JSON.parse(line));
    expect(events).toEqual([
      expect.objectContaining({ area: 'proxy', operation: 'load', phase: 'intent' }),
      expect.objectContaining({ phase: 'persist', store: 'secure-store', hasProxy: true, isEnabled: true }),
      expect.objectContaining({ phase: 'finish', outcome: 'success', hasProxy: true, isEnabled: true })
    ]);
    expect(serialized).not.toMatch(/private-profile-id|private name|private\.proxy|private-user|private-pass|1080/);
  });

  it('blocks requests while an enabled proxy is being edited or switched', () => {
    const source = readSource('src', 'app', 'useNetworkProxyController.ts');

    expect(source).toContain('const updatesCurrentProxy = current.enabled && current.activeId === profile.id;');
    expect(source).toContain('const switchesCurrentProxy = current.enabled && current.activeId !== id;');
    expect(source).toContain('proxyStateRef.current = state;');
    expect(source).toContain('loadedRef.current = true;');
    expect(source).toContain('proxyStateRef.current = next;');
    expect(source).toContain('setProxyState(next);');
    expect(source).toContain('proxyStateRef.current = previous;');
    expect(source).toContain('setProxyState(previous);');
    expect(source).toContain('applyStatusRef.current = status;');
    expect(source.match(/beginProxyApplyTransition\(\);/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps enable, persistence and native apply on one diagnostic trace', () => {
    const source = readSource('src', 'app', 'useNetworkProxyController.ts');
    const enableFlow = source.slice(
      source.indexOf('const setProxyEnabled'),
      source.indexOf('const upsertProxyProfile')
    );

    expect(enableFlow).toContain('pendingProxyApplyTraceRef.current = pendingTrace;');
    expect(enableFlow).toContain('}, trace);');
    expect(enableFlow).toContain('await applyCompleted;');
    expect(enableFlow).toContain("status === 'applied' || status === 'disabled'");
    expect(enableFlow).toContain("nativeApplyFailed = true;");
    expect(enableFlow).toContain("throw new Error(applyErrorRef.current || '代理未生效。');");
    expect(enableFlow.indexOf('await applyCompleted;')).toBeLessThan(enableFlow.indexOf("finishDiagnosticTrace(trace, 'success'"));
  });

  it('blocks all requests after a failed native disable instead of silently going direct', () => {
    const source = readSource('src', 'app', 'useNetworkProxyController.ts');
    const guard = source.slice(
      source.indexOf('const ensureNetworkProxyReady'),
      source.indexOf('const networkProxyFetcher')
    );

    expect(guard.indexOf("applyStatusRef.current === 'failed'")).toBeLessThan(guard.indexOf('if (!current.enabled)'));
    expect(guard).toContain("throw new Error(applyErrorRef.current || '代理状态不确定，请重新应用代理设置。');");
  });

  it('keeps native startup blocking active when persisted proxy settings cannot be read', () => {
    const source = readSource('src', 'app', 'useNetworkProxyController.ts');
    const loadFlow = source.slice(
      source.indexOf("const trace = beginDiagnosticTrace('proxy', 'load')"),
      source.indexOf('const replaceProxyState')
    );

    expect(loadFlow).toContain('proxyLoadFailedRef.current = true;');
    expect(loadFlow).toContain("setApplyState('failed', message);");
    expect(loadFlow).toContain('if (!loaded || proxyLoadFailedRef.current)');
    expect(loadFlow).not.toContain("applyNetworkProxy(null)");
    expect(source).toContain('proxyLoadFailedRef.current = false;');
    expect(source).toContain('setApplyRevision((revision) => revision + 1);');
    expect(source).toContain('[applyKey, applyRevision, loaded, notify, proxyState.enabled, setApplyState]');
  });

  it('delays main content until the saved proxy state is applied', () => {
    const source = readSource('src', 'app', 'AppRoot.tsx');

    expect(source).toContain('const [networkProxyContentReady, setNetworkProxyContentReady] = useState(false);');
    expect(source).toContain('setDefaultAvatarFetcher(networkProxyFetcher)');
    expect(source).toContain("networkProxyState.enabled && (networkProxyApplyStatus === 'loading' || networkProxyApplyStatus === 'applying')");
    expect(source).toContain('{networkProxyContentReady ? (');
  });
});
