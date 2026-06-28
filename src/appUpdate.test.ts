import { describe, expect, it, vi } from 'vitest';
import {
  CURRENT_ANDROID_PACKAGE,
  GITHUB_LATEST_RELEASE_URL,
  UPDATE_APK_NAME,
  UPDATE_MANIFEST_NAME,
  checkGithubAppUpdate,
  compareAppVersions,
  getAppUpdateFromRelease,
  getReleaseManifestUrlFromRelease,
  formatAppUpdateDownloadProgress,
  installVerifiedApk
} from './appUpdate';

const apkSha256 = 'a'.repeat(64);
const signerSha256 = 'b'.repeat(64);
const newerVersion = '1.3.33';
const newerTag = `v${newerVersion}`;
const newerVersionCode = 37;

function releaseAssetUrl(tagName: string, assetName: string) {
  return `https://github.com/everythink98/wz-android/releases/download/${tagName}/${assetName}`;
}

function releaseApkUrl(tagName: string) {
  return releaseAssetUrl(tagName, UPDATE_APK_NAME);
}

function releaseManifestUrl(tagName: string) {
  return releaseAssetUrl(tagName, UPDATE_MANIFEST_NAME);
}

function release(tagName: string, assets = [
  { name: UPDATE_APK_NAME, browser_download_url: releaseApkUrl(tagName) },
  { name: UPDATE_MANIFEST_NAME, browser_download_url: releaseManifestUrl(tagName) }
]) {
  return {
    tag_name: tagName,
    body: '修复问题',
    assets
  };
}

function manifest(versionName = newerVersion) {
  return {
    apkName: UPDATE_APK_NAME,
    sha256: apkSha256,
    packageName: CURRENT_ANDROID_PACKAGE,
    versionName,
    versionCode: newerVersionCode,
    signerSha256
  };
}

describe('app update release parsing', () => {
  it('finds a newer APK asset from GitHub release manifest', () => {
    expect(getAppUpdateFromRelease('1.3.6', release(newerTag), manifest())).toEqual({
      version: newerVersion,
      apkUrl: releaseApkUrl(newerTag),
      notes: '修复问题',
      sha256: apkSha256,
      packageName: CURRENT_ANDROID_PACKAGE,
      versionName: newerVersion,
      versionCode: newerVersionCode,
      signerSha256
    });
  });

  it('does not offer current or older releases', () => {
    expect(getReleaseManifestUrlFromRelease('1.3.6', release('v1.3.6'))).toBeNull();
    expect(getAppUpdateFromRelease('1.3.6', release('v1.3.6'), manifest('1.3.6'))).toBeNull();
    expect(getAppUpdateFromRelease('1.3.6', release('v1.3.5'), manifest('1.3.5'))).toBeNull();
  });

  it('rejects newer releases without the fixed APK asset', () => {
    expect(() => getAppUpdateFromRelease('1.3.6', release(newerTag, [
      { name: UPDATE_MANIFEST_NAME, browser_download_url: releaseManifestUrl(newerTag) }
    ]), manifest())).toThrow('GitHub Release 未找到 app-arm64-v8a-release.apk。');
  });

  it('rejects APK assets outside the expected GitHub release URL', () => {
    expect(() => getAppUpdateFromRelease('1.3.6', release(newerTag, [
      { name: UPDATE_APK_NAME, browser_download_url: `http://github.com/everythink98/wz-android/releases/download/${newerTag}/app-arm64-v8a-release.apk` },
      { name: UPDATE_MANIFEST_NAME, browser_download_url: releaseManifestUrl(newerTag) }
    ]), manifest())).toThrow('GitHub Release 下载地址不可信。');

    expect(() => getReleaseManifestUrlFromRelease('1.3.6', release(newerTag, [
      { name: UPDATE_APK_NAME, browser_download_url: releaseApkUrl(newerTag) },
      { name: UPDATE_MANIFEST_NAME, browser_download_url: `https://github.com/other/wz-android/releases/download/${newerTag}/release-manifest.json` }
    ]))).toThrow('GitHub Release 下载地址不可信。');

    expect(() => getAppUpdateFromRelease('1.3.6', release(newerTag, [
      { name: UPDATE_APK_NAME, browser_download_url: `https://github.com/everythink98/wz-android/releases/download/${newerTag}/app-release.apk` },
      { name: UPDATE_MANIFEST_NAME, browser_download_url: releaseManifestUrl(newerTag) }
    ]), manifest())).toThrow('GitHub Release 下载地址不可信。');
  });

  it('rejects release manifests with mismatched package, version, or signature fields', () => {
    expect(() => getAppUpdateFromRelease('1.3.6', release(newerTag), {
      ...manifest(),
      packageName: 'evil.package'
    })).toThrow('Release manifest 内容不可信。');

    expect(() => getAppUpdateFromRelease('1.3.6', release(newerTag), {
      ...manifest(),
      versionName: '1.3.23'
    })).toThrow('Release manifest 内容不可信。');

    expect(() => getAppUpdateFromRelease('1.3.6', release(newerTag), {
      ...manifest(),
      signerSha256: 'not-a-sha'
    })).toThrow('Release manifest 内容不可信。');
  });

  it('rejects invalid release tags', () => {
    expect(() => getAppUpdateFromRelease('1.3.6', release('latest'), manifest())).toThrow('GitHub Release 版本格式不正确。');
    expect(() => getAppUpdateFromRelease('1.3.6', release('1.3.7'), manifest())).toThrow('GitHub Release 版本格式不正确。');
  });

  it('compares multi-digit versions numerically', () => {
    expect(compareAppVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareAppVersions('2.0.0', '10.0.0')).toBeLessThan(0);
  });

  it('formats app update download progress with percent and size', () => {
    expect(formatAppUpdateDownloadProgress('1.3.26', 12.3 * 1024 * 1024, 29 * 1024 * 1024)).toMatchObject({
      title: '正在下载 1.3.26',
      percent: 42,
      percentLabel: '42%',
      sizeLabel: '12.3 MB / 29.0 MB'
    });
  });

  it('formats app update download progress without percent when total size is unknown', () => {
    expect(formatAppUpdateDownloadProgress('1.3.26', 12.3 * 1024 * 1024, -1)).toMatchObject({
      title: '正在下载 1.3.26',
      percent: null,
      percentLabel: '',
      sizeLabel: '已下载 12.3 MB'
    });
  });

  it('does not show app update download progress above 100 percent', () => {
    expect(formatAppUpdateDownloadProgress('1.3.26', 120, 100)).toMatchObject({
      percent: 100,
      percentLabel: '100%'
    });
  });

  it('loads the latest GitHub release with the pinned API version', async () => {
    const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(
      url === GITHUB_LATEST_RELEASE_URL ? release(newerTag) : manifest()
    )));

    expect(await checkGithubAppUpdate(fetcher as unknown as typeof fetch, '1.3.6')).toMatchObject({
      version: newerVersion,
      apkUrl: releaseApkUrl(newerTag),
      sha256: apkSha256
    });
    expect(fetcher).toHaveBeenCalledWith(GITHUB_LATEST_RELEASE_URL, expect.objectContaining({
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      signal: expect.any(AbortSignal)
    }));
    expect(fetcher).toHaveBeenCalledWith(releaseManifestUrl(newerTag), expect.objectContaining({
      headers: {
        Accept: 'application/json'
      },
      signal: expect.any(AbortSignal)
    }));
  });

  it('does not install a downloaded APK when inspection does not match the manifest', async () => {
    const installer = {
      inspectApk: vi.fn(async () => ({
        ...manifest(),
        sha256: 'c'.repeat(64)
      })),
      installApk: vi.fn()
    };
    const update = getAppUpdateFromRelease('1.3.6', release(newerTag), manifest());

    await expect(installVerifiedApk(installer, 'file:///cache/wz.apk', update!)).rejects.toThrow('APK 文件校验失败');

    expect(installer.installApk).not.toHaveBeenCalled();
  });

  it('installs a downloaded APK only after inspection matches the manifest', async () => {
    const installer = {
      inspectApk: vi.fn(async () => manifest()),
      installApk: vi.fn(async () => true)
    };
    const update = getAppUpdateFromRelease('1.3.6', release(newerTag), manifest());

    await expect(installVerifiedApk(installer, 'file:///cache/wz.apk', update!)).resolves.toBe(true);

    expect(installer.installApk).toHaveBeenCalledWith('file:///cache/wz.apk');
  });
});
