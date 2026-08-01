import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const plugin = require('../../plugins/withNetworkProxyModule') as {
  patchExpoVideoDataSource: (projectRoot: string) => void;
};
const scratchRoots: string[] = [];
const reviewedDataSource = readFileSync(
  join(
    process.cwd(),
    'node_modules',
    'expo-video',
    'android',
    'src',
    'main',
    'java',
    'expo',
    'modules',
    'video',
    'utils',
    'DataSourceUtils.kt'
  ),
  'utf8'
)
  .replace('import com.facebook.react.modules.network.OkHttpClientProvider', 'import okhttp3.OkHttpClient')
  .replace('  val client = OkHttpClientProvider.createClient()', '  val client = OkHttpClient.Builder().build()');

function expoVideoFixture(source = reviewedDataSource) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'wz-expo-video-plugin-'));
  scratchRoots.push(projectRoot);
  const packageRoot = join(projectRoot, 'node_modules', 'expo-video');
  const sourcePath = join(
    packageRoot,
    'android',
    'src',
    'main',
    'java',
    'expo',
    'modules',
    'video',
    'utils',
    'DataSourceUtils.kt'
  );
  mkdirSync(dirname(sourcePath), { recursive: true });
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ version: '3.0.16' }));
  writeFileSync(sourcePath, source);
  return { projectRoot, sourcePath };
}

afterEach(() => {
  scratchRoots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('withNetworkProxyModule Expo Video integration', () => {
  it('routes the locked Expo Video data source through the managed RN client idempotently', () => {
    const fixture = expoVideoFixture();

    plugin.patchExpoVideoDataSource(fixture.projectRoot);
    const patched = readFileSync(fixture.sourcePath, 'utf8');
    plugin.patchExpoVideoDataSource(fixture.projectRoot);

    expect(patched).toContain('import com.facebook.react.modules.network.OkHttpClientProvider');
    expect(patched).toContain('val client = OkHttpClientProvider.createClient()');
    expect(patched).not.toContain('val client = OkHttpClient.Builder().build()');
    expect(readFileSync(fixture.sourcePath, 'utf8')).toBe(patched);
  });

  it('fails before native generation when the locked Expo Video source shape drifts', () => {
    const fixture = expoVideoFixture(
      reviewedDataSource.replace('val client = OkHttpClient.Builder().build()', 'val client = customVideoClient()')
    );

    expect(() => plugin.patchExpoVideoDataSource(fixture.projectRoot)).toThrow(
      'Expo Video DataSource 源码与已审核版本不匹配'
    );
  });
});

describe('withNetworkProxyModule local relay hardening', () => {
  const pluginSource = readFileSync(join(process.cwd(), 'plugins', 'withNetworkProxyModule.js'), 'utf8');

  it('[REG-PROXY-007] binds the relay with the connection cap as its backlog', () => {
    expect(pluginSource).toContain('ServerSocket(0, MAX_PROXY_CONNECTIONS, InetAddress.getByName("127.0.0.1"))');
  });
});
