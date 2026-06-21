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

export async function loadInitialReaderData({
  isActive,
  load = loadReaderData,
  notify,
  onLoaded
}: {
  isActive: () => boolean;
  load?: () => Promise<ReaderData>;
  notify: (message: string) => void;
  onLoaded: (readerData: ReaderData) => void;
}) {
  try {
    const savedReaderData = await load();
    if (isActive()) {
      onLoaded(savedReaderData);
    }
  } catch (error) {
    if (isActive()) {
      notify(`本机资料读取失败，已暂停本地写入：${errorMessage(error)}`);
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
  const readerDataStateRef = useRef<ReaderData>(readerData);
  const saveQueueRef = useRef(Promise.resolve());

  if (readerDataStateRef.current !== readerData) {
    readerDataStateRef.current = readerData;
    readerDataRef.current = readerData;
  }

  const persistReaderData = useCallback((next: ReaderData) => {
    readerDataRef.current = next;
    const saveTask = saveQueueRef.current
      .catch(() => undefined)
      .then(() => saveCleanReaderData(next))
      .then((saved) => {
        setReaderData((latest) => {
          if (latest !== next) {
            return latest;
          }
          readerDataRef.current = saved;
          return saved;
        });
      })
      .catch((error) => {
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
    const next = prepareReaderDataCommit(readerDataRef.current, updater);
    if (!next) {
      return;
    }
    setReaderData(next);
    void persistReaderData(next).catch(() => undefined);
  }, [notify, persistReaderData]);

  const replaceReaderData = useCallback((nextValue: ReaderData) => {
    if (!readerDataLoadedRef.current) {
      return Promise.reject(new Error('本机资料尚未加载完成，请稍后再试。'));
    }
    const next = sanitizeReaderData(nextValue);
    setReaderData(next);
    return persistReaderData(next);
  }, [persistReaderData]);

  const waitForReaderDataSave = useCallback(() => saveQueueRef.current, []);

  useEffect(() => {
    let active = true;
    void loadInitialReaderData({
      isActive: () => active,
      notify,
      onLoaded: (savedReaderData) => {
        readerDataRef.current = savedReaderData;
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
