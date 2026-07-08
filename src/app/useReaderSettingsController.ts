import { useCallback } from 'react';
import type { ReaderData, ReaderSettings } from '../readerData';

export function applyReaderSettingsPatch(current: ReaderData, patch: Partial<ReaderSettings>) {
  const hasChanges = Object.entries(patch).some(
    ([key, value]) => current.settings[key as keyof ReaderSettings] !== value
  );
  if (!hasChanges) {
    return current;
  }

  return {
    ...current,
    settings: {
      ...current.settings,
      ...patch
    }
  };
}

export function useReaderSettingsController({
  commitReaderData
}: {
  commitReaderData: (updater: (current: ReaderData) => ReaderData) => void;
}) {
  const updateSettings = useCallback((patch: Partial<ReaderSettings>) => {
    commitReaderData((current) => applyReaderSettingsPatch(current, patch));
  }, [commitReaderData]);

  return { updateSettings };
}
