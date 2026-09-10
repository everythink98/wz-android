import { useCallback } from 'react';
import type { ReaderSettings } from '@/domain/reader/readerData';
import type { ReaderCommand } from '@/domain/reader/readerRecordState';

export function useReaderSettingsController({
  commitReaderData
}: {
  commitReaderData: (command: ReaderCommand) => void;
}) {
  const updateSettings = useCallback(
    (patch: Partial<ReaderSettings>) => {
      commitReaderData({ type: 'settings', patch });
    },
    [commitReaderData]
  );
  return { updateSettings };
}
