import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = path.resolve(__dirname, '..');

function readSource(...parts: string[]) {
  return readFileSync(path.join(rootDir, ...parts), 'utf8');
}

describe('network proxy controller guard', () => {
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

  it('delays main content until the saved proxy state is applied', () => {
    const source = readSource('src', 'app', 'AppRoot.tsx');

    expect(source).toContain('const [networkProxyContentReady, setNetworkProxyContentReady] = useState(false);');
    expect(source).toContain('setDefaultAvatarFetcher(networkProxyFetcher)');
    expect(source).toContain("networkProxyState.enabled && (networkProxyApplyStatus === 'loading' || networkProxyApplyStatus === 'applying')");
    expect(source).toContain('{networkProxyContentReady ? (');
  });
});
