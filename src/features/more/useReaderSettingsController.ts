import { useCallback } from 'react';
import type { ReaderCommand, ReaderSettingsUpdate } from '@/domain/reader/readerRecordState';

export function useReaderSettingsController({
  commitReaderData
}: {
  commitReaderData: (command: ReaderCommand) => void;
}) {
  const updateSettings = useCallback(
    (patch: ReaderSettingsUpdate) => {
      commitReaderData({ type: 'settings', patch });
    },
    [commitReaderData]
  );
  return { updateSettings };
}
