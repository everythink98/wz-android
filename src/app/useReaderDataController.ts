import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../appUtils';
import {
  createEmptyReaderData,
  sanitizeReaderSettings,
  sanitizeReaderData,
  type ReaderData
} from '../readerData';
import { loadReaderData, saveCleanReaderData } from '../readerDataStore';

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

export function prepareReaderDataCommit(current: ReaderData, updater: (current: ReaderData) => ReaderData) {
  const updated = updater(current);
  if (updated === current) {
    return null;
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
  try {
    const savedReaderData = await load();
    if (isActive()) {
      onLoaded(savedReaderData);
    }
  } catch (error) {
    if (isActive()) {
      notify(`本机资料读取失败，已进入恢复模式；请先导入备份再修改本机资料：${errorMessage(error)}`);
      onLoadFailed?.();
      onLoaded(createEmptyReaderData());
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
  const readerDataStateRef = useRef<ReaderData>(readerData);
  const lastPersistedReaderDataRef = useRef<ReaderData>(readerData);
  const lastPersistedReaderDataJsonRef = useRef(JSON.stringify(readerData));
  const saveQueueRef = useRef(Promise.resolve());

  if (readerDataStateRef.current !== readerData) {
    readerDataStateRef.current = readerData;
    readerDataRef.current = readerData;
  }

  const persistReaderData = useCallback((next: ReaderData, previous?: ReaderData, options?: { skipIfSuperseded?: boolean }) => {
    readerDataRef.current = next;
    const saveTask = saveQueueRef.current
      .catch(() => undefined)
      .then(waitForNextSaveTurn)
      .then(() => {
        if (options?.skipIfSuperseded && readerDataRef.current !== next) {
          return null;
        }
        const nextJson = JSON.stringify(next);
        return saveCleanReaderData(next, lastPersistedReaderDataJsonRef.current, nextJson)
          .then((saved) => ({ nextJson, saved }));
      })
      .then((result) => {
        if (!result) {
          return;
        }
        const { nextJson, saved } = result;
        lastPersistedReaderDataRef.current = saved;
        lastPersistedReaderDataJsonRef.current = nextJson;
        setReaderData((latest) => {
          if (latest !== next) {
            return latest;
          }
          readerDataRef.current = saved;
          return saved;
        });
      })
      .catch((error) => {
        if (previous) {
          setReaderData((latest) => {
            const restored = rollbackFailedReaderDataSave(latest, next, previous, lastPersistedReaderDataRef.current);
            if (restored !== latest) {
              readerDataRef.current = restored;
            }
            return restored;
          });
        }
        notify(errorMessage(error));
        throw error;
      });
    saveQueueRef.current = saveTask;
    return saveTask;
  }, [notify]);

  const commitReaderData = useCallback((updater: (current: ReaderData) => ReaderData) => {
    if (!readerDataLoadedRef.current) {
      notify('本机资料尚未加载完成，请稍后再试。');
      return;
    }
    if (readerDataWriteSuspendedRef.current) {
      notify('本机资料读取失败，请先导入备份再修改本机资料。');
      return;
    }
    const previous = readerDataRef.current;
    const next = prepareReaderDataCommit(previous, updater);
    if (!next) {
      return;
    }
    setReaderData(next);
    void persistReaderData(next, previous, { skipIfSuperseded: isSettingsOnlyCommit(previous, next) }).catch(() => undefined);
  }, [notify, persistReaderData]);

  const replaceReaderData = useCallback((nextValue: ReaderData) => {
    if (!readerDataLoadedRef.current) {
      return Promise.reject(new Error('本机资料尚未加载完成，请稍后再试。'));
    }
    const previous = readerDataRef.current;
    const next = sanitizeReaderData(nextValue);
    setReaderData(next);
    return persistReaderData(next, previous).then(() => {
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
    setReaderData,
    waitForReaderDataSave
  };
}
