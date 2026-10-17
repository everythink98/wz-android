import { useStartupPageLayout } from '@/ui/navigation/startupPageLayout';
import { memo, useCallback, type ComponentProps, type RefObject } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { createMoreScreenStyles } from './styles';
import { MoreAccountPanel, type MoreAccountCapabilities } from './components/MoreAccountPanel';
import { MoreUpdatePanel, type MoreUpdateCapabilities } from './components/MoreUpdatePanel';
import { MoreUtilityPanels, type MoreUtilityCapabilities } from './components/MoreUtilityPanels';
import { ContentSourcesPanel } from './components/ContentSourcesPanel';

const MemoizedMoreAccountPanel = memo(MoreAccountPanel);
const MemoizedMoreUtilityPanels = memo(MoreUtilityPanels);
const MemoizedContentSourcesPanel = memo(ContentSourcesPanel);

export const MoreScreen = memo(function MoreScreen({
  account,
  contentSourcesExpanded,
  scrollRef,
  update,
  utilities,
  onContentSourcesExpandedChange
}: {
  account: MoreAccountCapabilities;
  contentSourcesExpanded: boolean;
  scrollRef?: RefObject<ScrollView | null>;
  update: MoreUpdateCapabilities;
  utilities: MoreUtilityCapabilities;
  onContentSourcesExpandedChange: (expanded: boolean) => void;
}) {
  const { styles } = useReaderThemeStyles(createMoreScreenStyles);
  const onPageLayout = useStartupPageLayout();
  const updateSettings = utilities.settings.update;
  const changeRecoveryThreshold = useCallback(
    (value: number) => updateSettings({ nodeSeekRecoveryThreshold: value }),
    [updateSettings]
  );
  const changeContentSources = useCallback<ComponentProps<typeof ContentSourcesPanel>['onChange']>(
    (contentSources) => updateSettings({ contentSources }),
    [updateSettings]
  );
  return (
    <ScrollView
      overScrollMode="never"
      onLayout={onPageLayout}
      ref={scrollRef}
      style={styles.content}
      contentContainerStyle={styles.moreContentInner}
      keyboardShouldPersistTaps="always"
    >
      <View>
        <Text style={styles.sectionTitle}>更多</Text>
        <MemoizedMoreAccountPanel
          nodeSeekRecoveryThreshold={utilities.settings.value.nodeSeekRecoveryThreshold}
          runtime={account}
          onNodeSeekRecoveryThresholdChange={changeRecoveryThreshold}
        />
        <MemoizedContentSourcesPanel
          expanded={contentSourcesExpanded}
          preferences={utilities.settings.value.contentSources}
          onChange={changeContentSources}
          onExpandedChange={onContentSourcesExpandedChange}
        />
        <MemoizedMoreUtilityPanels runtime={utilities} />
        <MoreUpdatePanel runtime={update} />
      </View>
    </ScrollView>
  );
});
