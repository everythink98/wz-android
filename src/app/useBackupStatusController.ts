import { useCallback, useEffect, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as SecureStore from 'expo-secure-store';
import { checkLinuxDoLoginAccess, checkYaohuoLoginDirect } from '../sources/sourceGateway';
import type { ReaderData } from '../readerData';
import { exportReaderBackupJson, importReaderBackupJson } from '../readerBackup';
import {
  errorMessage,
  finishAbortableRequest,
  isCanceledRequest,
  startAbortableRequest
} from '../appUtils';
import { summarizeYaohuoCookies, yaohuoCookieMapFromHeader } from '../yaohuoCookies';
import {
  clearLinuxDoAccess,
  linuxDoAccessSummary,
  loadLinuxDoAccess,
  parseLinuxDoDocumentCookie,
  summarizeLinuxDoCookies
} from '../linuxdoCookieBridge';
import { safeFileName } from '../backupFiles';
import type { ScopedSiteSessionEvent } from '../siteSessionState';
import type { FeedSource, Source } from '../types';

const YAOHUO_COOKIE_STORAGE_KEY = 'yaohuo-cookie-header';

export function useBackupStatusController({
  clearYaohuoLoginState,
  linuxDoUserAgentRef,
  loadNodeSeekCookieForSource,
  notify,
  readerDataRef,
  replaceReaderData,
  resetLinuxDoLevelState,
  dispatchSiteSessionEvent,
  waitForReaderDataSave
}: {
  clearYaohuoLoginState: () => Promise<void>;
  dispatchSiteSessionEvent: (event: ScopedSiteSessionEvent) => void;
  linuxDoUserAgentRef: { current: string };
  loadNodeSeekCookieForSource: (source: FeedSource | Source) => Promise<string | undefined>;
  notify: (message: string) => void;
  readerDataRef: { current: ReaderData };
  replaceReaderData: (nextValue: ReaderData) => Promise<void>;
  resetLinuxDoLevelState: () => void;
  waitForReaderDataSave: () => Promise<void>;
}) {
  const backupBusyRef = useRef(false);
  const statusAbortRef = useRef<AbortController | null>(null);
  const statusBusyRef = useRef(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [backupJson, setBackupJson] = useState('');

  const importBackup = useCallback(async () => {
    if (backupBusyRef.current) {
      return;
    }
    backupBusyRef.current = true;
    setBackupBusy(true);
    try {
      await waitForReaderDataSave();
      if (!backupJson.trim()) {
        notify('请先粘贴备份 JSON');
        return;
      }
      const merged = importReaderBackupJson(readerDataRef.current, backupJson);
      await replaceReaderData(merged);
      notify('备份已恢复，本机资料已合并');
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      backupBusyRef.current = false;
      setBackupBusy(false);
    }
  }, [backupJson, notify, readerDataRef, replaceReaderData, waitForReaderDataSave]);

  const exportBackup = useCallback(async () => {
    if (backupBusyRef.current) {
      return;
    }
    backupBusyRef.current = true;
    setBackupBusy(true);
    try {
      await waitForReaderDataSave();
      setBackupJson(exportReaderBackupJson(readerDataRef.current));
      notify('备份 JSON 已生成');
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      backupBusyRef.current = false;
      setBackupBusy(false);
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
    setBackupBusy(true);
    try {
      await waitForReaderDataSave();
      const content = exportReaderBackupJson(readerDataRef.current);
      setBackupJson(content);
      await shareTextFile(safeFileName('forum-reader-backup', 'json'), content, 'application/json');
      notify('备份文件已生成');
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      backupBusyRef.current = false;
      setBackupBusy(false);
    }
  }, [notify, readerDataRef, shareTextFile, waitForReaderDataSave]);

  const importBackupFile = useCallback(async () => {
    if (backupBusyRef.current) {
      return;
    }
    backupBusyRef.current = true;
    setBackupBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        type: ['application/json', 'text/json', '*/*']
      });
      if (result.canceled || !result.assets?.[0]?.uri) {
        return;
      }
      const pickedUri = result.assets[0].uri;
      try {
        const content = await FileSystem.readAsStringAsync(pickedUri, { encoding: FileSystem.EncodingType.UTF8 });
        setBackupJson(content);
        const merged = importReaderBackupJson(readerDataRef.current, content);
        await replaceReaderData(merged);
        notify('备份已恢复，本机资料已合并');
      } finally {
        if (FileSystem.cacheDirectory && pickedUri.startsWith(FileSystem.cacheDirectory)) {
          await FileSystem.deleteAsync(pickedUri, { idempotent: true }).catch(() => undefined);
        }
      }
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      backupBusyRef.current = false;
      setBackupBusy(false);
    }
  }, [notify, readerDataRef, replaceReaderData]);

  const refreshAccountStatus = useCallback(async () => {
    if (statusBusyRef.current) {
      return;
    }
    statusBusyRef.current = true;
    const controller = startAbortableRequest(statusAbortRef);
    setStatusBusy(true);
    try {
      const yaohuoCookie = await SecureStore.getItemAsync(YAOHUO_COOKIE_STORAGE_KEY);
      await loadNodeSeekCookieForSource('nodeseek');
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
      const [yaohuoCheck, linuxDoLoginCheck] = await Promise.allSettled([yaohuoStatusPromise, linuxDoLoginPromise] as const);
      if (controller.signal.aborted) {
        return;
      }
      const yaohuoOk = yaohuoCheck.status === 'fulfilled' && yaohuoCheck.value.ok && !yaohuoCheck.value.loginRequired;
      const linuxDoLogin = linuxDoLoginCheck.status === 'fulfilled' ? linuxDoLoginCheck.value : undefined;
      if (linuxDoLogin?.loginRequired) {
        linuxDoAccess = await clearLinuxDoAccess();
        if (controller.signal.aborted) {
          return;
        }
        access = linuxDoAccessSummary(linuxDoAccess);
        resetLinuxDoLevelState();
      }
      const yaohuoExpired = yaohuoCheck.status === 'fulfilled' && 'reason' in yaohuoCheck.value && yaohuoCheck.value.reason === 'expired';
      if (yaohuoExpired) {
        await clearYaohuoLoginState();
        if (controller.signal.aborted) {
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
          loggedIn: yaohuoOk,
          at: new Date().toISOString()
        });
      const hasLinuxDoLogin = access.loggedIn && (!linuxDoLogin || linuxDoLogin.ok || !linuxDoLogin.loginRequired);
      dispatchSiteSessionEvent({
        site: 'linuxdo',
        type: 'cookie-loaded',
        cookieSummary: summarizeLinuxDoCookies(parseLinuxDoDocumentCookie(linuxDoAccess?.cookieHeader || '')).names,
        hasVerification: access.hasClearance,
        loggedIn: hasLinuxDoLogin,
        at: new Date().toISOString()
      });
      notify('账号状态已刷新');
    } catch (error) {
      if (!controller.signal.aborted && !isCanceledRequest(error)) {
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
    linuxDoUserAgentRef,
    loadNodeSeekCookieForSource,
    notify,
    resetLinuxDoLevelState
  ]);

  const abortBackupStatusRequests = useCallback(() => {
    statusAbortRef.current?.abort();
  }, []);

  useEffect(() => abortBackupStatusRequests, [abortBackupStatusRequests]);

  return {
    abortBackupStatusRequests,
    backupBusy,
    backupJson,
    exportBackup,
    exportBackupFile,
    importBackup,
    importBackupFile,
    refreshAccountStatus,
    setBackupJson,
    statusBusy
  };
}
