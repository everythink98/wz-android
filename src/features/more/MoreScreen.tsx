import { useStartupPageLayout } from '@/ui/navigation/startupPageLayout';
import { memo, useCallback, useContext, useState, type RefObject } from 'react';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { ScrollView, StatusBar, View } from 'react-native';
import { PortalHost, PortalProvider } from '@gorhom/portal';
import { NavigationBackdropTarget, NavigationGlass } from '@/ui/navigation/NavigationGlass';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { createMoreScreenStyles } from './styles';
import { MoreAccountPanel, type MoreAccountCapabilities } from './components/MoreAccountPanel';
import { MoreUpdatePanel, type MoreUpdateCapabilities } from './components/MoreUpdatePanel';
import { MoreUtilityPanels, type MoreUtilityCapabilities } from './components/MoreUtilityPanels';

const MemoizedMoreAccountPanel = memo(MoreAccountPanel);
const MemoizedMoreUtilityPanels = memo(MoreUtilityPanels);

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
  const bottomBarHeight = useContext(BottomTabBarHeightContext) ?? 0;
  const onPageLayout = useStartupPageLayout();
  const [headerHeight, setHeaderHeight] = useState((StatusBar.currentHeight ?? 0) + 56);
  const updateSettings = utilities.settings.update;
  const changeRecoveryThreshold = useCallback(
    (value: number) => updateSettings({ nodeSeekRecoveryThreshold: value }),
    [updateSettings]
  );
  return (
    <PortalProvider>
      <View style={styles.content}>
        <NavigationBackdropTarget active={account.active} testID="more-glass-content">
          <ScrollView
            testID="more-scroll"
            overScrollMode="never"
            onLayout={onPageLayout}
            ref={scrollRef}
            style={styles.content}
            contentContainerStyle={[
              styles.moreContentInner,
              styles.moreFullWidthContent,
              { paddingTop: headerHeight, paddingBottom: Math.max(124, bottomBarHeight + 20) }
            ]}
            keyboardShouldPersistTaps="always"
          >
            <View>
              <MemoizedMoreAccountPanel
                headerHostName="more-account-header"
                nodeSeekRecoveryThreshold={utilities.settings.value.nodeSeekRecoveryThreshold}
                runtime={account}
                onNodeSeekRecoveryThresholdChange={changeRecoveryThreshold}
              />
              <View style={styles.morePageInset}>
                <MemoizedMoreUtilityPanels
                  runtime={utilities}
                  contentSourcesExpanded={contentSourcesExpanded}
                  onContentSourcesExpandedChange={onContentSourcesExpandedChange}
                />
                <MoreUpdatePanel runtime={update} />
              </View>
            </View>
          </ScrollView>
        </NavigationBackdropTarget>
        <View
          testID="more-glass-header"
          style={styles.moreGlassHeader}
          onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}
        >
          <NavigationGlass variant="toolbar" />
          <View style={styles.moreHeaderHost}>
            <PortalHost name="more-account-header" />
          </View>
        </View>
      </View>
    </PortalProvider>
  );
});
