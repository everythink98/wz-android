import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../appUtils';
import {
  createEmptyReaderData,
  sanitizeReaderData,
  type ReaderData
} from '../readerData';
import { loadReaderData, saveCleanReaderData } from '../readerDataStore';

export function prepareReaderDataCommit(current: ReaderData, updater: (current: ReaderData) => ReaderData) {
  const updated = updater(current);
  return updated === current ? null : sanitizeReaderData(updated);
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
  const saveQueueRef = useRef(Promise.resolve());

  if (readerDataStateRef.current !== readerData) {
    readerDataStateRef.current = readerData;
    readerDataRef.current = readerData;
  }

  const persistReaderData = useCallback((next: ReaderData, previous?: ReaderData) => {
    readerDataRef.current = next;
    const saveTask = saveQueueRef.current
      .catch(() => undefined)
      .then(() => saveCleanReaderData(next))
      .then((saved) => {
        lastPersistedReaderDataRef.current = saved;
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
    void persistReaderData(next, previous).catch(() => undefined);
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
