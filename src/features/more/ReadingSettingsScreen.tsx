import { memo } from 'react';
import { ScrollView } from 'react-native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { AppearancePanel } from './components/AppearancePanel';
import { createMoreScreenStyles } from './styles';

export const ReadingSettingsScreen = memo(function ReadingSettingsScreen({
  settings,
  onUpdateSettings
}: {
  settings: ReaderSettings;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createMoreScreenStyles);
  return (
    <ScrollView
      style={styles.content}
      contentContainerStyle={styles.moreContentInner}
      keyboardShouldPersistTaps="handled"
    >
      <AppearancePanel
        settings={settings}
        showSettingsPanel
        styles={styles}
        theme={theme}
        onUpdateSettings={onUpdateSettings}
      />
    </ScrollView>
  );
});
