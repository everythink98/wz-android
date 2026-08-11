import { memo, type RefObject } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { createMoreScreenStyles } from './styles';
import { MoreAccountPanel, type MoreAccountCapabilities } from './components/MoreAccountPanel';
import { MoreUpdatePanel, type MoreUpdateCapabilities } from './components/MoreUpdatePanel';
import { MoreUtilityPanels, type MoreUtilityCapabilities } from './components/MoreUtilityPanels';
import { ContentSourcesPanel } from './components/ContentSourcesPanel';

export const MoreScreen = memo(function MoreScreen({
  account,
  contentSourcesExpanded,
  scrollRef,
  update,
  utilities,
  onContentSourcesExpandedChange
}: {
  account: MoreAccountCapabilities;
  contentSourcesExpanded?: boolean;
  scrollRef?: RefObject<ScrollView | null>;
  update: MoreUpdateCapabilities;
  utilities: MoreUtilityCapabilities;
  onContentSourcesExpandedChange?: (expanded: boolean) => void;
}) {
  const { styles } = useReaderThemeStyles(createMoreScreenStyles);
  return (
    <ScrollView
      ref={scrollRef}
      style={styles.content}
      contentContainerStyle={styles.moreContentInner}
      keyboardShouldPersistTaps="always"
    >
      <View style={styles.stack}>
        <Text style={styles.sectionTitle}>更多</Text>
        <MoreUpdatePanel runtime={update} />
        <MoreAccountPanel
          nodeSeekRecoveryThreshold={utilities.settings.value.nodeSeekRecoveryThreshold}
          runtime={account}
          onNodeSeekRecoveryThresholdChange={(value) => utilities.settings.update({ nodeSeekRecoveryThreshold: value })}
        />
        <ContentSourcesPanel
          expanded={contentSourcesExpanded}
          preferences={utilities.settings.value.contentSources}
          onChange={(contentSources) => utilities.settings.update({ contentSources })}
          onExpandedChange={onContentSourcesExpandedChange}
        />
        <MoreUtilityPanels runtime={utilities} />
      </View>
    </ScrollView>
  );
});
