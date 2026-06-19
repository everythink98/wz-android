import appConfig from '../app.json';
import { fetchWithTimeout, type Fetcher } from './request';

export const UPDATE_APK_NAME = 'app-arm64-v8a-release.apk';
export const GITHUB_LATEST_RELEASE_URL = 'https://api.github.com/repos/everythink98/wz-android/releases/latest';
export const CURRENT_APP_VERSION = String(appConfig.expo.version);

export type AppUpdateInfo = {
  version: string;
  apkUrl: string;
  notes: string;
};

type GitHubReleaseAsset = {
  name?: unknown;
  browser_download_url?: unknown;
};

type GitHubRelease = {
  tag_name?: unknown;
  body?: unknown;
  assets?: unknown;
};

function versionParts(value: string) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (!match) {
    return null;
  }
  return match.slice(1).map(Number);
}

function cleanReleaseVersion(tagName: unknown) {
  if (typeof tagName !== 'string') {
    return null;
  }
  if (!/^v\d+\.\d+\.\d+$/.test(tagName.trim())) {
    return null;
  }
  const parts = versionParts(tagName);
  return parts ? parts.join('.') : null;
}

export function compareAppVersions(left: string, right: string) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  if (!leftParts || !rightParts) {
    throw new Error('版本格式不正确。');
  }
  for (let index = 0; index < leftParts.length; index += 1) {
    const diff = leftParts[index] - rightParts[index];
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

export function getAppUpdateFromRelease(currentVersion: string, release: GitHubRelease): AppUpdateInfo | null {
  const version = cleanReleaseVersion(release.tag_name);
  if (!version || typeof release.tag_name !== 'string') {
    throw new Error('GitHub Release 版本格式不正确。');
  }
  if (compareAppVersions(version, currentVersion) <= 0) {
    return null;
  }
  const assets = Array.isArray(release.assets) ? release.assets as GitHubReleaseAsset[] : [];
  const apk = assets.find((asset) => asset.name === UPDATE_APK_NAME);
  if (typeof apk?.browser_download_url !== 'string') {
    throw new Error(`GitHub Release 未找到 ${UPDATE_APK_NAME}。`);
  }
  return {
    version,
    apkUrl: apk.browser_download_url,
    notes: typeof release.body === 'string' ? release.body : ''
  };
}

export async function checkGithubAppUpdate(fetcher: Fetcher = fetch, currentVersion = CURRENT_APP_VERSION) {
  const response = await fetchWithTimeout(GITHUB_LATEST_RELEASE_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  }, { fetcher });
  if (!response.ok) {
    throw new Error(`检查更新失败：HTTP ${response.status}`);
  }
  return getAppUpdateFromRelease(currentVersion, await response.json());
}
