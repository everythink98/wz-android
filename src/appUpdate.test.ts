import { describe, expect, it, vi } from 'vitest';
import { GITHUB_LATEST_RELEASE_URL, UPDATE_APK_NAME, checkGithubAppUpdate, compareAppVersions, getAppUpdateFromRelease } from './appUpdate';

function release(tagName: string, assets = [{ name: UPDATE_APK_NAME, browser_download_url: 'https://example.com/app.apk' }]) {
  return {
    tag_name: tagName,
    body: '修复问题',
    assets
  };
}

describe('app update release parsing', () => {
  it('finds a newer APK asset from GitHub release', () => {
    expect(getAppUpdateFromRelease('1.3.6', release('v1.3.7'))).toEqual({
      version: '1.3.7',
      apkUrl: 'https://example.com/app.apk',
      notes: '修复问题'
    });
  });

  it('does not offer current or older releases', () => {
    expect(getAppUpdateFromRelease('1.3.6', release('v1.3.6'))).toBeNull();
    expect(getAppUpdateFromRelease('1.3.6', release('v1.3.5'))).toBeNull();
  });

  it('rejects newer releases without the fixed APK asset', () => {
    expect(() => getAppUpdateFromRelease('1.3.6', release('v1.3.7', [
      { name: 'app-release.apk', browser_download_url: 'https://example.com/wrong.apk' }
    ]))).toThrow('GitHub Release 未找到 app-arm64-v8a-release.apk。');
  });

  it('rejects invalid release tags', () => {
    expect(() => getAppUpdateFromRelease('1.3.6', release('latest'))).toThrow('GitHub Release 版本格式不正确。');
    expect(() => getAppUpdateFromRelease('1.3.6', release('1.3.7'))).toThrow('GitHub Release 版本格式不正确。');
  });

  it('compares multi-digit versions numerically', () => {
    expect(compareAppVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareAppVersions('2.0.0', '10.0.0')).toBeLessThan(0);
  });

  it('loads the latest GitHub release with the pinned API version', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(release('v1.3.7'))));

    expect(await checkGithubAppUpdate(fetcher as unknown as typeof fetch, '1.3.6')).toMatchObject({
      version: '1.3.7',
      apkUrl: 'https://example.com/app.apk'
    });
    expect(fetcher).toHaveBeenCalledWith(GITHUB_LATEST_RELEASE_URL, expect.objectContaining({
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      signal: expect.any(AbortSignal)
    }));
  });
});
