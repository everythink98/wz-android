import { recordUserInteraction } from '@/platform/network/userPresence';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, IconButton as PaperIconButton } from 'react-native-paper';
import type { LucideIcon } from 'lucide-react-native';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import {
  type ReaderStyleSettings,
  alphaColor,
  fontFamilyValue,
  readerRadii,
  type ReaderTheme
} from '@/ui/theme/tokens';
import { TOUCH_HIT_SLOP } from './touchTarget';

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const fontSize = (size: number) => Math.round(size * settings.fontScale);
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
      borderColor: theme.lineStrong,
      backgroundColor: theme.surface
    },
    content: { minHeight: 48, paddingHorizontal: 12 },
    compactContent: { minHeight: 40, paddingHorizontal: 8 },
    iconContent: { columnGap: 6, paddingLeft: 6 },
    compactIconContent: { paddingLeft: 2 },
    iconOnly: { width: 48, height: 48, margin: 0, borderRadius: 0, backgroundColor: 'transparent' },
    tiny: { alignSelf: 'flex-start', backgroundColor: theme.mist, borderColor: 'transparent' },
    ghost: { backgroundColor: 'transparent', borderColor: 'transparent' },
    danger: {
      backgroundColor: alphaColor(theme.danger, theme.dark ? 0.12 : 0.045),
      borderColor: alphaColor(theme.danger, 0.2)
    },
    primary: { backgroundColor: theme.mist, borderColor: alphaColor(theme.primary, 0.22) },
    active: { backgroundColor: theme.mist, borderColor: 'transparent' },
    disabled: { opacity: 0.45 },
    text: {
      fontFamily: fontFamilyValue(settings.fontFamily),
      fontSize: fontSize(13),
      fontWeight: '500',
      lineHeight: fontSize(18),
      includeFontPadding: false,
      letterSpacing: 0,
      marginHorizontal: 0,
      marginVertical: 10
    },
    textCompact: { fontSize: fontSize(12), lineHeight: fontSize(16), marginVertical: 8 },
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
      accessibilityLabel={label}
      accessibilityState={state}
      disabled={state.disabled}
      loading={loading}
      mode="text"
      compact
      icon={icon}
      textColor={labelColor}
      hitSlop={TOUCH_HIT_SLOP}
      style={[
        styles.button,
        ghost && styles.ghost,
        tiny && styles.tiny,
        active && styles.active,
        disabled && styles.disabled
      ]}
      contentStyle={[
        styles.content,
        (compact || tiny) && styles.compactContent,
        styles.iconContent,
        (compact || tiny) && styles.compactIconContent
      ]}
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
  label,
  testID,
  tiny = false,
  variant = 'default',
  onPress
}: {
  accessibilityLabel?: string;
  backdrop?: ReactNode;
  compact?: boolean;
  disabled?: boolean;
  label: string;
  testID?: string;
  tiny?: boolean;
  variant?: 'default' | 'danger' | 'ghost' | 'primary';
  onPress: () => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
  const color =
    variant === 'danger'
      ? theme.danger
      : variant === 'primary'
        ? theme.dark
          ? theme.primary
          : theme.primaryStrong
        : theme.ink;
  const button = (
    <Button
      testID={testID}
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      mode="text"
      compact
      textColor={color}
      hitSlop={TOUCH_HIT_SLOP}
      style={[
        styles.button,
        tiny && styles.tiny,
        variant === 'ghost' && styles.ghost,
        variant === 'primary' && styles.primary,
        variant === 'danger' && styles.danger,
        backdrop ? styles.transparent : undefined,
        disabled && styles.disabled
      ]}
      contentStyle={[styles.content, (compact || tiny) && styles.compactContent]}
      labelStyle={[styles.text, (compact || tiny) && styles.textCompact, { color }]}
      onPress={() => {
        recordUserInteraction();
        onPress();
      }}
    >
      {label}
    </Button>
  );
  return backdrop ? (
    <View style={styles.backdrop}>
      {backdrop}
      {button}
    </View>
  ) : (
    button
  );
}
