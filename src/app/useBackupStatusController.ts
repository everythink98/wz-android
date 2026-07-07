import { useCallback, useEffect, useRef, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as SecureStore from 'expo-secure-store';
import { checkLinuxDoLoginAccess, checkYaohuoLogin, getCurrentUserProfile } from '../sources/sourceGateway';
import type { ReaderData } from '../readerData';
import { exportReaderBackupJson, importReaderBackupJson } from '../readerBackup';
import {
  errorMessage,
  finishAbortableRequest,
  isCanceledRequest,
  startAbortableRequest
} from '../appUtils';
import { summarizeYaohuoCookies, yaohuoCookieMapFromHeader } from '../yaohuoCookies';
import { parseNodeSeekDocumentCookie, summarizeNodeSeekCookies } from '../nodeseekCookies';
import {
  clearLinuxDoAccessForGeneration,
  currentLinuxDoAccessGeneration,
  linuxDoAccessSummary,
  loadLinuxDoAccess,
  parseLinuxDoDocumentCookie,
  summarizeLinuxDoCookies
} from '../linuxdoCookieBridge';
import { safeFileName } from '../backupFiles';
import { readBackupFileText } from '../backupImportFile';
import { runBackupOperation } from '../backupOperation';
import type { ScopedSiteSessionEvent } from '../siteSessionState';
import type { CredentialClearOptions, CredentialLoadOptions } from './sessionControllerHelpers';
import type { FeedSource, Source } from '../types';
import type { Fetcher } from '../request';
import { isLinuxDoLoginCheckUnknown } from './accountStatusHelpers';

const YAOHUO_COOKIE_STORAGE_KEY = 'yaohuo-cookie-header';
type RefreshAccountStatusOptions = { silent?: boolean };

export function useBackupStatusController({
  clearYaohuoLoginState,
  currentYaohuoCredentialGeneration,
  linuxDoUserAgentRef,
  loadNodeSeekCookieForSource,
  fetcher,
  nodeSeekUserAgentRef,
  notify,
  readerDataRef,
  replaceReaderData,
  resetLinuxDoLevelState,
  saveNodeSeekCookieHeader,
  dispatchSiteSessionEvent,
  waitForReaderDataSave
}: {
  clearYaohuoLoginState: (options?: CredentialClearOptions) => Promise<void>;
  currentYaohuoCredentialGeneration: () => number;
  dispatchSiteSessionEvent: (event: ScopedSiteSessionEvent) => void;
  linuxDoUserAgentRef: { current: string };
  loadNodeSeekCookieForSource: (source: FeedSource | Source, options?: CredentialLoadOptions) => Promise<string | undefined>;
  fetcher: Fetcher;
  nodeSeekUserAgentRef: { current: string };
  notify: (message: string) => void;
  readerDataRef: { current: ReaderData };
  replaceReaderData: (nextValue: ReaderData) => Promise<void>;
  resetLinuxDoLevelState: () => void;
  saveNodeSeekCookieHeader: (
    cookies: Record<string, { name?: string; value?: string; domain?: string }>,
    options?: { generation?: number; userId?: number | null }
  ) => Promise<string>;
  waitForReaderDataSave: () => Promise<void>;
}) {
  const backupBusyRef = useRef(false);
  const statusAbortRef = useRef<AbortController | null>(null);
  const statusBusyRef = useRef(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  const shareTextFile = useCallback(async (fileName: string, content: string, mimeType: string) => {
    const baseDirectory = FileSystem.cacheDirectory || FileSystem.documentDirectory;
    if (!baseDirectory) {
      throw new Error('无法生成备份文件，请检查文件权限。');
    }
    const uri = `${baseDirectory}${fileName}`;
    const shouldDeleteFile = baseDirectory === FileSystem.cacheDirectory;
    try {
      await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType });
      } else {
        throw new Error('当前设备不支持分享备份文件。');
      }
    } finally {
      if (shouldDeleteFile) {
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
      }
    }
  }, []);

  const exportBackupFile = useCallback(async () => {
    await runBackupOperation({
      busyRef: backupBusyRef,
      notify,
      setBusy: setBackupBusy,
      task: async () => {
        await waitForReaderDataSave();
        const content = exportReaderBackupJson(readerDataRef.current);
        await shareTextFile(safeFileName('forum-reader-backup', 'json'), content, 'application/json');
        notify('备份文件已生成');
      }
    });
  }, [notify, readerDataRef, shareTextFile, waitForReaderDataSave]);

  const importBackupFile = useCallback(async () => {
    await runBackupOperation({
      busyRef: backupBusyRef,
      notify,
      setBusy: setBackupBusy,
      task: async () => {
        const result = await DocumentPicker.getDocumentAsync({
          copyToCacheDirectory: true,
          type: ['application/json', 'text/json', '*/*']
        });
        if (result.canceled || !result.assets?.[0]?.uri) {
          return;
        }
        const pickedAsset = result.assets[0];
        const pickedUri = pickedAsset.uri;
        try {
          const content = await readBackupFileText(pickedAsset);
          const merged = importReaderBackupJson(readerDataRef.current, content);
          await replaceReaderData(merged);
          notify('备份已恢复，本机资料已合并');
        } finally {
          if (FileSystem.cacheDirectory && pickedUri.startsWith(FileSystem.cacheDirectory)) {
            await FileSystem.deleteAsync(pickedUri, { idempotent: true }).catch(() => undefined);
          }
        }
      }
    });
  }, [notify, readerDataRef, replaceReaderData]);

  const refreshAccountStatus = useCallback(async (options: RefreshAccountStatusOptions = {}) => {
    if (statusBusyRef.current) {
      return;
    }
    statusBusyRef.current = true;
    const controller = startAbortableRequest(statusAbortRef);
    setStatusBusy(true);
    try {
      const yaohuoGeneration = currentYaohuoCredentialGeneration();
      const linuxDoGeneration = currentLinuxDoAccessGeneration();
      const yaohuoCookie = await SecureStore.getItemAsync(YAOHUO_COOKIE_STORAGE_KEY);
      let nodeSeekGeneration: number | undefined;
      let nodeSeekCredentialUserId: number | null = null;
      const nodeSeekCookie = await loadNodeSeekCookieForSource('nodeseek', {
        captureGeneration: (generation) => { nodeSeekGeneration = generation; },
        captureNodeSeekUserId: (userId) => { nodeSeekCredentialUserId = userId; }
      });
      const nodeSeekSummary = summarizeNodeSeekCookies(parseNodeSeekDocumentCookie(nodeSeekCookie || ''));
      let linuxDoAccess = await loadLinuxDoAccess();
      let access = linuxDoAccessSummary(linuxDoAccess);
      const linuxDoLoginPromise = linuxDoAccess?.cookieHeader && access.loggedIn
        ? checkLinuxDoLoginAccess({
          cookieHeader: linuxDoAccess.cookieHeader,
          fetcher,
          userAgent: linuxDoAccess.userAgent || linuxDoUserAgentRef.current,
          signal: controller.signal
        })
        : Promise.resolve(undefined);
      const nodeSeekCurrentUserPromise = nodeSeekSummary.loggedIn
        ? getCurrentUserProfile({
          source: 'nodeseek',
          fetcher,
          nodeSeekCookie,
          nodeSeekUserId: nodeSeekCredentialUserId,
          nodeSeekUserAgent: nodeSeekUserAgentRef.current,
          signal: controller.signal
        })
        : Promise.resolve(null);
      const linuxDoCurrentUserPromise = linuxDoAccess?.cookieHeader && access.loggedIn
        ? getCurrentUserProfile({
          source: 'linuxdo',
          fetcher,
          linuxDoCookie: linuxDoAccess.cookieHeader,
          linuxDoUserAgent: linuxDoAccess.userAgent || linuxDoUserAgentRef.current,
          signal: controller.signal
        })
        : Promise.resolve(null);
      const yaohuoStatusPromise = yaohuoCookie
        ? checkYaohuoLogin({ yaohuoCookie, yaohuoFetcher: fetcher, signal: controller.signal })
        : Promise.resolve({ ok: false, loginRequired: true, message: '未登录' });
      const yaohuoCurrentUserPromise = yaohuoCookie
        ? yaohuoStatusPromise.then((check) => {
          if (check.ok && !check.loginRequired && 'currentUser' in check && check.currentUser) {
            return check.currentUser;
          }
          if (!check.ok || check.loginRequired) {
            return null;
          }
          return getCurrentUserProfile({
            source: 'yaohuo',
            fetcher,
            yaohuoCookie,
            signal: controller.signal
          });
        })
        : Promise.resolve(null);
      const [yaohuoCheck, linuxDoLoginCheck, nodeSeekCurrentUserCheck, linuxDoCurrentUserCheck, yaohuoCurrentUserCheck] = await Promise.allSettled([
        yaohuoStatusPromise,
        linuxDoLoginPromise,
        nodeSeekCurrentUserPromise,
        linuxDoCurrentUserPromise,
        yaohuoCurrentUserPromise
      ] as const);
      if (controller.signal.aborted) {
        return;
      }
      const failedSites: string[] = [];
      const yaohuoOk = yaohuoCheck.status === 'fulfilled' && yaohuoCheck.value.ok && !yaohuoCheck.value.loginRequired;
      if (nodeSeekSummary.loggedIn && nodeSeekCurrentUserCheck.status === 'rejected') {
        failedSites.push('NodeSeek');
      }
      if (yaohuoOk && yaohuoCurrentUserCheck.status === 'rejected') {
        failedSites.push('妖火');
      }
      const linuxDoLogin = linuxDoLoginCheck.status === 'fulfilled' ? linuxDoLoginCheck.value : undefined;
      if (linuxDoLoginCheck.status === 'rejected') {
        failedSites.push('linux.do');
      }
      if (isLinuxDoLoginCheckUnknown(linuxDoLogin)) {
        failedSites.push('linux.do');
      }
      if (access.loggedIn && !linuxDoLogin?.loginRequired && linuxDoCurrentUserCheck.status === 'rejected') {
        failedSites.push('linux.do');
      }
      if (linuxDoLogin?.loginRequired) {
        linuxDoAccess = await clearLinuxDoAccessForGeneration(linuxDoGeneration, linuxDoAccess?.cookieHeader);
        if (controller.signal.aborted) {
          return;
        }
        access = linuxDoAccessSummary(linuxDoAccess);
        resetLinuxDoLevelState();
      }
      const yaohuoExpired = yaohuoCheck.status === 'fulfilled' && 'reason' in yaohuoCheck.value && yaohuoCheck.value.reason === 'expired';
      if (yaohuoExpired) {
        await clearYaohuoLoginState({ generation: yaohuoGeneration });
        if (controller.signal.aborted) {
          return;
        }
      }
      const checkedAt = new Date().toISOString();
      const nodeSeekCurrentUser = nodeSeekCurrentUserCheck.status === 'fulfilled' ? nodeSeekCurrentUserCheck.value : null;
      dispatchSiteSessionEvent({
        site: 'nodeseek',
        type: 'cookie-loaded',
        cookieSummary: nodeSeekSummary.names,
        hasVerification: nodeSeekSummary.count > 0,
        loggedIn: nodeSeekSummary.loggedIn,
        currentUser: nodeSeekCurrentUser,
        at: checkedAt
      });
      const nodeSeekCurrentUserId = Number(nodeSeekCurrentUser?.id);
      if (nodeSeekCookie && Number.isInteger(nodeSeekCurrentUserId) && nodeSeekCurrentUserId > 0) {
        await saveNodeSeekCookieHeader(parseNodeSeekDocumentCookie(nodeSeekCookie), {
          generation: nodeSeekGeneration,
          userId: nodeSeekCurrentUserId
        });
      }
      if (yaohuoCheck.status === 'rejected') {
        failedSites.push('妖火');
        dispatchSiteSessionEvent({
          site: 'yaohuo',
          type: 'check-failed',
          message: errorMessage(yaohuoCheck.reason),
          at: checkedAt
        });
      } else {
        const yaohuoSummary = summarizeYaohuoCookies(yaohuoCookieMapFromHeader(yaohuoCookie || ''));
        dispatchSiteSessionEvent(yaohuoExpired
          ? { site: 'yaohuo', type: 'login-expired', message: '妖火登录已失效' }
          : {
            site: 'yaohuo',
            type: 'cookie-loaded',
            cookieSummary: yaohuoSummary.names,
            hasVerification: false,
            loggedIn: yaohuoOk,
            currentUser: yaohuoCurrentUserCheck.status === 'fulfilled' ? yaohuoCurrentUserCheck.value : null,
            at: checkedAt
          });
      }
      if (linuxDoLoginCheck.status === 'rejected' || isLinuxDoLoginCheckUnknown(linuxDoLogin)) {
        dispatchSiteSessionEvent({
          site: 'linuxdo',
          type: 'check-failed',
          message: linuxDoLoginCheck.status === 'rejected'
            ? errorMessage(linuxDoLoginCheck.reason)
            : linuxDoLogin?.message || 'linux.do 状态暂时无法确认',
          at: checkedAt
        });
      } else {
        const hasLinuxDoLogin = access.loggedIn && Boolean(linuxDoLogin?.ok);
        dispatchSiteSessionEvent({
          site: 'linuxdo',
          type: 'cookie-loaded',
          cookieSummary: summarizeLinuxDoCookies(parseLinuxDoDocumentCookie(linuxDoAccess?.cookieHeader || '')).names,
          hasVerification: access.hasClearance,
          loggedIn: hasLinuxDoLogin,
          currentUser: linuxDoCurrentUserCheck.status === 'fulfilled' ? linuxDoCurrentUserCheck.value : null,
          at: checkedAt
        });
      }
      const uniqueFailedSites = Array.from(new Set(failedSites));
      if (!options.silent) {
        notify(uniqueFailedSites.length ? `账号状态部分刷新失败：${uniqueFailedSites.join('、')}` : '账号状态已刷新');
      }
    } catch (error) {
      if (!options.silent && !controller.signal.aborted && !isCanceledRequest(error)) {
        notify(errorMessage(error));
      }
    } finally {
      if (finishAbortableRequest(statusAbortRef, controller)) {
        statusBusyRef.current = false;
        setStatusBusy(false);
      }
    }
  }, [
    clearYaohuoLoginState,
    currentYaohuoCredentialGeneration,
    dispatchSiteSessionEvent,
    fetcher,
    linuxDoUserAgentRef,
    loadNodeSeekCookieForSource,
    nodeSeekUserAgentRef,
    notify,
    resetLinuxDoLevelState,
    saveNodeSeekCookieHeader
  ]);

  const abortBackupStatusRequests = useCallback(() => {
    statusAbortRef.current?.abort();
  }, []);

  useEffect(() => abortBackupStatusRequests, [abortBackupStatusRequests]);

  return {
    abortBackupStatusRequests,
    backupBusy,
    exportBackupFile,
    importBackupFile,
    refreshAccountStatus,
    statusBusy
  };
}
