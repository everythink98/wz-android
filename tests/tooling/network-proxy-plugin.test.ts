import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const plugin = require('../../plugins/withNetworkProxyModule') as {
  injectCronetProguardRules: (contents: string) => string;
};

describe('withNetworkProxyModule local relay hardening', () => {
  const pluginSource = readFileSync(join(process.cwd(), 'plugins', 'withNetworkProxyModule.js'), 'utf8');

  it('binds the relay with the connection cap as its backlog', () => {
    expect(pluginSource).toContain('ServerSocket(0, MAX_PROXY_CONNECTIONS, InetAddress.getByName("127.0.0.1"))');
  });

  it('injects only the optional Cronet platform warnings once', () => {
    const first = plugin.injectCronetProguardRules('# project rules\n');
    const second = plugin.injectCronetProguardRules(first);

    expect(second).toBe(first);
    expect(first.match(/-dontwarn android\.app\.privatecompute\.PccSandboxManager/g)).toHaveLength(1);
    expect(first.match(/-dontwarn android\.net\.http\.Proxy\$HttpConnectCallback/g)).toHaveLength(1);
    expect(first.match(/-dontwarn android\.net\.http\.Proxy$/gm)).toHaveLength(1);
    expect(first.match(/-dontwarn android\.net\.http\.ProxyOptions/g)).toHaveLength(1);
    expect(first).not.toContain('-ignorewarnings');
    expect(first).not.toContain('-dontwarn android.**');
  });
});
