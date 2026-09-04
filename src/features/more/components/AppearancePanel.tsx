import Slider from '@react-native-community/slider';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { MoreScreenStyles } from '../styles';
import {
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  FONT_SCALE_STEP,
  normalizeFontScale,
  type ReaderSettings
} from '@/domain/reader/readerData';
import type { ReaderTheme } from '@/ui/theme/tokens';

export function AppearancePanel({
  settings,
  showSettingsPanel,
  styles,
  theme,
  onUpdateSettings
}: {
  settings: ReaderSettings;
  showSettingsPanel: boolean;
  styles: MoreScreenStyles;
  theme: ReaderTheme;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
}) {
  return (
    <View style={styles.stack}>
      {showSettingsPanel ? (
        <SettingsPanel settings={settings} styles={styles} theme={theme} onUpdateSettings={onUpdateSettings} />
      ) : null}
    </View>
  );
}

function SettingsPanel({
  settings,
  styles,
  theme,
  onUpdateSettings
}: {
  settings: ReaderSettings;
  styles: MoreScreenStyles;
  theme: ReaderTheme;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
}) {
  return (
    <View style={styles.appearanceSettings}>
      <View style={styles.appearanceSection}>
        <Text style={styles.appearanceSectionTitle}>显示</Text>
        <SegmentedSetting
          title="主题"
          items={[
            { value: 'light', label: '浅色' },
            { value: 'dark', label: '深色' }
          ]}
          value={settings.theme}
          styles={styles}
          onChange={(value) => onUpdateSettings({ theme: value as ReaderSettings['theme'] })}
        />
      </View>

      <View style={styles.appearanceSection}>
        <Text style={styles.appearanceSectionTitle}>阅读</Text>
        <FontScaleSetting
          value={settings.fontScale}
          styles={styles}
          theme={theme}
          onChange={(fontScale) => onUpdateSettings({ fontScale })}
        />
        <SegmentedSetting
          divided
          title="行距"
          items={[
            { value: 'compact', label: '紧凑' },
            { value: 'standard', label: '标准' },
            { value: 'loose', label: '宽松' }
          ]}
          value={settings.lineHeight}
          styles={styles}
          onChange={(value) => onUpdateSettings({ lineHeight: value as ReaderSettings['lineHeight'] })}
        />
        <SegmentedSetting
          divided
          title="正文宽度"
          items={[
            { value: 'narrow', label: '窄' },
            { value: 'standard', label: '标准' },
            { value: 'wide', label: '宽' }
          ]}
          value={settings.contentWidth}
          styles={styles}
          onChange={(value) => onUpdateSettings({ contentWidth: value as ReaderSettings['contentWidth'] })}
        />
        <SegmentedSetting
          divided
          title="字体"
          items={[
            { value: 'sans', label: '无衬线' },
            { value: 'serif', label: '衬线' }
          ]}
          value={settings.fontFamily}
          styles={styles}
          onChange={(value) => onUpdateSettings({ fontFamily: value as ReaderSettings['fontFamily'] })}
        />
      </View>

      <View style={styles.appearanceSection}>
        <Text style={styles.appearanceSectionTitle}>列表</Text>
        <SegmentedSetting
          title="列表密度"
          items={[
            { value: 'compact', label: '紧凑' },
            { value: 'standard', label: '标准' },
            { value: 'loose', label: '宽松' }
          ]}
          value={settings.listDensity}
          styles={styles}
          onChange={(value) => onUpdateSettings({ listDensity: value as ReaderSettings['listDensity'] })}
        />
      </View>
    </View>
  );
}

function SegmentedSetting({
  divided = false,
  items,
  styles,
  title,
  value,
  onChange
}: {
  divided?: boolean;
  items: { value: string; label: string }[];
  styles: MoreScreenStyles;
  title: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={[styles.appearanceSettingRow, divided && styles.appearanceSettingRowDivided]}>
      <Text style={styles.appearanceSettingLabel}>{title}</Text>
      <View style={styles.appearanceSegmentedControl}>
        {items.map((item) => {
          const selected = item.value === value;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected }}
              key={item.value}
              style={[styles.appearanceSegment, selected && styles.appearanceSegmentActive]}
              onPress={() => {
                onChange(item.value);
              }}
            >
              <Text style={[styles.appearanceSegmentText, selected && styles.appearanceSegmentTextActive]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function FontScaleSetting({
  styles,
  theme,
  value,
  onChange
}: {
  styles: MoreScreenStyles;
  theme: ReaderTheme;
  value: number;
  onChange: (value: number) => void;
}) {
  const [draftValue, setDraftValue] = useState(value);
  const percent = Math.round(draftValue * 100);

  useEffect(() => {
    setDraftValue(value);
  }, [value]);

  const commit = (nextValue: number) => {
    const normalized = normalizeFontScale(nextValue);
    setDraftValue(normalized);
    onChange(normalized);
  };
  const setStep = (direction: -1 | 1) => {
    commit(draftValue + direction * FONT_SCALE_STEP);
  };

  return (
    <View style={styles.appearanceFontScaleBlock}>
      <View style={styles.appearanceFontScaleHeader}>
        <Text style={styles.appearanceSettingLabel}>字号</Text>
        <Text style={styles.appearanceFontScaleValue}>字号 {percent}%</Text>
      </View>
      <View style={styles.appearanceSliderRow}>
        <Pressable
          accessibilityLabel="减小字号"
          accessibilityRole="button"
          accessibilityState={{ disabled: draftValue <= FONT_SCALE_MIN }}
          disabled={draftValue <= FONT_SCALE_MIN}
          style={[styles.appearanceStepButton, draftValue <= FONT_SCALE_MIN && styles.appearanceControlDisabled]}
          onPress={() => {
            setStep(-1);
          }}
        >
          <Text style={styles.appearanceStepButtonText}>−</Text>
        </Pressable>
        <Slider
          accessibilityLabel="字号"
          accessibilityValue={{ min: 85, max: 140, now: percent, text: `字号 ${percent}%` }}
          maximumValue={FONT_SCALE_MAX}
          maximumTrackTintColor={theme.lineStrong}
          minimumValue={FONT_SCALE_MIN}
          minimumTrackTintColor={theme.primary}
          step={FONT_SCALE_STEP}
          style={styles.appearanceSlider}
          testID="appearance-font-scale-slider"
          thumbTintColor={theme.primaryStrong}
          value={draftValue}
          onSlidingComplete={commit}
          onValueChange={(nextValue) => setDraftValue(normalizeFontScale(nextValue))}
        />
        <Pressable
          accessibilityLabel="增大字号"
          accessibilityRole="button"
          accessibilityState={{ disabled: draftValue >= FONT_SCALE_MAX }}
          disabled={draftValue >= FONT_SCALE_MAX}
          style={[styles.appearanceStepButton, draftValue >= FONT_SCALE_MAX && styles.appearanceControlDisabled]}
          onPress={() => {
            setStep(1);
          }}
        >
          <Text style={styles.appearanceStepButtonText}>＋</Text>
        </Pressable>
      </View>
    </View>
  );
}
