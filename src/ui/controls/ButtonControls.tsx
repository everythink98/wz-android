import { recordUserInteraction } from '@/platform/network/userPresence';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, IconButton as PaperIconButton } from 'react-native-paper';
import type { LucideIcon } from 'lucide-react-native';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import {
  createReaderFontSizer,
  type ReaderStyleSettings,
  alphaColor,
  fontFamilyValue,
  readerRadii,
  type ReaderTheme
} from '@/ui/theme/tokens';
import { COMPACT_BUTTON_HIT_SLOP, TOUCH_HIT_SLOP } from './touchTarget';

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const fontSize = createReaderFontSizer(settings);
  return StyleSheet.create({
    floating: {
      width: 52,
      height: 52,
      margin: 0,
      borderRadius: readerRadii.pill,
      backgroundColor: theme.dark ? theme.primary : theme.primaryStrong,
      borderColor: alphaColor(theme.primary, 0.22),
      borderWidth: StyleSheet.hairlineWidth,
      elevation: 3,
      shadowColor: theme.primaryStrong,
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.16,
      shadowRadius: 8
    },
    button: {
      borderRadius: readerRadii.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: alphaColor(theme.ink, theme.dark ? 0.09 : 0.06),
      backgroundColor: theme.surface2
    },
    content: { minHeight: 36, paddingHorizontal: 15 },
    largeContent: { minHeight: 42, paddingHorizontal: 18 },
    compactContent: { minHeight: 32, paddingHorizontal: 13 },
    iconContent: { columnGap: 6 },
    iconOnly: { width: 48, height: 48, margin: 0, borderRadius: 0, backgroundColor: 'transparent' },
    tiny: { alignSelf: 'flex-start', backgroundColor: theme.mist, borderColor: 'transparent' },
    ghost: { backgroundColor: 'transparent', borderColor: 'transparent' },
    danger: {
      backgroundColor: alphaColor(theme.danger, theme.dark ? 0.16 : 0.09),
      borderColor: 'transparent'
    },
    primary: {
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.16 : 0.1),
      borderColor: 'transparent'
    },
    solid: {
      backgroundColor: theme.dark ? theme.primary : theme.primaryStrong,
      borderColor: 'transparent'
    },
    active: { backgroundColor: theme.mist, borderColor: 'transparent' },
    disabled: { opacity: 0.5 },
    disabledNeutral: { backgroundColor: theme.surface2, borderColor: 'transparent', opacity: 0.78 },
    loadingBusy: { opacity: 0.88 },
    text: {
      fontFamily: fontFamilyValue(settings.fontFamily),
      fontSize: fontSize(13),
      fontWeight: '500',
      lineHeight: fontSize(18),
      includeFontPadding: false,
      letterSpacing: 0,
      marginHorizontal: 0,
      marginVertical: 0
    },
    textEmphasis: { fontWeight: '600' },
    textLarge: { fontSize: fontSize(14), lineHeight: fontSize(20), fontWeight: '600' },
    textCompact: { fontSize: fontSize(12), lineHeight: fontSize(16), marginVertical: 0 },
    iconSlot: { alignItems: 'center', justifyContent: 'center', marginLeft: -6 },
    backdrop: { borderRadius: readerRadii.control, overflow: 'hidden' },
    floatingBackdrop: { width: 52, height: 52, borderRadius: readerRadii.pill, overflow: 'hidden' },
    transparent: { backgroundColor: 'transparent' }
  });
}

export function FloatingIconButton({
  backdrop,
  disabled = false,
  icon: Icon,
  label,
  loading = false,
  onPress
}: {
  backdrop?: ReactNode;
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  loading?: boolean;
  onPress: () => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
  const color = backdrop ? (theme.dark ? theme.primary : theme.primaryStrong) : theme.onPrimary;
  const button = (
    <PaperIconButton
      collapsableChildren={false}
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      loading={loading}
      icon={({ size, color }) => <Icon size={size} color={color} strokeWidth={1.8} accessible={false} />}
      iconColor={color}
      size={22}
      style={[styles.floating, backdrop ? styles.transparent : undefined]}
      onPress={() => {
        recordUserInteraction();
        onPress();
      }}
    />
  );
  return backdrop ? (
    <View style={styles.floatingBackdrop}>
      {backdrop}
      {button}
    </View>
  ) : (
    button
  );
}

export function IconButton({
  active = false,
  activeColor,
  compact = false,
  disabled = false,
  ghost = false,
  iconOnly = false,
  icon: Icon,
  iconSize,
  label,
  loading = false,
  testID,
  tiny = false,
  onPress
}: {
  active?: boolean;
  activeColor?: string;
  compact?: boolean;
  disabled?: boolean;
  ghost?: boolean;
  iconOnly?: boolean;
  icon: LucideIcon;
  iconSize?: number;
  label: string;
  loading?: boolean;
  testID?: string;
  tiny?: boolean;
  onPress: () => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
  const color = active ? activeColor || theme.primary : theme.ink;
  const labelColor = active ? theme.primary : tiny ? theme.muted : theme.ink;
  const size = iconSize ?? (tiny ? 16 : iconOnly ? 20 : 18);
  const press = () => {
    recordUserInteraction();
    onPress();
  };
  const state = { disabled: disabled || loading, selected: active, busy: loading };
  const icon = () => (
    <Icon size={size} color={color} fill={active ? color : 'none'} strokeWidth={1.8} accessible={false} />
  );
  if (iconOnly)
    return (
      <PaperIconButton
        testID={testID}
        collapsableChildren={false}
        accessibilityLabel={label}
        accessibilityState={state}
        disabled={state.disabled}
        loading={loading}
        icon={icon}
        iconColor={color}
        size={size}
        hitSlop={TOUCH_HIT_SLOP}
        style={[styles.iconOnly, disabled && styles.disabled]}
        onPress={press}
      />
    );
  return (
    <Button
      testID={testID}
      collapsableChildren={false}
      accessibilityLabel={label}
      accessibilityState={state}
      disabled={state.disabled}
      loading={loading}
      mode="text"
      compact
      icon={icon}
      textColor={labelColor}
      hitSlop={compact || tiny ? COMPACT_BUTTON_HIT_SLOP : TOUCH_HIT_SLOP}
      style={[
        styles.button,
        tiny && styles.tiny,
        ghost && styles.ghost,
        active && styles.active,
        disabled && styles.disabled
      ]}
      contentStyle={[styles.content, (compact || tiny) && styles.compactContent, styles.iconContent]}
      labelStyle={[styles.text, (compact || tiny) && styles.textCompact, { color: labelColor }]}
      onPress={press}
    >
      {label}
    </Button>
  );
}

export function AppButton({
  accessibilityLabel,
  backdrop,
  compact = false,
  disabled = false,
  icon: Icon,
  label,
  loading = false,
  minWidth,
  size = 'md',
  testID,
  tiny = false,
  variant = 'default',
  onPress
}: {
  accessibilityLabel?: string;
  backdrop?: ReactNode;
  compact?: boolean;
  disabled?: boolean;
  icon?: LucideIcon;
  label: string;
  loading?: boolean;
  minWidth?: number;
  size?: 'md' | 'lg';
  testID?: string;
  tiny?: boolean;
  variant?: 'default' | 'danger' | 'ghost' | 'primary' | 'solid';
  onPress: () => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
  const isDisabled = disabled || loading;
  const mutedDisabled = disabled && !loading && !backdrop && (variant === 'solid' || variant === 'primary');
  const color = mutedDisabled
    ? theme.muted
    : variant === 'solid'
      ? theme.onPrimary
      : variant === 'danger'
        ? theme.danger
        : variant === 'primary'
          ? theme.dark
            ? theme.primary
            : theme.primaryStrong
          : theme.ink;
  const iconSize = compact || tiny ? 14 : size === 'lg' ? 17 : 15;
  const hasLeading = Boolean(Icon || loading);
  const button = (
    <Button
      testID={testID}
      collapsableChildren={false}
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      icon={
        hasLeading
          ? () => (
              <View style={[styles.iconSlot, { width: iconSize, height: iconSize }]}>
                {loading ? (
                  <ActivityIndicator accessible={false} size={iconSize} color={color} />
                ) : Icon ? (
                  <Icon size={iconSize} color={color} strokeWidth={1.8} accessible={false} />
                ) : null}
              </View>
            )
          : undefined
      }
      mode="text"
      compact
      textColor={color}
      hitSlop={compact || tiny ? COMPACT_BUTTON_HIT_SLOP : TOUCH_HIT_SLOP}
      style={[
        styles.button,
        minWidth !== undefined ? { minWidth } : undefined,
        tiny && styles.tiny,
        variant === 'primary' && styles.primary,
        variant === 'solid' && styles.solid,
        variant === 'danger' && styles.danger,
        variant === 'ghost' && styles.ghost,
        backdrop ? styles.transparent : undefined,
        mutedDisabled ? styles.disabledNeutral : loading ? styles.loadingBusy : isDisabled && styles.disabled
      ]}
      contentStyle={[
        styles.content,
        size === 'lg' && styles.largeContent,
        (compact || tiny) && styles.compactContent,
        hasLeading && styles.iconContent
      ]}
      labelStyle={[
        styles.text,
        (variant === 'solid' || variant === 'primary') && styles.textEmphasis,
        size === 'lg' && styles.textLarge,
        (compact || tiny) && styles.textCompact,
        { color }
      ]}
      onPress={() => {
        recordUserInteraction();
        onPress();
      }}
    >
      {label}
    </Button>
  );
  return backdrop ? (
    <View>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop]}>
        {backdrop}
      </View>
      {button}
    </View>
  ) : (
    button
  );
}
