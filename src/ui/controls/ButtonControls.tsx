import { recordUserInteraction } from '@/platform/network/userPresence';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { ActivityIndicator, IconButton as PaperIconButton, TouchableRipple } from 'react-native-paper';
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
      borderColor: alphaColor(theme.ink, theme.dark ? 0.16 : 0.1),
      borderWidth: StyleSheet.hairlineWidth,
      elevation: 2,
      shadowColor: theme.primaryStrong,
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.12,
      shadowRadius: 8
    },
    button: {
      minWidth: 36,
      flexShrink: 1,
      borderRadius: readerRadii.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: alphaColor(theme.ink, theme.dark ? 0.16 : 0.1),
      backgroundColor: theme.surface2
    },
    content: {
      minHeight: 36,
      paddingHorizontal: 15,
      paddingVertical: 5,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6
    },
    largeContent: { minHeight: 42, paddingHorizontal: 18 },
    compactContent: { minHeight: 32, paddingHorizontal: 13 },
    trailingIconContent: { flexDirection: 'row-reverse' },
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
    disabledNeutral: { backgroundColor: theme.surface2 },
    text: {
      fontFamily: fontFamilyValue(settings.fontFamily),
      fontSize: fontSize(13),
      fontWeight: '500',
      lineHeight: fontSize(18),
      includeFontPadding: false,
      letterSpacing: 0,
      flexShrink: 1,
      textAlign: 'center'
    },
    textEmphasis: { fontWeight: '600' },
    textLarge: { fontSize: fontSize(14), lineHeight: fontSize(20), fontWeight: '600' },
    textCompact: { fontSize: fontSize(12), lineHeight: fontSize(16), marginVertical: 0 },
    iconSlot: { alignItems: 'center', justifyContent: 'center' },
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
  const color = active ? activeColor || (theme.dark ? theme.primary : theme.primaryStrong) : theme.ink;
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
        style={[styles.iconOnly, disabled && styles.disabled]}
        onPress={press}
      />
    );
  return (
    <TextButton
      testID={testID}
      label={label}
      icon={Icon}
      iconSize={size}
      activeColor={activeColor}
      selected={active}
      disabled={disabled}
      loading={loading}
      compact={compact}
      tiny={tiny}
      variant={ghost ? 'ghost' : 'default'}
      onPress={onPress}
    />
  );
}

type AppButtonProps = {
  accessibilityHint?: string;
  accessibilityLabel?: string;
  backdrop?: ReactNode;
  compact?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  icon?: LucideIcon;
  label: string;
  loading?: boolean;
  minWidth?: number;
  selected?: boolean;
  size?: 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
  testID?: string;
  tiny?: boolean;
  trailingIcon?: boolean;
  variant?: 'default' | 'danger' | 'ghost' | 'primary' | 'solid';
  onPress: () => void;
};

export function AppButton(props: AppButtonProps) {
  return <TextButton {...props} />;
}

function TextButton({
  accessibilityHint,
  accessibilityLabel,
  activeColor,
  backdrop,
  compact = false,
  disabled = false,
  expanded,
  icon: Icon,
  iconSize,
  label,
  loading,
  minWidth,
  selected,
  size = 'md',
  style,
  testID,
  tiny = false,
  trailingIcon = false,
  variant = 'default',
  onPress
}: AppButtonProps & { activeColor?: string; iconSize?: number }) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
  const busy = loading === true;
  const isDisabled = disabled || busy;
  const mutedDisabled = disabled && !busy;
  const accent = theme.dark ? theme.primary : theme.primaryStrong;
  const color =
    mutedDisabled || (tiny && variant === 'default' && !selected)
      ? theme.muted
      : variant === 'solid'
        ? theme.onPrimary
        : variant === 'danger'
          ? theme.danger
          : variant === 'primary' || selected
            ? accent
            : theme.ink;
  const glyphSize = iconSize ?? (compact || tiny ? 14 : size === 'lg' ? 17 : 15);
  const glyphColor = selected && activeColor && !mutedDisabled ? activeColor : color;
  const button = (
    <TouchableRipple
      testID={testID}
      collapsableChildren={false}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy, selected, expanded }}
      disabled={isDisabled}
      hitSlop={compact || tiny ? COMPACT_BUTTON_HIT_SLOP : TOUCH_HIT_SLOP}
      style={[
        styles.button,
        minWidth !== undefined ? { minWidth } : undefined,
        tiny && styles.tiny,
        variant === 'primary' && styles.primary,
        variant === 'solid' && styles.solid,
        variant === 'danger' && styles.danger,
        variant === 'ghost' && styles.ghost,
        selected && styles.active,
        mutedDisabled &&
          (variant === 'solid' || variant === 'primary' || variant === 'danger') &&
          styles.disabledNeutral,
        backdrop ? styles.transparent : undefined,
        style
      ]}
      onPress={() => {
        recordUserInteraction();
        onPress();
      }}
    >
      <View
        style={[
          styles.content,
          size === 'lg' && styles.largeContent,
          (compact || tiny) && styles.compactContent,
          trailingIcon && styles.trailingIconContent
        ]}
      >
        {Icon || loading !== undefined ? (
          <View style={[styles.iconSlot, { width: glyphSize, height: glyphSize }]}>
            {busy ? (
              <ActivityIndicator accessible={false} size={glyphSize} color={color} />
            ) : Icon ? (
              <Icon
                size={glyphSize}
                color={glyphColor}
                fill={selected ? glyphColor : 'none'}
                strokeWidth={1.8}
                accessible={false}
              />
            ) : null}
          </View>
        ) : null}
        <Text
          style={[
            styles.text,
            (variant === 'solid' || variant === 'primary') && styles.textEmphasis,
            size === 'lg' && styles.textLarge,
            (compact || tiny) && styles.textCompact,
            { color }
          ]}
        >
          {label}
        </Text>
      </View>
    </TouchableRipple>
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
