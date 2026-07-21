import AsyncStorage from '@react-native-async-storage/async-storage';
import { parse } from 'node-html-parser';
import { isCloudflareChallengeResponse } from './cloudflareChallenge';
import {
  buildDiscourseLevelProfileFromSummary,
  displayDiscourseLevelChange,
  type DiscourseActivityStats,
  type DiscourseLevelProfile,
  type DiscourseLevelRequirement,
  type DiscourseSummaryInput
} from './discourseLevel';
import { fetchWithTimeout, REQUEST_CANCELED_MESSAGE, type Fetcher } from './request';

const BASE_URL = 'https://linux.do';
const CONNECT_URL = 'https://connect.linux.do/';
const SNAPSHOT_KEY_PREFIX = 'linuxdo-level-snapshot:';

export type LinuxDoLevelRequirement = DiscourseLevelRequirement;
export type LinuxDoActivityStats = DiscourseActivityStats;
export type LinuxDoLevelProfile = DiscourseLevelProfile;
type LinuxDoSummaryInput = DiscourseSummaryInput;
export const buildLinuxDoLevelProfileFromSummary = buildDiscourseLevelProfileFromSummary;
type LinuxDoSnapshot = {
  username: string;
  values: Partial<Record<LinuxDoLevelRequirement['key'], number>>;
};
type LinuxDoCurrentUser = {
  username: string;
  user: Record<string, unknown>;
};
type LinuxDoRequestOptions = {
  cookieHeader: string;
  userAgent?: string;
  fetcher: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function trustLevelFromRecord(value: Record<string, unknown>) {
  const raw = value.trust_level ?? value.trustLevel;
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const level = Number(raw);
  if (!Number.isFinite(level) || level < 0) {
    return null;
  }
  return Math.floor(level);
}

function noteForOfficialConnect(level: number) {
  if (level >= 4) {
    return '官方 Connect 页面读取到的当前状态；4 级通常仍由人工授予。';
  }
  return '官方 Connect 页面读取到的信任等级进度。';
}

function snapshotValues(profile: LinuxDoLevelProfile) {
  return Object.fromEntries(profile.requirements.map((item) => [item.key, item.current])) as LinuxDoSnapshot['values'];
}

function parseCssNumber(style: string, name: string) {
  const match = new RegExp(`${name}:\\s*([0-9.]+)`).exec(style);
  return match ? numberValue(match[1]) : 0;
}

function parseFirstNumber(value: string) {
  const match = value.replace(/[,，\s]/g, '').match(/-?\d+/);
  return match ? numberValue(match[0]) : 0;
}

function parseCurrentAndRequired(text: string, fallbackCurrent: number, fallbackRequired: number) {
  const cleaned = text.replace(/[,，]/g, '');
  const numbers = cleaned.match(/-?\d+(?:\.\d+)?/g)?.map((item) => numberValue(item)) || [];
  if (numbers.length >= 2) {
    return {
      current: numbers[0],
      required: numbers[1]
    };
  }
  return {
    current: numbers[0] ?? fallbackCurrent,
    required: fallbackRequired
  };
}

function toConnectRequirement(label: string, current: number, required: number, met: boolean): LinuxDoLevelRequirement {
  return {
    key: `connect:${label}`,
    label,
    current,
    required,
    met,
    ratio: required > 0 ? Math.min(current / required, 1) : met ? 1 : 0,
    displayCurrent: String(current),
    displayRequired: required > 0 ? String(required) : met ? '已通过' : '需为 0'
  };
}

function parseLinuxDoConnectProgress(html: string, summaryProfile: LinuxDoLevelProfile): LinuxDoLevelProfile {
  const document = parse(String(html || ''), {
    blockTextElements: {
      script: true,
      noscript: true,
      style: true,
      pre: true
    }
  });
  const card = document.querySelector('div.card');
  if (!card) {
    throw new Error('Connect 未返回等级进度');
  }
  const requirements: LinuxDoLevelRequirement[] = [];
  for (const item of card.querySelectorAll('.tl3-ring')) {
    const label = item.querySelector('.tl3-ring-label')?.text.trim();
    const circle = item.querySelector('.tl3-ring-circle');
    if (!label || !circle) {
      continue;
    }
    const style = circle.getAttribute('style') || '';
    const current = parseCssNumber(style, '--val');
    const required = parseCssNumber(style, '--max');
    const met = circle.classNames.split(/\s+/).includes('met') || (required > 0 && current >= required);
    requirements.push(toConnectRequirement(label, current, required, met));
  }
  for (const item of card.querySelectorAll('.tl3-bar-item')) {
    const label = item.querySelector('.tl3-bar-label')?.text.trim();
    const fill = item.querySelector('.tl3-bar-fill');
    if (!label || !fill) {
      continue;
    }
    const style = fill.getAttribute('style') || '';
    const fallbackCurrent = parseCssNumber(style, '--val');
    const fallbackRequired = parseCssNumber(style, '--max');
    const parsed = parseCurrentAndRequired(item.querySelector('.tl3-bar-nums')?.text.trim() || '', fallbackCurrent, fallbackRequired);
    const met = fill.classNames.split(/\s+/).includes('met') || (parsed.required > 0 && parsed.current >= parsed.required);
    requirements.push(toConnectRequirement(label, parsed.current, parsed.required, met));
  }
  for (const item of card.querySelectorAll('.tl3-quota-card')) {
    const label = item.querySelector('.tl3-quota-label')?.text.trim();
    if (!label) {
      continue;
    }
    const value = item.querySelector('.tl3-quota-nums')?.text.trim() || '';
    const current = parseFirstNumber(value);
    const met = !item.classNames.split(/\s+/).includes('unmet');
    requirements.push(toConnectRequirement(label, current, 5, met));
  }
  for (const item of card.querySelectorAll('.tl3-veto-item')) {
    const met = !item.classNames.split(/\s+/).includes('unmet');
    const face = met ? item.querySelector('.tl3-veto-front') || item : item.querySelector('.tl3-veto-back') || item;
    const label = face.querySelector('.tl3-veto-label')?.text.trim();
    if (!label) {
      continue;
    }
    const current = parseFirstNumber(face.querySelector('.tl3-veto-value')?.text.trim() || '');
    requirements.push(toConnectRequirement(label, current, 0, met));
  }
  if (!requirements.length) {
    throw new Error('Connect 未返回等级进度');
  }
  const achievedCount = requirements.filter((item) => item.met).length;
  return {
    ...summaryProfile,
    source: 'connect',
    estimate: false,
    note: noteForOfficialConnect(summaryProfile.currentLevel),
    requirements,
    achievedCount,
    totalCount: requirements.length,
    fetchedAt: new Date().toISOString()
  };
}

async function loadSnapshot(username: string): Promise<LinuxDoSnapshot | null> {
  const raw = await AsyncStorage.getItem(`${SNAPSHOT_KEY_PREFIX}${username}`);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) && isRecord(parsed.values) ? parsed as LinuxDoSnapshot : null;
  } catch {
    return null;
  }
}

async function saveSnapshot(profile: LinuxDoLevelProfile) {
  const snapshot: LinuxDoSnapshot = {
    username: profile.username,
    values: snapshotValues(profile)
  };
  await AsyncStorage.setItem(`${SNAPSHOT_KEY_PREFIX}${profile.username}`, JSON.stringify(snapshot));
}

function withSnapshotChange(profile: LinuxDoLevelProfile, snapshot: LinuxDoSnapshot | null): LinuxDoLevelProfile {
  if (!snapshot?.values) {
    return profile;
  }
  return {
    ...profile,
    requirements: profile.requirements.map((item) => {
      const previous = snapshot.values[item.key];
      if (typeof previous !== 'number') {
        return item;
      }
      const change = item.current - previous;
      return { ...item, change, displayChange: displayDiscourseLevelChange(change, item.unit) };
    })
  };
}

function normalizeSummaryPayload(data: unknown) {
  if (!isRecord(data)) {
    throw new Error('linux.do 等级数据格式不正确');
  }
  const summary = isRecord(data.user_summary) ? data.user_summary : data;
  const user = isRecord(summary.user) ? summary.user : isRecord(data.user) ? data.user : {};
  return {
    ...summary,
    user,
    username: summary.username || user.username
  } as LinuxDoSummaryInput;
}

function linuxDoCloudflareError() {
  const error = new Error('linux.do 需要完成 Cloudflare 验证');
  Object.assign(error, {
    source: 'linuxdo',
    reason: 'cloudflare'
  });
  return error;
}

async function fetchLinuxDoJson(path: string, options: LinuxDoRequestOptions) {
  const response = await fetchWithTimeout(`${BASE_URL}${path}`, {
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Referer: `${BASE_URL}/latest`,
      ...(options.userAgent ? { 'User-Agent': options.userAgent } : {}),
      Cookie: options.cookieHeader
    }
  }, {
    fetcher: options.fetcher,
    signal: options.signal,
    timeoutMs: options.timeoutMs
  });
  const text = await response.text();
  if (isCloudflareChallengeResponse({ status: response.status, headers: response.headers, bodyText: text })) {
    throw linuxDoCloudflareError();
  }
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (!response.ok) {
        throw new Error(`linux.do 等级数据读取失败：HTTP ${response.status}`);
      }
      throw new Error('linux.do 等级数据格式不正确');
    }
  }
  if (!response.ok) {
    throw new Error(`linux.do 等级数据读取失败：HTTP ${response.status}`);
  }
  return data;
}

async function fetchLinuxDoConnectHtml(options: LinuxDoRequestOptions) {
  const response = await fetchWithTimeout(CONNECT_URL, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Referer: BASE_URL,
      ...(options.userAgent ? { 'User-Agent': options.userAgent } : {}),
      Cookie: options.cookieHeader
    }
  }, {
    fetcher: options.fetcher,
    signal: options.signal,
    timeoutMs: options.timeoutMs
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Connect 进度读取失败：HTTP ${response.status}`);
  }
  return text;
}

function usernameFromCurrentUser(data: unknown) {
  if (!isRecord(data)) {
    return null;
  }
  const currentUser = isRecord(data.current_user) ? data.current_user : {};
  const user = isRecord(data.user) ? data.user : {};
  const username = String(currentUser.username || user.username || data.username || '').trim();
  if (!username) {
    return null;
  }
  const sessionUser: Record<string, unknown> = { ...user, ...currentUser, username };
  const sessionTrustLevel = Math.max(trustLevelFromRecord(data) ?? 0, trustLevelFromRecord(user) ?? 0, trustLevelFromRecord(currentUser) ?? 0);
  if (sessionTrustLevel > 0) {
    sessionUser.trust_level = sessionTrustLevel;
  }
  return {
    username,
    user: sessionUser
  };
}

async function fetchCurrentUser(options: LinuxDoRequestOptions) {
  const data = await fetchLinuxDoJson('/session/current.json', options);
  const currentUser = usernameFromCurrentUser(data);
  if (!currentUser) {
    throw new Error('无法读取当前 linux.do 用户名，请重新检测 linux.do 登录状态。');
  }
  return currentUser;
}

function mergeCurrentUser(summary: LinuxDoSummaryInput, currentUser: LinuxDoCurrentUser) {
  const summaryUser = isRecord(summary.user) ? summary.user : {};
  const summaryTrustLevel = Math.max(trustLevelFromRecord(summary) ?? 0, trustLevelFromRecord(summaryUser) ?? 0);
  const sessionTrustLevel = trustLevelFromRecord(currentUser.user) ?? 0;
  const mergedUser: Record<string, unknown> = {
    ...currentUser.user,
    ...summaryUser,
    username: summary.username || summaryUser.username || currentUser.username
  };
  if (sessionTrustLevel > summaryTrustLevel) {
    mergedUser.trust_level = sessionTrustLevel;
  }
  return {
    ...summary,
    username: summary.username || currentUser.username,
    user: mergedUser
  };
}

function hasTrustLevel(summary: LinuxDoSummaryInput) {
  const summaryUser = isRecord(summary.user) ? summary.user : {};
  return trustLevelFromRecord(summary) !== null || trustLevelFromRecord(summaryUser) !== null;
}

function hasUsername(summary: LinuxDoSummaryInput) {
  const summaryUser = isRecord(summary.user) ? summary.user : {};
  return Boolean(String(summary.username || summaryUser.username || '').trim());
}

export async function getLinuxDoLevelProfile({
  cookieHeader,
  userAgent,
  fetcher = fetch,
  signal,
  timeoutMs
}: {
  cookieHeader: string;
  userAgent?: string;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  const assertNotAborted = () => {
    if (signal?.aborted) {
      throw new Error(REQUEST_CANCELED_MESSAGE);
    }
  };
  const throwIfCanceled = (error: unknown) => {
    assertNotAborted();
    if (error instanceof Error && error.message === REQUEST_CANCELED_MESSAGE) {
      throw error;
    }
  };
  assertNotAborted();
  const cleanCookie = cookieHeader.trim();
  if (!cleanCookie) {
    throw new Error('请先登录 linux.do');
  }
  const requestOptions: LinuxDoRequestOptions = {
    cookieHeader: cleanCookie,
    userAgent,
    fetcher,
    signal,
    timeoutMs
  };
  let data: unknown;
  let currentUser: LinuxDoCurrentUser | null = null;
  try {
    data = await fetchLinuxDoJson('/my/summary.json', requestOptions);
    assertNotAborted();
  } catch (error) {
    throwIfCanceled(error);
    currentUser = await fetchCurrentUser(requestOptions);
    assertNotAborted();
    data = await fetchLinuxDoJson(`/u/${encodeURIComponent(currentUser.username)}/summary.json`, requestOptions);
    assertNotAborted();
  }
  const summary = normalizeSummaryPayload(data);
  if (!currentUser && (!hasTrustLevel(summary) || !hasUsername(summary))) {
    try {
      currentUser = await fetchCurrentUser(requestOptions);
      assertNotAborted();
    } catch (error) {
      throwIfCanceled(error);
      currentUser = null;
    }
  }
  const profile = buildLinuxDoLevelProfileFromSummary(currentUser ? mergeCurrentUser(summary, currentUser) : summary);
  let nextProfile = profile;
  if (profile.currentLevel >= 2) {
    try {
      const html = await fetchLinuxDoConnectHtml(requestOptions);
      assertNotAborted();
      nextProfile = parseLinuxDoConnectProgress(html, profile);
    } catch (error) {
      throwIfCanceled(error);
      nextProfile = profile;
    }
  }
  assertNotAborted();
  const snapshot = await loadSnapshot(nextProfile.username);
  assertNotAborted();
  const profileWithChange = withSnapshotChange(nextProfile, snapshot);
  await saveSnapshot(nextProfile);
  assertNotAborted();
  return profileWithChange;
}
