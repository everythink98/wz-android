import { useEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { visualScenarioCatalog, VisualScenarioView } from '../../tests/ui/visual/catalog';
import type { VisualAppearance } from '../../tests/ui/visual/types';

const families = [
  'ALL',
  ...Array.from(new Set(visualScenarioCatalog.flatMap((scenario) => scenario.capabilityIds.map(capabilityFamily))))
];

function capabilityFamily(capabilityId: string) {
  return capabilityId.split('-')[0];
}

function Choice({
  active,
  dark,
  label,
  onPress
}: {
  active: boolean;
  dark: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.choice, dark && styles.darkChoice, active && styles.choiceActive]}
      onPress={onPress}
    >
      <Text style={[styles.choiceText, dark && styles.darkChoiceText, active && styles.choiceTextActive]}>{label}</Text>
    </Pressable>
  );
}

export function VisualGalleryApp() {
  const [appearance, setAppearance] = useState<VisualAppearance>({
    fontScale: 1,
    listDensity: 'standard',
    theme: 'light'
  });
  const [family, setFamily] = useState('ALL');
  const [fullScreen, setFullScreen] = useState(false);
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return visualScenarioCatalog.filter((scenario) => {
      const familyMatches = family === 'ALL' || scenario.capabilityIds.some((id) => capabilityFamily(id) === family);
      const queryMatches =
        !needle ||
        [scenario.id, scenario.title, scenario.kind, ...scenario.capabilityIds, ...scenario.tags]
          .join(' ')
          .toLowerCase()
          .includes(needle);
      return familyMatches && queryMatches;
    });
  }, [family, query]);
  const [selectedId, setSelectedId] = useState(visualScenarioCatalog[0]?.id || '');
  const selectedIndex = filtered.findIndex((scenario) => scenario.id === selectedId);
  const effectiveIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const selected = filtered[effectiveIndex];

  useEffect(() => {
    if (selected?.id && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected?.id, selectedId]);

  useEffect(() => {
    if (!fullScreen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setFullScreen(false);
      return true;
    });
    return () => subscription.remove();
  }, [fullScreen]);

  const move = (offset: number) => {
    if (!filtered.length) return;
    setSelectedId(filtered[(effectiveIndex + offset + filtered.length) % filtered.length].id);
  };

  const dark = appearance.theme === 'dark';
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.flex} testID="visual-gallery-root">
        <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
        <SafeAreaView style={[styles.flex, dark && styles.darkRoot]}>
          {!fullScreen ? (
            <View style={[styles.toolbar, dark && styles.darkToolbar]}>
              <View style={styles.headingRow}>
                <Text style={[styles.heading, dark && styles.darkText]}>可视状态语料库</Text>
                <Choice active={false} dark={dark} label="全屏预览" onPress={() => setFullScreen(true)} />
              </View>
              <TextInput
                accessibilityLabel="搜索视觉场景"
                placeholder="能力、场景或状态"
                placeholderTextColor={dark ? '#888888' : '#777777'}
                style={[styles.search, dark && styles.darkSearch]}
                value={query}
                onChangeText={setQuery}
              />
              <ScrollView horizontal contentContainerStyle={styles.choiceRow} showsHorizontalScrollIndicator={false}>
                {families.map((value) => (
                  <Choice
                    key={value}
                    active={family === value}
                    dark={dark}
                    label={value === 'ALL' ? '全部' : value}
                    onPress={() => setFamily(value)}
                  />
                ))}
              </ScrollView>
              <View style={styles.choiceRow}>
                <Choice
                  active={!dark}
                  dark={dark}
                  label="浅色"
                  onPress={() => setAppearance((value) => ({ ...value, theme: 'light' }))}
                />
                <Choice
                  active={dark}
                  dark={dark}
                  label="深色"
                  onPress={() => setAppearance((value) => ({ ...value, theme: 'dark' }))}
                />
                <Choice
                  active={appearance.fontScale === 1}
                  dark={dark}
                  label="100%"
                  onPress={() => setAppearance((value) => ({ ...value, fontScale: 1 }))}
                />
                <Choice
                  active={appearance.fontScale === 1.4}
                  dark={dark}
                  label="140%"
                  onPress={() => setAppearance((value) => ({ ...value, fontScale: 1.4 }))}
                />
              </View>
              <View style={styles.choiceRow}>
                {(['compact', 'standard', 'loose'] as const).map((density) => (
                  <Choice
                    key={density}
                    active={appearance.listDensity === density}
                    dark={dark}
                    label={{ compact: '紧凑', loose: '宽松', standard: '标准' }[density]}
                    onPress={() => setAppearance((value) => ({ ...value, listDensity: density }))}
                  />
                ))}
              </View>
              <View style={styles.navigationRow}>
                <Pressable accessibilityRole="button" style={styles.navigationButton} onPress={() => move(-1)}>
                  <Text style={styles.navigationButtonText}>上一个</Text>
                </Pressable>
                <Text numberOfLines={2} style={[styles.sceneTitle, dark && styles.darkText]}>
                  {selected ? `${effectiveIndex + 1}/${filtered.length} · ${selected.title}` : '没有匹配的场景'}
                </Text>
                <Pressable accessibilityRole="button" style={styles.navigationButton} onPress={() => move(1)}>
                  <Text style={styles.navigationButtonText}>下一个</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          <View style={styles.scene} testID="visual-gallery-ready">
            {selected ? <VisualScenarioView appearance={appearance} id={selected.id} /> : null}
          </View>
        </SafeAreaView>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  choice: {
    alignItems: 'center',
    borderColor: '#D0D0D0',
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 10
  },
  choiceActive: {
    backgroundColor: '#1677FF',
    borderColor: '#1677FF'
  },
  choiceRow: {
    flexDirection: 'row',
    gap: 8
  },
  choiceText: {
    color: '#303030',
    fontSize: 12,
    fontWeight: '600'
  },
  choiceTextActive: {
    color: '#FFFFFF'
  },
  darkRoot: {
    backgroundColor: '#121212'
  },
  darkChoice: {
    borderColor: '#6A6A6A'
  },
  darkChoiceText: {
    color: '#E5E5E5'
  },
  darkSearch: {
    backgroundColor: '#222222',
    borderColor: '#444444',
    color: '#F1F1F1'
  },
  darkText: {
    color: '#F1F1F1'
  },
  darkToolbar: {
    backgroundColor: '#181818',
    borderBottomColor: '#303030'
  },
  flex: {
    flex: 1
  },
  heading: {
    color: '#181818',
    fontSize: 18,
    fontWeight: '700'
  },
  headingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  navigationButton: {
    alignItems: 'center',
    backgroundColor: '#1677FF',
    borderRadius: 7,
    justifyContent: 'center',
    minHeight: 48,
    minWidth: 72,
    paddingHorizontal: 10
  },
  navigationButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700'
  },
  navigationRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10
  },
  scene: {
    flex: 1
  },
  sceneTitle: {
    color: '#181818',
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center'
  },
  search: {
    backgroundColor: '#FCFCFC',
    borderColor: '#D0D0D0',
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    color: '#181818',
    minHeight: 48,
    paddingHorizontal: 12
  },
  toolbar: {
    backgroundColor: '#FCFCFC',
    borderBottomColor: '#E3E3E3',
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 9,
    padding: 12
  }
});
