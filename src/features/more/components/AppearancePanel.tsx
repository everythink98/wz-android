import { NavigationContext } from '@react-navigation/native';
import Slider from '@react-native-community/slider';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Dimensions, Pressable, ScrollView, Text, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';
import { ActivityIndicator, Divider, ProgressBar } from 'react-native-paper';
import { Check, ChevronDown, FilePlus2, Minus, Plus } from 'lucide-react-native';
import { IconButton } from '@/ui/controls/ButtonControls';
import { PopupMenu } from '@/ui/controls/PopupMenu';
import type { MoreScreenStyles } from '../styles';
import {
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  FONT_SCALE_STEP,
  normalizeFontScale,
  type ReaderSettings
} from '@/domain/reader/readerData';
import {
  BUILT_IN_READER_FONT_EDITION,
  BUILT_IN_READER_FONT_NAME,
  isLocalReaderFontFamily,
  type LocalReaderFont,
  type LocalReaderFontFamily,
  type ReaderFontFamily
} from '@/domain/reader/readerFonts';
import { errorMessage } from '@/platform/network/errors';
import {
  downloadableReaderFonts,
  pickLocalReaderFont,
  type DownloadableReaderFont,
  type ReaderFontDownloadProgress
} from '@/platform/storage/readerFonts';
import {
  installReaderFont,
  localReaderFontCatalog,
  localReaderFontRegistration,
  readerFontDownload,
  rememberInstalledReaderFont,
  type ReaderFontTarget
} from '@/ui/theme/useReaderFonts';
import { createTheme, type ReaderTheme } from '@/ui/theme/tokens';
import { AppSwitch } from '@/ui/controls/InputControls';

type AppearanceSettings = Pick<
  ReaderSettings,
  | 'theme'
  | 'uiFontScale'
  | 'uiFontFamily'
  | 'fontScale'
  | 'fontFamily'
  | 'lineHeight'
  | 'contentWidth'
  | 'listDensity'
  | 'showUnreadDot'
>;

type Option<Value extends string> = { value: Value; label: string };
type FontOption = Option<ReaderFontFamily> & { edition?: string; download?: DownloadableReaderFont };
type FontAnchor = { x: number; y: number; width: number; height: number };
type FontFailure = { family?: LocalReaderFontFamily; message: string };

const themeOptions = [
  { value: 'light', label: '浅色', preview: createTheme({ theme: 'light' }) },
  { value: 'dark', label: '深色', preview: createTheme({ theme: 'dark' }) }
] as const;

const spacingOptions = [
  { value: 'compact', label: '紧凑' },
  { value: 'standard', label: '标准' },
  { value: 'loose', label: '宽松' }
] as const;

export function AppearancePanel({
  settings,
  readingOnly = false,
  showSettingsPanel,
  styles,
  theme,
  onUpdateSettings
}: {
  settings: AppearanceSettings;
  readingOnly?: boolean;
  showSettingsPanel: boolean;
  styles: MoreScreenStyles;
  theme: ReaderTheme;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
}) {
  return (
    <View style={styles.stack}>
      {/* Keep measured content and native controls mounted; the parent owns visibility. */}
      <SettingsPanel
        active={showSettingsPanel}
        readingOnly={readingOnly}
        settings={settings}
        styles={styles}
        theme={theme}
        onUpdateSettings={onUpdateSettings}
      />
    </View>
  );
}

function SettingsPanel({
  active,
  readingOnly,
  settings,
  styles,
  theme,
  onUpdateSettings
}: {
  active: boolean;
  readingOnly: boolean;
  settings: AppearanceSettings;
  styles: MoreScreenStyles;
  theme: ReaderTheme;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
}) {
  const [menu, setMenu] = useState<{ target: ReaderFontTarget; anchor: FontAnchor } | null>(null);
  const [selectionTarget, setSelectionTarget] = useState<ReaderFontTarget | null>(null);
  const [fontError, setFontError] = useState<{ target: ReaderFontTarget; message: string } | null>(null);
  const pending = useRef(false);
  const selectionOwner = useRef<AbortController | null>(null);
  const navigation = useContext(NavigationContext);
  const client = useQueryClient();
  const { data: importedFonts = [] } = useQuery({ ...localReaderFontCatalog, enabled: active });
  const { data: downloadState } = useQuery(readerFontDownload);
  const localFamilies = new Set(importedFonts.map((font) => font.family));
  const officialFamilies = new Set(downloadableReaderFonts.map((font) => font.family));
  const fontOptions: FontOption[] = [
    { value: 'app', label: BUILT_IN_READER_FONT_NAME, edition: BUILT_IN_READER_FONT_EDITION },
    { value: 'system', label: '跟随系统' },
    ...downloadableReaderFonts.map((font) => ({
      value: font.family,
      label: font.name,
      edition: font.edition,
      download: localFamilies.has(font.family) ? undefined : font
    })),
    ...importedFonts
      .filter((font) => !officialFamilies.has(font.family))
      .map((font) => ({ value: font.family, label: font.name }))
  ];

  useLayoutEffect(() => {
    const acquireOwner = () => {
      selectionOwner.current ??= new AbortController();
    };
    const releaseOwner = () => {
      selectionOwner.current?.abort();
      selectionOwner.current = null;
    };
    const clearFeedback = () => {
      setMenu(null);
      setFontError(null);
    };
    if (active && navigation?.isFocused() !== false) acquireOwner();
    if (!active) clearFeedback();
    if (!active || !navigation) return releaseOwner;
    const blur = () => {
      releaseOwner();
      clearFeedback();
    };
    navigation.addListener('focus', acquireOwner);
    navigation.addListener('blur', blur);
    return () => {
      navigation.removeListener('focus', acquireOwner);
      navigation.removeListener('blur', blur);
      releaseOwner();
    };
  }, [active, navigation]);

  const update = (patch: Partial<ReaderSettings>) => {
    if (selectionOwner.current) onUpdateSettings(patch);
  };
  const setFont = (target: ReaderFontTarget, family: ReaderFontFamily) => {
    setFontError((error) => (error?.target === target ? null : error));
    if (downloadState?.status === 'failed' && downloadState.target === target) {
      client.setQueryData(readerFontDownload.queryKey, (current) => (current === downloadState ? null : current));
    }
    update(target === 'interface' ? { uiFontFamily: family } : { fontFamily: family });
  };
  const openFontMenu = (target: ReaderFontTarget, trigger: View) => {
    const cycle = selectionOwner.current?.signal;
    if (!cycle || cycle.aborted) return;
    trigger.measureInWindow((x, y, width, height) => {
      if (!cycle.aborted && width > 0 && height > 0) {
        setMenu({ target, anchor: { x, y, width, height } });
      }
    });
  };
  const applyLocalFont = async (target: ReaderFontTarget, choice?: LocalReaderFontFamily | DownloadableReaderFont) => {
    const cycle = selectionOwner.current?.signal;
    if (!cycle || cycle.aborted || pending.current) return;
    const existing = typeof choice === 'string' ? choice : undefined;
    const download = typeof choice === 'object' ? choice : undefined;
    pending.current = true;
    setSelectionTarget(target);
    setFontError(null);
    try {
      let imported: LocalReaderFont | null = null;
      if (download) {
        const installed = await installReaderFont(client, download, target);
        if (installed && !cycle.aborted) setFont(target, installed.family);
        return;
      } else if (!existing) {
        imported = await pickLocalReaderFont();
      }
      const family = existing ?? imported?.family;
      if (!family) return;
      if (imported) {
        await rememberInstalledReaderFont(client, imported);
      } else {
        const registration = localReaderFontRegistration(family);
        if (
          !client.getQueryData(registration.queryKey) &&
          !(await client.fetchQuery({ ...registration, staleTime: 0 }))
        ) {
          throw new Error(
            officialFamilies.has(family) ? '无法使用这份字体，请重新安装。' : '无法使用这份字体，请重新导入。'
          );
        }
      }
      if (!cycle.aborted) setFont(target, family);
    } catch (error) {
      if (selectionOwner.current) setFontError({ target, message: errorMessage(error) });
    } finally {
      pending.current = false;
      setSelectionTarget(null);
    }
  };
  const renderFontControl = (target: ReaderFontTarget) => {
    const interfaceFont = target === 'interface';
    const anchor = active && menu?.target === target ? menu.anchor : undefined;
    const selecting = selectionTarget === target;
    const download = downloadState?.status === 'running' && downloadState.target === target ? downloadState : undefined;
    const downloadFailed =
      downloadState?.status === 'failed' && downloadState.target === target && !localFamilies.has(downloadState.family)
        ? downloadState
        : undefined;
    const localFailure = fontError?.target === target ? fontError : undefined;
    const failure = localFailure ?? downloadFailed;
    return (
      <>
        <FontDropdown
          active={active}
          title={interfaceFont ? '界面字体' : '阅读字体'}
          testID={`appearance-${target}-font-dropdown`}
          items={fontOptions}
          value={interfaceFont ? settings.uiFontFamily : settings.fontFamily}
          anchor={anchor}
          selecting={selecting}
          download={download}
          downloadInFlight={downloadState?.status === 'running'}
          failure={failure}
          disabled={selectionTarget !== null && !download}
          styles={styles}
          theme={theme}
          onOpen={(trigger) => openFontMenu(target, trigger)}
          onClose={() => setMenu((current) => (current?.target === target ? null : current))}
          onAddFont={() => {
            void applyLocalFont(target);
          }}
          onChange={(option) => {
            if (pending.current) return;
            if (isLocalReaderFontFamily(option.value)) void applyLocalFont(target, option.download ?? option.value);
            else setFont(target, option.value);
          }}
        />
        {failure && (!anchor || localFailure) ? (
          <Text accessibilityRole="alert" style={styles.appearanceError}>
            {failure.message}
          </Text>
        ) : null}
      </>
    );
  };
  return (
    <View style={styles.appearanceSettings}>
      {readingOnly ? null : (
        <>
          <ThemeSetting
            active={active}
            styles={styles}
            value={settings.theme}
            onChange={(theme) => update({ theme })}
          />
          <View style={styles.appearanceGroup}>
            <Text accessibilityRole="header" style={styles.appearanceGroupLabel}>
              界面
            </Text>
            {renderFontControl('interface')}
            <FontScaleSetting
              active={active}
              kind="interface"
              value={settings.uiFontScale ?? 1}
              styles={styles}
              theme={theme}
              onChange={(uiFontScale) => update({ uiFontScale })}
            />
            <SegmentedSetting
              active={active}
              styles={styles}
              title="列表密度"
              items={spacingOptions}
              value={settings.listDensity}
              onChange={(listDensity) => update({ listDensity })}
            />
            <View style={styles.appearanceChoiceRow}>
              <Text style={styles.appearanceSettingLabel}>显示未读圆点</Text>
              <AppSwitch
                testID="appearance-unread-dot-switch"
                accessibilityRole="switch"
                accessibilityLabel="显示未读圆点"
                disabled={!active}
                style={styles.appearanceSwitch}
                value={settings.showUnreadDot}
                onValueChange={(showUnreadDot) => update({ showUnreadDot })}
              />
            </View>
          </View>
        </>
      )}
      <View style={readingOnly ? undefined : styles.appearanceGroup}>
        {readingOnly ? null : (
          <Text accessibilityRole="header" style={styles.appearanceGroupLabel}>
            阅读
          </Text>
        )}
        {renderFontControl('reading')}
        <FontScaleSetting
          active={active}
          kind="reading"
          value={settings.fontScale}
          styles={styles}
          theme={theme}
          onChange={(fontScale) => update({ fontScale })}
        />
        <SegmentedSetting
          active={active}
          styles={styles}
          title="行距"
          items={spacingOptions}
          value={settings.lineHeight}
          onChange={(lineHeight) => update({ lineHeight })}
        />
        <SegmentedSetting
          active={active}
          styles={styles}
          title="正文宽度"
          items={[
            { value: 'narrow', label: '窄' },
            { value: 'standard', label: '标准' },
            { value: 'wide', label: '宽' }
          ]}
          value={settings.contentWidth}
          onChange={(contentWidth) => update({ contentWidth })}
        />
      </View>
    </View>
  );
}

function ThemeSetting({
  active,
  styles,
  value,
  onChange
}: {
  active: boolean;
  styles: MoreScreenStyles;
  value: ReaderSettings['theme'];
  onChange: (value: ReaderSettings['theme']) => void;
}) {
  return (
    <View style={[styles.appearanceChoiceRow, styles.appearanceInlineRow]}>
      <Text style={styles.appearanceSettingLabel}>主题</Text>
      <View style={styles.appearanceThemeChoices}>
        {themeOptions.map(({ value: mode, label, preview }) => {
          const checked = value === mode;
          return (
            <Pressable
              key={mode}
              accessibilityRole="radio"
              accessibilityLabel={`主题，${label}`}
              accessibilityState={{ checked }}
              disabled={!active}
              style={styles.appearanceThemeOption}
              onPress={() => {
                if (!checked) onChange(mode);
              }}
            >
              <View
                style={[
                  styles.appearanceThemeSwatch,
                  { backgroundColor: preview.surface },
                  checked && styles.appearanceThemeSwatchSelected
                ]}
              >
                {checked ? <Check size={16} color={preview.ink} accessible={false} /> : null}
              </View>
              <Text style={[styles.appearanceOptionLabel, checked && styles.appearanceOptionLabelSelected]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function SegmentedSetting<Value extends string>({
  active,
  items,
  styles,
  title,
  value,
  onChange
}: {
  active: boolean;
  items: readonly Option<Value>[];
  styles: MoreScreenStyles;
  title: string;
  value: Value;
  onChange: (value: Value) => void;
}) {
  return (
    <View style={[styles.appearanceChoiceRow, styles.appearanceInlineRow]}>
      <Text style={styles.appearanceSettingLabel}>{title}</Text>
      <View style={styles.appearanceSegments}>
        {items.map((item) => {
          const checked = value === item.value;
          return (
            <Pressable
              key={item.value}
              accessibilityRole="radio"
              accessibilityLabel={`${title}，${item.label}`}
              accessibilityState={{ checked }}
              disabled={!active}
              style={[styles.appearanceSegment, checked && styles.appearanceSegmentSelected]}
              onPress={() => {
                if (!checked) onChange(item.value);
              }}
            >
              <Text style={[styles.appearanceOptionLabel, checked && styles.appearanceOptionLabelSelected]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function FontDropdown({
  active,
  anchor,
  selecting,
  download,
  downloadInFlight,
  failure,
  disabled,
  items,
  styles,
  testID,
  theme,
  title,
  value,
  onAddFont,
  onChange,
  onClose,
  onOpen
}: {
  active: boolean;
  anchor?: FontAnchor;
  selecting: boolean;
  download?: { family: LocalReaderFontFamily; progress: ReaderFontDownloadProgress };
  downloadInFlight: boolean;
  failure?: FontFailure;
  disabled: boolean;
  items: readonly FontOption[];
  styles: MoreScreenStyles;
  testID: string;
  theme: ReaderTheme;
  title: string;
  value: ReaderFontFamily;
  onAddFont: () => void;
  onChange: (option: FontOption) => void;
  onClose: () => void;
  onOpen: (trigger: View) => void;
}) {
  const trigger = useRef<View>(null);
  const insets = useSafeAreaInsets();
  const busy = selecting || Boolean(download);
  const selected = items.find((item) => item.value === value && !item.download);
  const selectedLabel = selected?.label ?? `${BUILT_IN_READER_FONT_NAME}（所选字体不可用）`;
  const current = busy && !anchor ? (download ? fontProgressLabel(download.progress) : '正在载入字体…') : selectedLabel;
  return (
    <View style={[styles.appearanceChoiceRow, styles.appearanceFontSetting]}>
      <Text importantForAccessibility="no" style={styles.appearanceSettingLabel}>
        {title}
      </Text>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${title}，${current}`}
        accessibilityState={{ busy, expanded: Boolean(anchor) }}
        disabled={!active || disabled}
        style={[styles.appearanceFontField, disabled && styles.appearanceFontFieldDisabled]}
        onPress={() => {
          if (trigger.current) onOpen(trigger.current);
        }}
      >
        <View
          ref={trigger}
          collapsable={false}
          style={[styles.appearanceFontFieldControl, anchor && styles.appearanceFontFieldOpen]}
        >
          <Text numberOfLines={1} style={styles.appearanceFontFieldValue}>
            {current}
          </Text>
          <ChevronDown size={16} color={theme.muted} accessible={false} />
        </View>
      </Pressable>
      {anchor ? (
        <PopupMenu
          visible
          testID={`${testID}-menu-view`}
          accessibilityLabel={`关闭${title}选择`}
          onRequestClose={onClose}
          placementStyle={[styles.appearanceDropdown, fontMenuPlacement(anchor, insets)]}
        >
          <ScrollView
            testID={`${testID}-options`}
            style={styles.appearanceDropdownScroll}
            contentContainerStyle={styles.appearanceDropdownContent}
            overScrollMode="never"
          >
            {items.map((item) => (
              <FontMenuRow
                key={item.value}
                item={item}
                selected={item === selected}
                disabled={selecting || (downloadInFlight && Boolean(item.download))}
                progress={download?.family === item.value ? download.progress : undefined}
                error={failure?.family === item.value ? failure.message : undefined}
                styles={styles}
                theme={theme}
                onPress={() => {
                  if (!item.download) onClose();
                  onChange(item);
                }}
              />
            ))}
            <Divider />
            <Pressable
              testID="menu-item"
              accessibilityRole="menuitem"
              accessibilityLabel="新增字体"
              disabled={selecting}
              style={[
                styles.appearanceDropdownItem,
                styles.appearanceFontOptionLine,
                selecting && styles.appearanceFontFieldDisabled
              ]}
              onPress={() => {
                onClose();
                onAddFont();
              }}
            >
              <FilePlus2 size={16} color={theme.muted} accessible={false} />
              <Text style={styles.appearanceSettingLabel}>新增字体…</Text>
            </Pressable>
          </ScrollView>
        </PopupMenu>
      ) : null}
    </View>
  );
}

function fontMenuPlacement(anchor: FontAnchor, insets: EdgeInsets): ViewStyle {
  const viewport = Dimensions.get('window');
  const margin = 8;
  const gap = 6;
  const maxHeight = 336;
  const start = insets.left + margin;
  const end = viewport.width - insets.right - margin;
  const width = Math.min(272, end - start);
  const above = anchor.y - gap - insets.top - margin;
  const below = viewport.height - insets.bottom - margin - anchor.y - anchor.height - gap;
  const opensAbove = below < maxHeight && above > below;
  return {
    position: 'absolute',
    left: Math.max(start, Math.min(anchor.x + anchor.width, end) - width),
    width,
    maxHeight: Math.min(maxHeight, opensAbove ? above : below),
    ...(opensAbove ? { bottom: viewport.height - anchor.y + gap } : { top: anchor.y + anchor.height + gap })
  };
}

function fontProgressLabel(progress: ReaderFontDownloadProgress) {
  switch (progress.phase) {
    case 'connecting':
      return '正在连接…';
    case 'downloading':
      return `下载中 ${progress.percent}%`;
    case 'installing':
      return '正在安装…';
  }
}

function FontMenuRow({
  item,
  selected,
  disabled,
  progress,
  error,
  styles,
  theme,
  onPress
}: {
  item: FontOption;
  selected: boolean;
  disabled: boolean;
  progress?: ReaderFontDownloadProgress;
  error?: string;
  styles: MoreScreenStyles;
  theme: ReaderTheme;
  onPress: () => void;
}) {
  const action = progress ? fontProgressLabel(progress) : error ? '重试' : item.download ? '安装' : undefined;
  return (
    <Pressable
      testID="menu-item"
      accessibilityRole="menuitem"
      accessibilityLabel={action ? `${item.label}，${action}` : item.label}
      accessibilityHint={error}
      accessibilityState={{ selected, busy: Boolean(progress), disabled }}
      disabled={disabled}
      style={[
        styles.appearanceDropdownItem,
        selected && styles.appearanceFontOptionSelected,
        disabled && !progress && styles.appearanceFontFieldDisabled
      ]}
      onPress={onPress}
    >
      <View style={styles.appearanceFontOptionLine}>
        <View style={styles.appearanceFontTitles}>
          <Text style={styles.appearanceSettingLabel}>{item.label}</Text>
          {item.edition ? <Text style={styles.appearanceFontMeta}>{item.edition}</Text> : null}
        </View>
        {action ? (
          <View style={styles.appearanceFontAction}>
            {progress?.phase === 'installing' ? (
              <ActivityIndicator
                testID="appearance-font-installing"
                accessible={false}
                size={14}
                color={theme.primary}
              />
            ) : null}
            <Text style={[styles.appearanceFontMeta, styles.appearanceFontActionText]}>
              {progress?.phase === 'downloading' ? `${progress.percent}%` : action}
            </Text>
          </View>
        ) : selected ? (
          <Check size={18} color={theme.primary} accessible={false} />
        ) : null}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={styles.appearanceError}>
          {error}
        </Text>
      ) : null}
      {progress?.phase === 'downloading' ? (
        <ProgressBar
          testID="appearance-font-download-progress"
          progress={progress.percent / 100}
          color={theme.primary}
          style={styles.appearanceFontProgress}
        />
      ) : null}
    </Pressable>
  );
}

function FontScaleSetting({
  active,
  kind,
  styles,
  theme,
  value,
  onChange
}: {
  active: boolean;
  kind: 'interface' | 'reading';
  styles: MoreScreenStyles;
  theme: ReaderTheme;
  value: number;
  onChange: (value: number) => void;
}) {
  const [draftValue, setDraftValue] = useState(value);
  const percent = Math.round(draftValue * 100);
  const label = kind === 'interface' ? '界面字号' : '阅读字号';

  useEffect(() => {
    setDraftValue(value);
  }, [active, value]);

  const commit = (nextValue: number) => {
    if (!active) return;
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
        <Text style={styles.appearanceSettingLabel}>{label}</Text>
        <Text style={styles.appearanceFontScaleValue}>{percent}%</Text>
      </View>
      <View style={styles.appearanceSliderRow}>
        <IconButton
          label={'减小' + label}
          icon={Minus}
          iconOnly
          disabled={draftValue <= FONT_SCALE_MIN}
          onPress={() => setStep(-1)}
        />
        <Slider
          accessibilityLabel={label}
          accessibilityValue={{ min: 85, max: 140, now: percent, text: percent + '%' }}
          maximumValue={FONT_SCALE_MAX}
          maximumTrackTintColor={theme.lineStrong}
          minimumValue={FONT_SCALE_MIN}
          minimumTrackTintColor={theme.primary}
          step={FONT_SCALE_STEP}
          style={styles.appearanceSlider}
          testID={'appearance-' + kind + '-font-scale-slider'}
          thumbTintColor={theme.primaryStrong}
          value={draftValue}
          onSlidingComplete={commit}
          onTouchCancel={() => setDraftValue(value)}
          onValueChange={(nextValue) => {
            if (active) setDraftValue(normalizeFontScale(nextValue));
          }}
        />
        <IconButton
          label={'增大' + label}
          icon={Plus}
          iconOnly
          disabled={draftValue >= FONT_SCALE_MAX}
          onPress={() => setStep(1)}
        />
      </View>
    </View>
  );
}
