import { describe, expect, it, vi } from 'vitest';
import { GITHUB_LATEST_RELEASE_URL, UPDATE_APK_NAME, checkGithubAppUpdate, compareAppVersions, getAppUpdateFromRelease } from './appUpdate';

function releaseApkUrl(tagName: string) {
  return `https://github.com/everythink98/wz-android/releases/download/${tagName}/${UPDATE_APK_NAME}`;
}

function release(tagName: string, assets = [{ name: UPDATE_APK_NAME, browser_download_url: releaseApkUrl(tagName) }]) {
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
      apkUrl: releaseApkUrl('v1.3.7'),
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

  it('rejects APK assets outside the expected GitHub release URL', () => {
    expect(() => getAppUpdateFromRelease('1.3.6', release('v1.3.7', [
      { name: UPDATE_APK_NAME, browser_download_url: 'http://github.com/everythink98/wz-android/releases/download/v1.3.7/app-arm64-v8a-release.apk' }
    ]))).toThrow('GitHub Release APK 下载地址不可信。');

    expect(() => getAppUpdateFromRelease('1.3.6', release('v1.3.7', [
      { name: UPDATE_APK_NAME, browser_download_url: 'https://github.com/other/wz-android/releases/download/v1.3.7/app-arm64-v8a-release.apk' }
    ]))).toThrow('GitHub Release APK 下载地址不可信。');

    expect(() => getAppUpdateFromRelease('1.3.6', release('v1.3.7', [
      { name: UPDATE_APK_NAME, browser_download_url: 'https://github.com/everythink98/wz-android/releases/download/v1.3.7/app-release.apk' }
    ]))).toThrow('GitHub Release APK 下载地址不可信。');
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
      apkUrl: releaseApkUrl('v1.3.7')
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
