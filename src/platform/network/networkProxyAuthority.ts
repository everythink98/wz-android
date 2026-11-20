import { activeNetworkProxyProfile, applyNetworkProxy, loadNetworkProxyState } from './networkProxy';

type ProxyAuthority = { kind: 'headless' } | { kind: 'app'; ready: () => Promise<void> };

let authority: ProxyAuthority = { kind: 'headless' };

export function registerAppNetworkProxy(ready: () => Promise<void>) {
  const owner: ProxyAuthority = { kind: 'app', ready };
  authority = owner;
  return () => {
    if (authority === owner) authority = { kind: 'headless' };
  };
}

export async function restoreBackgroundNetworkProxy(assertActive: () => void) {
  assertActive();
  const initial = authority;
  if (initial.kind === 'headless') {
    const state = await loadNetworkProxyState();
    assertActive();
    // Expo may start the App while its task is reading the old saved configuration.
    if (authority === initial) {
      await applyNetworkProxy(state.enabled ? activeNetworkProxyProfile(state) : null);
    }
  }

  const current = authority;
  if (current.kind === 'app') await current.ready();
  assertActive();
  if (current !== authority || (current.kind === 'headless' && current !== initial)) {
    throw new Error('代理运行时已变化');
  }
}
