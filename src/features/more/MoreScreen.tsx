import { memo, type RefObject } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { createMoreScreenStyles } from './styles';
import { MoreAccountPanel, type MoreAccountCapabilities } from './components/MoreAccountPanel';
import { MoreUpdatePanel, type MoreUpdateCapabilities } from './components/MoreUpdatePanel';
import { MoreUtilityPanels, type MoreUtilityCapabilities } from './components/MoreUtilityPanels';

export const MoreScreen = memo(function MoreScreen({
  account,
  scrollRef,
  update,
  utilities
}: {
  account: MoreAccountCapabilities;
  scrollRef?: RefObject<ScrollView | null>;
  update: MoreUpdateCapabilities;
  utilities: MoreUtilityCapabilities;
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
        <MoreAccountPanel runtime={account} />
        <MoreUtilityPanels runtime={utilities} />
      </View>
    </ScrollView>
  );
});
