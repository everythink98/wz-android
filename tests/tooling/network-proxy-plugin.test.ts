import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('forum platform native ownership', () => {
  it('keeps runtime sources and test dependencies in the library, not generated App copies', () => {
    for (const name of ['withNetworkProxyModule.js', 'withDiagnosticJournal.js', 'withSvgRendererModule.js']) {
      const plugin = readFileSync(join(process.cwd(), 'plugins', name), 'utf8');
      expect(plugin).not.toContain('.kt');
      expect(plugin).not.toContain('testImplementation');
      expect(plugin).not.toContain('androidPackagePath');
    }
    const rules = readFileSync('modules/forum-platform/android/consumer-rules.pro', 'utf8');
    expect(rules.split('\n').filter((line) => line.startsWith('-'))).toEqual([
      '-dontwarn android.app.privatecompute.PccSandboxManager',
      '-dontwarn android.net.http.Proxy$HttpConnectCallback',
      '-dontwarn android.net.http.Proxy',
      '-dontwarn android.net.http.ProxyOptions'
    ]);
  });
});
