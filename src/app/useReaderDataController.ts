import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../appUtils';
import {
  createEmptyReaderData,
  sanitizeReaderSettings,
  sanitizeReaderData,
  type ReaderData
} from '../readerData';
import { loadReaderData, saveCleanReaderData, saveReaderSettings } from '../readerDataStore';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason,
  type DiagnosticTrace
} from '../diagnostics';

export type ReaderDataMutationReason =
  | 'backup-imported'
  | 'favorite-toggled'
  | 'follow-removed'
  | 'follow-toggled'
  | 'history-cleared'
  | 'history-recorded'
  | 'library-topic-removed'
  | 'settings-updated';

function prepareSettingsOnlyCommit(current: ReaderData, updated: ReaderData) {
  if (
    updated.version !== current.version ||
    updated.favorites !== current.favorites ||
    updated.history !== current.history ||
    updated.followedUsers !== current.followedUsers ||
    updated.deletedRecords !== current.deletedRecords ||
    !updated.settings ||
    typeof updated.settings !== 'object'
  ) {
    return null;
  }
  return {
    ...current,
    settings: sanitizeReaderSettings(updated.settings)
  };
}

function waitForNextSaveTurn() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function isSettingsOnlyCommit(previous: ReaderData, next: ReaderData) {
  return next.version === previous.version
    && next.favorites === previous.favorites
    && next.history === previous.history
    && next.followedUsers === previous.followedUsers
    && next.deletedRecords === previous.deletedRecords;
}

function readerDataRecordCount(value: ReaderData) {
  return Object.keys(value.favorites).length
    + Object.keys(value.history).length
    + Object.keys(value.followedUsers).length;
}

export function prepareReaderDataCommit(
  current: ReaderData,
  updater: (current: ReaderData) => ReaderData,
  mutationReason?: ReaderDataMutationReason
) {
  const updated = updater(current);
  if (updated === current) {
    return null;
  }
  if (mutationReason === 'history-recorded') {
    return updated;
  }
  const settingsOnly = prepareSettingsOnlyCommit(current, updated);
  if (settingsOnly) {
    return settingsOnly;
  }
  return sanitizeReaderData(updated);
}

export function rollbackFailedReaderDataSave(
  latest: ReaderData,
  failed: ReaderData,
  previous: ReaderData,
  lastPersisted = previous
) {
  return latest === failed ? lastPersisted : latest;
}

export async function loadInitialReaderData({
  isActive,
  load = loadReaderData,
  notify,
  onLoadFailed,
  onLoaded
}: {
  isActive: () => boolean;
  load?: () => Promise<ReaderData>;
  notify: (message: string) => void;
  onLoadFailed?: () => void;
  onLoaded: (readerData: ReaderData) => void;
}) {
  const trace = beginDiagnosticTrace('reader-data', 'load');
  try {
    const savedReaderData = await load();
    if (isActive()) {
      markDiagnosticStage(trace, 'apply', {
        count: readerDataRecordCount(savedReaderData),
        state: 'loaded'
      });
      onLoaded(savedReaderData);
      finishDiagnosticTrace(trace, 'success', { count: readerDataRecordCount(savedReaderData) });
    } else {
      finishDiagnosticTrace(trace, 'stale', { reason: 'superseded' });
    }
  } catch (error) {
    if (isActive()) {
      markDiagnosticStage(trace, 'apply', { state: 'recovery-mode' });
      notify(`本机资料读取失败，已进入恢复模式；请先导入备份再修改本机资料：${errorMessage(error)}`);
      onLoadFailed?.();
      onLoaded(createEmptyReaderData());
      finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
    } else {
      finishDiagnosticTrace(trace, 'stale', { reason: 'superseded' });
    }
  }
}

export function useReaderDataController({
  notify
}: {
  notify: (message: string) => void;
}) {
  const [readerData, setReaderData] = useState<ReaderData>(() => createEmptyReaderData());
  const [readerDataLoaded, setReaderDataLoaded] = useState(false);
  const readerDataRef = useRef<ReaderData>(readerData);
  const readerDataLoadedRef = useRef(false);
  const readerDataWriteSuspendedRef = useRef(false);
  const lastPersistedReaderDataRef = useRef<ReaderData>(readerData);
  const lastPersistedReaderDataJsonRef = useRef(JSON.stringify(readerData));
  const saveQueueRef = useRef(Promise.resolve());

  const persistReaderData = useCallback((
    next: ReaderData,
    previous?: ReaderData,
    options?: {
      mutationReason?: ReaderDataMutationReason;
      skipIfSuperseded?: boolean;
      trace?: DiagnosticTrace;
    }
  ) => {
    const trace = options?.trace || beginDiagnosticTrace('reader-data', 'save', {
      mutationReason: options?.mutationReason || 'unknown'
    });
    markDiagnosticStage(trace, 'guard', { state: 'queued' });
    readerDataRef.current = next;
    const saveTask = saveQueueRef.current
      .catch(() => undefined)
      .then(waitForNextSaveTurn)
      .then((): Promise<{ nextJson: string | null; saved: ReaderData }> | null => {
        const recoveryWrite = readerDataWriteSuspendedRef.current
          && options?.mutationReason === 'backup-imported';
        if (readerDataWriteSuspendedRef.current && !recoveryWrite) {
          finishDiagnosticTrace(trace, 'blocked', { reason: 'storage_error' });
          return null;
        }
        if (options?.skipIfSuperseded && readerDataRef.current !== next) {
          finishDiagnosticTrace(trace, 'stale', { reason: 'superseded' });
          return null;
        }
        markDiagnosticStage(trace, 'persist', {
          count: readerDataRecordCount(next),
          state: 'started'
        });
        if (
          options?.mutationReason === 'settings-updated'
          && isSettingsOnlyCommit(lastPersistedReaderDataRef.current, next)
        ) {
          return saveReaderSettings(next.settings).then(() => ({ nextJson: null, saved: next }));
        }
        const nextJson: string | null = JSON.stringify(next);
        return saveCleanReaderData(
          next,
          recoveryWrite ? undefined : lastPersistedReaderDataJsonRef.current,
          nextJson
        )
          .then((saved) => ({ nextJson, saved }));
      })
      .then((result) => {
        if (!result) {
          return;
        }
        const { nextJson, saved } = result;
        lastPersistedReaderDataRef.current = saved;
        if (nextJson !== null) {
          lastPersistedReaderDataJsonRef.current = nextJson;
        }
        markDiagnosticStage(trace, 'apply', {
          count: readerDataRecordCount(saved),
          state: 'persisted'
        });
        if (readerDataRef.current === next) {
          readerDataRef.current = saved;
          setReaderData(saved);
        }
        finishDiagnosticTrace(trace, 'success', { count: readerDataRecordCount(saved) });
      })
      .catch((error) => {
        const recoveryRequired = error instanceof AggregateError;
        if (recoveryRequired) {
          readerDataWriteSuspendedRef.current = true;
        }
        if (previous) {
          const latestBeforeRollback = readerDataRef.current;
          const projectedRollback = recoveryRequired
            ? lastPersistedReaderDataRef.current
            : rollbackFailedReaderDataSave(
                latestBeforeRollback,
                next,
                previous,
                lastPersistedReaderDataRef.current
              );
          markDiagnosticStage(trace, 'rollback', {
            before: readerDataRecordCount(latestBeforeRollback),
            after: readerDataRecordCount(projectedRollback),
            didRollback: projectedRollback !== latestBeforeRollback
          });
          if (projectedRollback !== latestBeforeRollback) {
            readerDataRef.current = projectedRollback;
            setReaderData(projectedRollback);
          }
        }
        finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
        notify(errorMessage(error));
        throw error;
      });
    saveQueueRef.current = saveTask;
    return saveTask;
  }, [notify]);

  const commitReaderData = useCallback((
    mutationReason: ReaderDataMutationReason,
    updater: (current: ReaderData) => ReaderData
  ) => {
    const trace = beginDiagnosticTrace('reader-data', 'mutate', { mutationReason });
    if (!readerDataLoadedRef.current) {
      markDiagnosticStage(trace, 'guard', { state: 'not-loaded' });
      finishDiagnosticTrace(trace, 'blocked', { reason: 'not_ready' });
      notify('本机资料尚未加载完成，请稍后再试。');
      return;
    }
    if (readerDataWriteSuspendedRef.current) {
      markDiagnosticStage(trace, 'guard', { state: 'recovery-mode' });
      finishDiagnosticTrace(trace, 'blocked', { reason: 'storage_error' });
      notify('本机资料读取失败，请先导入备份再修改本机资料。');
      return;
    }
    const previous = readerDataRef.current;
    const next = prepareReaderDataCommit(previous, updater, mutationReason);
    if (!next) {
      finishDiagnosticTrace(trace, 'noop');
      return;
    }
    markDiagnosticStage(trace, 'apply', {
      before: readerDataRecordCount(previous),
      after: readerDataRecordCount(next)
    });
    setReaderData(next);
    void persistReaderData(next, previous, {
      mutationReason,
      skipIfSuperseded: isSettingsOnlyCommit(previous, next),
      trace
    }).catch(() => undefined);
  }, [notify, persistReaderData]);

  const replaceReaderData = useCallback((mutationReason: ReaderDataMutationReason, nextValue: ReaderData) => {
    const trace = beginDiagnosticTrace('reader-data', 'replace', { mutationReason });
    if (!readerDataLoadedRef.current) {
      markDiagnosticStage(trace, 'guard', { state: 'not-loaded' });
      finishDiagnosticTrace(trace, 'blocked', { reason: 'not_ready' });
      return Promise.reject(new Error('本机资料尚未加载完成，请稍后再试。'));
    }
    const previous = readerDataRef.current;
    const next = sanitizeReaderData(nextValue);
    markDiagnosticStage(trace, 'apply', {
      before: readerDataRecordCount(previous),
      after: readerDataRecordCount(next)
    });
    setReaderData(next);
    return persistReaderData(next, previous, { mutationReason, trace }).then(() => {
      readerDataWriteSuspendedRef.current = false;
    });
  }, [persistReaderData]);

  const waitForReaderDataSave = useCallback(() => saveQueueRef.current, []);

  useEffect(() => {
    let active = true;
    void loadInitialReaderData({
      isActive: () => active,
      notify,
      onLoadFailed: () => {
        readerDataWriteSuspendedRef.current = true;
      },
      onLoaded: (savedReaderData) => {
        readerDataRef.current = savedReaderData;
        lastPersistedReaderDataRef.current = savedReaderData;
        lastPersistedReaderDataJsonRef.current = JSON.stringify(savedReaderData);
        setReaderData(savedReaderData);
        readerDataLoadedRef.current = true;
        setReaderDataLoaded(true);
      }
    });
    return () => {
      active = false;
    };
  }, [notify]);

  return {
    commitReaderData,
    persistReaderData,
    readerData,
    readerDataLoaded,
    readerDataRef,
    replaceReaderData,
    waitForReaderDataSave
  };
}
