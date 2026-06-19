import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../appUtils';
import {
  createEmptyReaderData,
  sanitizeReaderData,
  type ReaderData
} from '../readerData';
import { loadReaderData, saveReaderData } from '../readerDataStore';

export function useReaderDataController({
  notify
}: {
  notify: (message: string) => void;
}) {
  const [readerData, setReaderData] = useState<ReaderData>(() => createEmptyReaderData());
  const [readerDataLoaded, setReaderDataLoaded] = useState(false);
  const readerDataRef = useRef<ReaderData>(readerData);
  const readerDataStateRef = useRef<ReaderData>(readerData);
  const saveQueueRef = useRef(Promise.resolve());

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

  useEffect(() => {
    void loadReaderData()
      .then((savedReaderData) => setReaderData(savedReaderData))
      .catch((error) => notify(errorMessage(error)))
      .finally(() => setReaderDataLoaded(true));
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
