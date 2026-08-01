import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const proxyMocks = vi.hoisted(() => ({
  loadNetworkProxyState: vi.fn()
}));

vi.mock('react', () => ({
  useCallback: <T>(callback: T) => callback,
  useEffect: (effect: () => void | (() => void)) => {
    effect();
  },
  useMemo: <T>(factory: () => T) => factory(),
  useRef: <T>(value: T) => ({ current: value }),
  useState: <T>(initial: T | (() => T)) => [typeof initial === 'function' ? (initial as () => T)() : initial, vi.fn()]
}));

vi.mock('react-native', () => ({ NativeModules: { NetworkProxyModule: {} } }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn()
}));
vi.mock('@/platform/network/networkProxy', async () => ({
  ...(await vi.importActual<typeof import('@/platform/network/networkProxy')>('@/platform/network/networkProxy')),
  loadNetworkProxyState: proxyMocks.loadNetworkProxyState
}));

import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { useNetworkProxyController } from '@/app/useNetworkProxyController';

const rootDir = path.resolve(__dirname, '..');

function readSource(...parts: string[]) {
  return readFileSync(path.join(rootDir, ...parts), 'utf8');
}

afterEach(() => {
  setDiagnosticWriter(null);
  vi.clearAllMocks();
});

describe('network proxy controller guard', () => {
  it('[REG-PROXY-001] blocks requests when the saved proxy state cannot be read', async () => {
    proxyMocks.loadNetworkProxyState.mockRejectedValueOnce(new Error('secure storage unavailable'));
    const notify = vi.fn();

    const controller = useNetworkProxyController({ notify });

    await expect(controller.ensureNetworkProxyReady()).rejects.toThrow('代理配置读取失败');
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('代理配置读取失败'));
  });

  it('records only safe state when loading a saved proxy', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    proxyMocks.loadNetworkProxyState.mockResolvedValueOnce({
      enabled: true,
      activeId: 'private-profile-id',
      profiles: [
        {
          id: 'private-profile-id',
          name: 'private name',
          protocol: 'socks5',
          host: 'private.proxy.example',
          port: 1080,
          username: 'private-user',
          password: 'private-pass'
        }
      ]
    });

    useNetworkProxyController({ notify: vi.fn() });

    await vi.waitFor(() => {
      expect(lines.some((line) => JSON.parse(line).phase === 'finish')).toBe(true);
    });
    const serialized = lines.join('');
    const events = lines.map((line) => JSON.parse(line));
    expect(events.filter((event) => event.operation === 'load')).toEqual([
      expect.objectContaining({ area: 'proxy', operation: 'load', phase: 'intent' }),
      expect.objectContaining({ phase: 'persist', store: 'secure-store', hasProxy: true, isEnabled: true }),
      expect.objectContaining({ phase: 'finish', outcome: 'success', hasProxy: true, isEnabled: true })
    ]);
    expect(serialized).not.toMatch(/private-profile-id|private name|private\.proxy|private-user|private-pass|1080/);
  });

  it('keeps enable, persistence and native apply on one diagnostic trace', () => {
    const source = readSource('src', 'app', 'useNetworkProxyController.ts');
    const enableFlow = source.slice(
      source.indexOf('const runSetProxyEnabled'),
      source.indexOf('const upsertProxyProfile')
    );

    expect(enableFlow).toContain('}, trace);');
    expect(enableFlow).toContain('await applyPersistedProxyState(result.state, trace);');
    expect(enableFlow).toContain("finishDiagnosticTrace(trace, 'success', { isEnabled: enabled, state: status });");
    expect(enableFlow.indexOf('await applyPersistedProxyState(result.state, trace);')).toBeLessThan(
      enableFlow.indexOf("finishDiagnosticTrace(trace, 'success'")
    );
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

  it('delays main content until the saved proxy state is applied', () => {
    const source = readSource('src', 'app', 'AppRoot.tsx');

    expect(source).toContain('const [networkProxyContentReady, setNetworkProxyContentReady] = useState(false);');
    expect(source).toContain('setDefaultAvatarFetcher(networkProxyFetcher)');
    expect(source).toMatch(
      /networkProxyState\.enabled\s*&&\s*\(networkProxyApplyStatus === 'loading'\s*\|\|\s*networkProxyApplyStatus === 'applying'\)/
    );
    expect(source).toMatch(/\{networkProxyContentReady\s*\?\s*\(/);
  });
});
