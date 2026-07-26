import appConfig from '../app.json';
import packageConfig from '../package.json';
import { fetchWithTimeout, type Fetcher } from './request';

export const UPDATE_APK_NAME = 'app-arm64-v8a-release.apk';
export const UPDATE_MANIFEST_NAME = 'release-manifest.json';
export const GITHUB_LATEST_RELEASE_URL = 'https://api.github.com/repos/everythink98/wz-android/releases/latest';
export const CURRENT_APP_VERSION = String(appConfig.expo.version);
export const CURRENT_ANDROID_PACKAGE = String(appConfig.expo.android.package);
export const CURRENT_ANDROID_VERSION_CODE = Number(appConfig.expo.android.versionCode);
export const CURRENT_EXPO_VERSION = String(packageConfig.dependencies.expo).replace(/^[^\d]*/, '');
export const CURRENT_REACT_NATIVE_VERSION = String(packageConfig.dependencies['react-native']).replace(/^[^\d]*/, '');
const GITHUB_RELEASE_APK_HOST = 'github.com';
const GITHUB_RELEASE_APK_PATH_PREFIX = '/everythink98/wz-android/releases/download/';
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const PINNED_RELEASE_SIGNER_SHA256 = cleanSha256(appConfig.expo.extra.releaseSignerSha256);

export type AppUpdateInfo = {
  version: string;
  apkUrl: string;
  notes: string;
  sha256: string;
  packageName: string;
  versionName: string;
  versionCode: number;
  signerSha256: string;
};

export type ReleaseManifest = {
  apkName: string;
  sha256: string;
  packageName: string;
  versionName: string;
  versionCode: number;
  signerSha256: string;
};

export type ApkInspection = {
  sha256?: unknown;
  packageName?: unknown;
  versionName?: unknown;
  versionCode?: unknown;
  signerSha256?: unknown;
};

export type ApkInstaller = {
  inspectApk?: (uri: string) => Promise<ApkInspection>;
  installApk?: (uri: string) => Promise<boolean>;
};

export type AppUpdateDownloadProgress = {
  title: string;
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  percentLabel: string;
  sizeLabel: string;
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

function isExpectedReleaseAssetUrl(value: string, tagName: string, assetName: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === GITHUB_RELEASE_APK_HOST
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && url.pathname === `${GITHUB_RELEASE_APK_PATH_PREFIX}${tagName.trim()}/${assetName}`;
  } catch {
    return false;
  }
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

function formatDownloadBytes(value: number) {
  const bytes = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${Math.round(bytes)} B`;
}

export function formatAppUpdateDownloadProgress(version: string, downloadedBytes: number, totalBytes: number): AppUpdateDownloadProgress {
  const downloaded = Number.isFinite(downloadedBytes) ? Math.max(0, downloadedBytes) : 0;
  const total = Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : null;
  const percent = total === null ? null : Math.min(100, Math.max(0, Math.round((downloaded / total) * 100)));
  return {
    title: `正在下载 ${version}`,
    downloadedBytes: downloaded,
    totalBytes: total,
    percent,
    percentLabel: percent === null ? '' : `${percent}%`,
    sizeLabel: total === null ? `已下载 ${formatDownloadBytes(downloaded)}` : `${formatDownloadBytes(downloaded)} / ${formatDownloadBytes(total)}`
  };
}

function releaseAssetUrl(release: GitHubRelease, tagName: string, assetName: string) {
  const assets = Array.isArray(release.assets) ? release.assets as GitHubReleaseAsset[] : [];
  const asset = assets.find((item) => item.name === assetName);
  if (typeof asset?.browser_download_url !== 'string') {
    throw new Error(`GitHub Release 未找到 ${assetName}。`);
  }
  if (!isExpectedReleaseAssetUrl(asset.browser_download_url, tagName, assetName)) {
    throw new Error('GitHub Release 下载地址不可信。');
  }
  return asset.browser_download_url;
}

function cleanSha256(value: unknown) {
  return typeof value === 'string' && SHA256_PATTERN.test(value.trim()) ? value.trim().toLowerCase() : null;
}

function parseReleaseManifest(value: unknown, version: string): ReleaseManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Release manifest 格式不正确。');
  }
  const manifest = value as Partial<ReleaseManifest>;
  const sha256 = cleanSha256(manifest.sha256);
  const signerSha256 = cleanSha256(manifest.signerSha256);
  if (
    manifest.apkName !== UPDATE_APK_NAME
    || manifest.packageName !== CURRENT_ANDROID_PACKAGE
    || manifest.versionName !== version
    || typeof manifest.versionCode !== 'number'
    || !Number.isSafeInteger(manifest.versionCode)
    || manifest.versionCode <= CURRENT_ANDROID_VERSION_CODE
    || !sha256
    || !signerSha256
    || signerSha256 !== PINNED_RELEASE_SIGNER_SHA256
  ) {
    throw new Error('Release manifest 内容不可信。');
  }
  return {
    apkName: manifest.apkName,
    sha256,
    packageName: manifest.packageName,
    versionName: manifest.versionName,
    versionCode: manifest.versionCode,
    signerSha256
  };
}

export function getReleaseManifestUrlFromRelease(currentVersion: string, release: GitHubRelease) {
  const version = cleanReleaseVersion(release.tag_name);
  if (!version || typeof release.tag_name !== 'string') {
    throw new Error('GitHub Release 版本格式不正确。');
  }
  if (compareAppVersions(version, currentVersion) <= 0) {
    return null;
  }
  return releaseAssetUrl(release, release.tag_name, UPDATE_MANIFEST_NAME);
}

export function getAppUpdateFromRelease(currentVersion: string, release: GitHubRelease, manifestValue: unknown): AppUpdateInfo | null {
  const version = cleanReleaseVersion(release.tag_name);
  if (!version || typeof release.tag_name !== 'string') {
    throw new Error('GitHub Release 版本格式不正确。');
  }
  if (compareAppVersions(version, currentVersion) <= 0) {
    return null;
  }
  const manifest = parseReleaseManifest(manifestValue, version);
  const apkUrl = releaseAssetUrl(release, release.tag_name, manifest.apkName);
  return {
    version,
    apkUrl,
    notes: typeof release.body === 'string' ? release.body : '',
    sha256: manifest.sha256,
    packageName: manifest.packageName,
    versionName: manifest.versionName,
    versionCode: manifest.versionCode,
    signerSha256: manifest.signerSha256
  };
}

function normalizedInspectionSha(value: unknown) {
  return cleanSha256(value);
}

function assertDownloadedApkMatchesUpdate(update: AppUpdateInfo, inspection: ApkInspection) {
  const sha256 = normalizedInspectionSha(inspection.sha256);
  const signerSha256 = normalizedInspectionSha(inspection.signerSha256);
  const versionCode = typeof inspection.versionCode === 'number' ? inspection.versionCode : Number(inspection.versionCode);
  if (inspection.packageName !== update.packageName) {
    throw new Error('APK 包名不匹配。');
  }
  if (inspection.versionName !== update.versionName || !Number.isSafeInteger(versionCode) || versionCode !== update.versionCode) {
    throw new Error('APK 版本不匹配。');
  }
  if (sha256 !== update.sha256) {
    throw new Error('APK 文件校验失败。');
  }
  if (signerSha256 !== update.signerSha256) {
    throw new Error('APK 签名校验失败。');
  }
}

export async function installVerifiedApk(installer: ApkInstaller | undefined, uri: string, update: AppUpdateInfo) {
  if (!installer?.inspectApk || !installer.installApk) {
    throw new Error('当前安装包不支持打开安装确认。');
  }
  const inspection = await installer.inspectApk(uri);
  assertDownloadedApkMatchesUpdate(update, inspection);
  const opened = await installer.installApk(uri);
  if (!opened) {
    throw new Error('无法打开安装确认，请稍后重试。');
  }
  return true;
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
  const release = await response.json() as GitHubRelease;
  const manifestUrl = getReleaseManifestUrlFromRelease(currentVersion, release);
  if (!manifestUrl) {
    return null;
  }
  const manifestResponse = await fetchWithTimeout(manifestUrl, {
    headers: {
      Accept: 'application/json'
    }
  }, { fetcher });
  if (!manifestResponse.ok) {
    throw new Error(`检查更新失败：HTTP ${manifestResponse.status}`);
  }
  return getAppUpdateFromRelease(currentVersion, release, await manifestResponse.json());
}
