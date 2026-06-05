import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { errorMessage } from '../appUtils';
import {
  createEmptyReaderData,
  sanitizeReaderData,
  updateProgress,
  type ReaderData
} from '../readerData';
import { loadReaderData, saveReaderData } from '../readerDataStore';
import type { Topic } from '../types';

const PROGRESS_SAVE_DEBOUNCE_MS = 650;
const PROGRESS_SAVE_MAX_PENDING_MS = 2000;

export function useReaderDataController({
  notify,
  screenRef
}: {
  notify: (message: string) => void;
  screenRef: RefObject<string>;
}) {
  const [readerData, setReaderData] = useState<ReaderData>(() => createEmptyReaderData());
  const [readerDataLoaded, setReaderDataLoaded] = useState(false);
  const readerDataRef = useRef<ReaderData>(readerData);
  const readerDataStateRef = useRef<ReaderData>(readerData);
  const saveQueueRef = useRef(Promise.resolve());
  const progressSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressMaxSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingProgressRef = useRef<{ topic: Topic; percent: number; scrollY: number } | null>(null);

  if (readerDataStateRef.current !== readerData) {
    readerDataStateRef.current = readerData;
    readerDataRef.current = readerData;
  }

  const persistReaderData = useCallback((next: ReaderData) => {
    readerDataRef.current = next;
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(() => saveReaderData(next))
      .then((saved) => {
        setReaderData((latest) => {
          if (latest !== next) {
            return latest;
          }
          readerDataRef.current = saved;
          return saved;
        });
      })
      .catch((error) => notify(errorMessage(error)));
    return saveQueueRef.current;
  }, [notify]);

  const commitReaderData = useCallback((updater: (current: ReaderData) => ReaderData) => {
    const next = sanitizeReaderData(updater(readerDataRef.current));
    setReaderData(next);
    void persistReaderData(next);
  }, [persistReaderData]);

  const replaceReaderData = useCallback((nextValue: ReaderData) => {
    const next = sanitizeReaderData(nextValue);
    setReaderData(next);
    return persistReaderData(next);
  }, [persistReaderData]);

  const waitForReaderDataSave = useCallback(() => (
    saveQueueRef.current.catch(() => undefined)
  ), []);

  const flushPendingProgress = useCallback(() => {
    if (progressSaveTimerRef.current) {
      clearTimeout(progressSaveTimerRef.current);
      progressSaveTimerRef.current = null;
    }
    if (progressMaxSaveTimerRef.current) {
      clearTimeout(progressMaxSaveTimerRef.current);
      progressMaxSaveTimerRef.current = null;
    }
    const pending = pendingProgressRef.current;
    pendingProgressRef.current = null;
    if (!pending) {
      return;
    }
    const next = updateProgress(readerDataRef.current, pending.topic, {
      percent: pending.percent,
      scrollY: pending.scrollY
    });
    readerDataRef.current = next;
    if (screenRef.current !== 'topic') {
      setReaderData(next);
    }
    void persistReaderData(next);
  }, [persistReaderData, screenRef]);

  const queueProgressSave = useCallback((topic: Topic, progress: { percent: number; scrollY: number }) => {
    pendingProgressRef.current = { topic, percent: progress.percent, scrollY: progress.scrollY };
    if (progressSaveTimerRef.current) {
      clearTimeout(progressSaveTimerRef.current);
    }
    if (!progressMaxSaveTimerRef.current) {
      progressMaxSaveTimerRef.current = setTimeout(() => {
        flushPendingProgress();
      }, PROGRESS_SAVE_MAX_PENDING_MS);
    }
    progressSaveTimerRef.current = setTimeout(() => {
      flushPendingProgress();
    }, PROGRESS_SAVE_DEBOUNCE_MS);
  }, [flushPendingProgress]);

  const clearReaderDataTimers = useCallback(() => {
    if (progressSaveTimerRef.current) {
      clearTimeout(progressSaveTimerRef.current);
      progressSaveTimerRef.current = null;
    }
    if (progressMaxSaveTimerRef.current) {
      clearTimeout(progressMaxSaveTimerRef.current);
      progressMaxSaveTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    void loadReaderData()
      .then((savedReaderData) => setReaderData(savedReaderData))
      .catch((error) => notify(errorMessage(error)))
      .finally(() => setReaderDataLoaded(true));
  }, [notify]);

  useEffect(() => clearReaderDataTimers, [clearReaderDataTimers]);

  return {
    clearReaderDataTimers,
    commitReaderData,
    flushPendingProgress,
    persistReaderData,
    queueProgressSave,
    readerData,
    readerDataLoaded,
    readerDataRef,
    replaceReaderData,
    setReaderData,
    waitForReaderDataSave
  };
}
