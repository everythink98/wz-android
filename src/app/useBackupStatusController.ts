import { useCallback, useEffect, useRef, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as SecureStore from 'expo-secure-store';
import { getFeed } from '../forumApi';
import type { ReaderData } from '../readerData';
import { exportReaderBackupJson, importReaderBackupJson } from '../readerBackup';
import {
  errorMessage,
  finishAbortableRequest,
  isCanceledRequest,
  startAbortableRequest
} from '../appUtils';
import { checkYaohuoLoginDirect } from '../yaohuoApi';
import { buildYaohuoSetCookieHeaders, summarizeYaohuoCookies, type YaohuoNativeCookie } from '../yaohuoCookies';
import {
  clearLinuxDoAccess,
  linuxDoAccessSummary,
  loadLinuxDoAccess,
  parseLinuxDoDocumentCookie,
  summarizeLinuxDoCookies
} from '../linuxdoCookieBridge';
import { checkLinuxDoLoginAccess } from '../linuxdoActionClient';
import { buildLocalStatusResult } from '../statusLogic';
import { safeFileName } from '../backupFiles';
import { createRequestOwner, isCurrentOwnedRequest, startOwnedRequest } from '../requestOwnership';
import type { ScopedSiteSessionEvent } from '../siteSessionState';
import type { Fetcher } from '../request';
import type { FeedSource, Source } from '../types';
import type { HealthDetail } from '../appTypes';

const YAOHUO_COOKIE_STORAGE_KEY = 'yaohuo-cookie-header';

function yaohuoCookieMapFromHeader(cookieHeader: string) {
  const cookies: Record<string, YaohuoNativeCookie> = {};
  for (const setCookieHeader of buildYaohuoSetCookieHeaders(cookieHeader)) {
    const cookiePart = setCookieHeader.split(';', 1)[0] || '';
    const separatorIndex = cookiePart.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const name = cookiePart.slice(0, separatorIndex).trim();
    const value = cookiePart.slice(separatorIndex + 1).trim();
    if (name && value) {
      cookies[name] = { name, value, domain: 'yaohuo.me' };
    }
  }
  return cookies;
}

export function useBackupStatusController({
  clearYaohuoLoginState,
  fetcher,
  linuxDoUserAgentRef,
  loadNodeSeekCookieForSource,
  nodeSeekUserAgentRef,
  notify,
  queryClient,
  readerDataRef,
  replaceReaderData,
  resetLinuxDoLevelState,
  dispatchSiteSessionEvent,
  waitForReaderDataSave
}: {
  clearYaohuoLoginState: () => Promise<void>;
  dispatchSiteSessionEvent: (event: ScopedSiteSessionEvent) => void;
  fetcher: Fetcher;
  linuxDoUserAgentRef: { current: string };
  loadNodeSeekCookieForSource: (source: FeedSource | Source) => Promise<string | undefined>;
  nodeSeekUserAgentRef: { current: string };
  notify: (message: string) => void;
  queryClient: QueryClient;
  readerDataRef: { current: ReaderData };
  replaceReaderData: (nextValue: ReaderData) => Promise<void>;
  resetLinuxDoLevelState: () => void;
  waitForReaderDataSave: () => Promise<void>;
}) {
  const backupRequestIdRef = useRef(0);
  const backupRequestOwnerRef = useRef(createRequestOwner('backup'));
  const backupAbortRef = useRef<AbortController | null>(null);
  const backupBusyRef = useRef(false);
  const statusRequestIdRef = useRef(0);
  const statusRequestOwnerRef = useRef(createRequestOwner('status'));
  const statusAbortRef = useRef<AbortController | null>(null);
  const statusBusyRef = useRef(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [backupJson, setBackupJson] = useState('');
  const [healthSummary, setHealthSummary] = useState('');
  const [healthDetails, setHealthDetails] = useState<HealthDetail[]>([]);

  const importBackup = useCallback(async () => {
    if (backupBusyRef.current) {
      return;
    }
    backupBusyRef.current = true;
    const requestId = ++backupRequestIdRef.current;
    const requestOwner = startOwnedRequest(backupRequestOwnerRef, 'backup:import-text');
    const isCurrentBackupRequest = () => isCurrentOwnedRequest(requestOwner, backupRequestOwnerRef) && requestId === backupRequestIdRef.current;
    const controller = startAbortableRequest(backupAbortRef);
    setBackupBusy(true);
    try {
      await waitForReaderDataSave();
      if (!isCurrentBackupRequest() || controller.signal.aborted) {
        return;
      }
      if (!backupJson.trim()) {
        notify('请先粘贴备份 JSON');
        return;
      }
      const merged = importReaderBackupJson(readerDataRef.current, backupJson);
      if (!isCurrentBackupRequest() || controller.signal.aborted) {
        return;
      }
      await replaceReaderData(merged);
      if (!isCurrentBackupRequest() || controller.signal.aborted) {
        return;
      }
      notify('备份已恢复，本机资料已合并');
    } catch (error) {
      if (isCurrentBackupRequest() && !controller.signal.aborted && !isCanceledRequest(error)) {
        notify(errorMessage(error));
      }
    } finally {
      if (finishAbortableRequest(backupAbortRef, controller)) {
        backupBusyRef.current = false;
        setBackupBusy(false);
      }
    }
  }, [backupJson, notify, readerDataRef, replaceReaderData, waitForReaderDataSave]);

  const exportBackup = useCallback(async () => {
    if (backupBusyRef.current) {
      return;
    }
    backupBusyRef.current = true;
    const requestId = ++backupRequestIdRef.current;
    const requestOwner = startOwnedRequest(backupRequestOwnerRef, 'backup:export-text');
    const isCurrentBackupRequest = () => isCurrentOwnedRequest(requestOwner, backupRequestOwnerRef) && requestId === backupRequestIdRef.current;
    const controller = startAbortableRequest(backupAbortRef);
    setBackupBusy(true);
    try {
      await waitForReaderDataSave();
      if (!isCurrentBackupRequest() || controller.signal.aborted) {
        return;
      }
      setBackupJson(exportReaderBackupJson(readerDataRef.current));
      notify('备份 JSON 已生成');
    } catch (error) {
      if (isCurrentBackupRequest() && !controller.signal.aborted && !isCanceledRequest(error)) {
        notify(errorMessage(error));
      }
    } finally {
      if (finishAbortableRequest(backupAbortRef, controller)) {
        backupBusyRef.current = false;
        setBackupBusy(false);
      }
    }
  }, [notify, readerDataRef, waitForReaderDataSave]);

  const shareTextFile = useCallback(async (fileName: string, content: string, mimeType: string) => {
    const baseDirectory = FileSystem.cacheDirectory || FileSystem.documentDirectory;
    if (!baseDirectory) {
      await Clipboard.setStringAsync(content);
      notify('内容已复制');
      return;
    }
    const uri = `${baseDirectory}${fileName}`;
    const shouldDeleteFile = baseDirectory === FileSystem.cacheDirectory;
    try {
      await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType });
      } else {
        await Clipboard.setStringAsync(content);
        notify('内容已复制');
      }
    } finally {
      if (shouldDeleteFile) {
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
      }
    }
  }, [notify]);

  const exportBackupFile = useCallback(async () => {
    if (backupBusyRef.current) {
      return;
    }
    backupBusyRef.current = true;
    const requestId = ++backupRequestIdRef.current;
    const requestOwner = startOwnedRequest(backupRequestOwnerRef, 'backup:export-file');
    const isCurrentBackupRequest = () => isCurrentOwnedRequest(requestOwner, backupRequestOwnerRef) && requestId === backupRequestIdRef.current;
    setBackupBusy(true);
    try {
      await waitForReaderDataSave();
      if (!isCurrentBackupRequest()) {
        return;
      }
      const content = exportReaderBackupJson(readerDataRef.current);
      setBackupJson(content);
      await shareTextFile(safeFileName('forum-reader-backup', 'json'), content, 'application/json');
      if (!isCurrentBackupRequest()) {
        return;
      }
      notify('备份文件已生成');
    } catch (error) {
      if (isCurrentBackupRequest()) {
        notify(errorMessage(error));
      }
    } finally {
      if (isCurrentBackupRequest()) {
        backupBusyRef.current = false;
        setBackupBusy(false);
      }
    }
  }, [notify, readerDataRef, shareTextFile, waitForReaderDataSave]);

  const importBackupFile = useCallback(async () => {
    if (backupBusyRef.current) {
      return;
    }
    backupBusyRef.current = true;
    const requestId = ++backupRequestIdRef.current;
    const requestOwner = startOwnedRequest(backupRequestOwnerRef, 'backup:import-file');
    const isCurrentBackupRequest = () => isCurrentOwnedRequest(requestOwner, backupRequestOwnerRef) && requestId === backupRequestIdRef.current;
    setBackupBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        type: ['application/json', 'text/json', '*/*']
      });
      if (!isCurrentBackupRequest()) {
        return;
      }
      if (result.canceled || !result.assets?.[0]?.uri) {
        return;
      }
      const pickedUri = result.assets[0].uri;
      try {
        const content = await FileSystem.readAsStringAsync(pickedUri, { encoding: FileSystem.EncodingType.UTF8 });
        if (!isCurrentBackupRequest()) {
          return;
        }
        setBackupJson(content);
        const merged = importReaderBackupJson(readerDataRef.current, content);
        if (!isCurrentBackupRequest()) {
          return;
        }
        await replaceReaderData(merged);
        if (!isCurrentBackupRequest()) {
          return;
        }
        notify('备份已恢复，本机资料已合并');
      } finally {
        if (FileSystem.cacheDirectory && pickedUri.startsWith(FileSystem.cacheDirectory)) {
          await FileSystem.deleteAsync(pickedUri, { idempotent: true }).catch(() => undefined);
        }
      }
    } catch (error) {
      if (isCurrentBackupRequest()) {
        notify(errorMessage(error));
      }
    } finally {
      if (isCurrentBackupRequest()) {
        backupBusyRef.current = false;
        setBackupBusy(false);
      }
    }
  }, [notify, readerDataRef, replaceReaderData]);

  const checkLocalStatus = useCallback(async () => {
    if (statusBusyRef.current) {
      return;
    }
    statusBusyRef.current = true;
    const requestId = ++statusRequestIdRef.current;
    const requestOwner = startOwnedRequest(statusRequestOwnerRef, 'status:local');
    const isCurrentStatusRequest = () => isCurrentOwnedRequest(requestOwner, statusRequestOwnerRef) && requestId === statusRequestIdRef.current;
    const controller = startAbortableRequest(statusAbortRef);
    setStatusBusy(true);
    try {
      const yaohuoCookie = await SecureStore.getItemAsync(YAOHUO_COOKIE_STORAGE_KEY);
      const nodeSeekCookie = await loadNodeSeekCookieForSource('nodeseek');
      let linuxDoAccess = await loadLinuxDoAccess();
      let access = linuxDoAccessSummary(linuxDoAccess);
      const linuxDoLoginPromise = linuxDoAccess?.cookieHeader && access.loggedIn
        ? checkLinuxDoLoginAccess({
          cookieHeader: linuxDoAccess.cookieHeader,
          userAgent: linuxDoAccess.userAgent || linuxDoUserAgentRef.current,
          signal: controller.signal
        })
        : Promise.resolve(undefined);
      const yaohuoStatusPromise = yaohuoCookie
        ? checkYaohuoLoginDirect({ yaohuoCookie, signal: controller.signal })
        : Promise.resolve({ ok: false, loginRequired: true, message: '未登录' });
      const checks = await queryClient.fetchQuery({
        queryKey: ['android-status', requestId],
        queryFn: async () => Promise.allSettled([
          getFeed({
            source: 'nodeseek',
            limit: 1,
            nocache: true,
            fetcher,
            nodeSeekCookie,
            nodeSeekUserAgent: nodeSeekUserAgentRef.current,
            signal: controller.signal
          }),
          getFeed({ source: 'v2ex', limit: 1, nocache: true, signal: controller.signal }),
          getFeed({ source: 'linuxdo', limit: 1, nocache: true, signal: controller.signal }),
          yaohuoStatusPromise,
          linuxDoLoginPromise
        ] as const)
      });
      if (!isCurrentStatusRequest() || controller.signal.aborted) {
        return;
      }
      const yaohuoCheck = checks[3];
      const yaohuoOk = yaohuoCheck.status === 'fulfilled' && yaohuoCheck.value.ok && !yaohuoCheck.value.loginRequired;
      const yaohuoMessage = yaohuoCheck.status === 'fulfilled'
        ? (yaohuoOk ? '登录可用' : yaohuoCheck.value.message || '未登录')
        : errorMessage(yaohuoCheck.reason);
      const linuxDoLogin = checks[4].status === 'fulfilled' ? checks[4].value : undefined;
      if (linuxDoLogin?.loginRequired) {
        linuxDoAccess = await clearLinuxDoAccess();
        if (!isCurrentStatusRequest() || controller.signal.aborted) {
          return;
        }
        access = linuxDoAccessSummary(linuxDoAccess);
        resetLinuxDoLevelState();
      }
      const result = buildLocalStatusResult({
        sourceChecks: {
          nodeseek: {
            ok: checks[0].status === 'fulfilled',
            message: checks[0].status === 'fulfilled' ? '列表可读取' : errorMessage(checks[0].reason)
          },
          v2ex: {
            ok: checks[1].status === 'fulfilled',
            message: checks[1].status === 'fulfilled' ? '列表可读取' : errorMessage(checks[1].reason)
          },
          linuxdo: {
            ok: checks[2].status === 'fulfilled',
            message: checks[2].status === 'fulfilled' ? '列表可读取' : errorMessage(checks[2].reason)
          },
          yaohuo: {
            ok: yaohuoOk,
            message: yaohuoMessage
          }
        },
        linuxDoAccess: access,
        linuxDoLogin
      });
      const yaohuoExpired = yaohuoCheck.status === 'fulfilled' && 'reason' in yaohuoCheck.value && yaohuoCheck.value.reason === 'expired';
      if (yaohuoExpired) {
        await clearYaohuoLoginState();
        if (!isCurrentStatusRequest() || controller.signal.aborted) {
          return;
        }
      }
      const yaohuoSummary = summarizeYaohuoCookies(yaohuoCookieMapFromHeader(yaohuoCookie || ''));
      dispatchSiteSessionEvent(yaohuoExpired
        ? { site: 'yaohuo', type: 'login-expired', message: '妖火登录已失效' }
        : {
          site: 'yaohuo',
          type: 'cookie-loaded',
          cookieSummary: yaohuoSummary.names,
          hasVerification: false,
          loggedIn: result.hasYaohuoLogin,
          at: new Date().toISOString()
        });
      dispatchSiteSessionEvent({
        site: 'linuxdo',
        type: 'cookie-loaded',
        cookieSummary: summarizeLinuxDoCookies(parseLinuxDoDocumentCookie(linuxDoAccess?.cookieHeader || '')).names,
        hasVerification: result.hasLinuxDoClearance,
        loggedIn: result.hasLinuxDoLogin,
        at: new Date().toISOString()
      });
      setHealthDetails(result.details);
      setHealthSummary(result.summary);
      notify('状态已更新');
    } catch (error) {
      if (isCurrentStatusRequest() && !controller.signal.aborted && !isCanceledRequest(error)) {
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
    dispatchSiteSessionEvent,
    fetcher,
    linuxDoUserAgentRef,
    loadNodeSeekCookieForSource,
    nodeSeekUserAgentRef,
    notify,
    queryClient,
    resetLinuxDoLevelState
  ]);

  const abortBackupStatusRequests = useCallback(() => {
    backupAbortRef.current?.abort();
    statusAbortRef.current?.abort();
  }, []);

  useEffect(() => abortBackupStatusRequests, [abortBackupStatusRequests]);

  return {
    abortBackupStatusRequests,
    backupBusy,
    backupJson,
    checkLocalStatus,
    exportBackup,
    exportBackupFile,
    healthDetails,
    healthSummary,
    importBackup,
    importBackupFile,
    setBackupJson,
    statusBusy
  };
}
