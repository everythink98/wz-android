import type { ComponentProps } from 'react';
import {
  StyleSheet,
  Switch,
  TextInput as NativeTextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle
} from 'react-native';
import { TextInput } from 'react-native-paper';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { fontFamilyValue, readerRadii, type ReaderStyleSettings, type ReaderTheme } from '@/ui/theme/tokens';

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderRadius: readerRadii.control },
    field: {
      color: theme.ink,
      fontFamily: fontFamilyValue(settings.fontFamily),
      fontSize: Math.round(14 * settings.fontScale),
      borderRadius: readerRadii.control
    },
    label: { fontSize: 16 * settings.fontScale }
  });
}

export function AppTextInput({
  style,
  inputStyle,
  variant = 'outlined',
  disabled,
  editable,
  theme: inputTheme,
  render: renderInput = (nativeProps) => <NativeTextInput {...nativeProps} />,
  ...props
}: Omit<ComponentProps<typeof TextInput>, 'style'> & {
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
}) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
  return (
    <View style={[styles.container, style]}>
      <TextInput
        {...props}
        variant={variant}
        label={props.label ?? props.accessibilityLabel}
        disabled={disabled || editable === false}
        editable={editable}
        theme={{ ...inputTheme, colors: { ...inputTheme?.colors, background: theme.surface } }}
        placeholderTextColor={theme.muted}
        style={[styles.field, styles.label, inputStyle]}
        render={(nativeProps) =>
          renderInput({
            ...nativeProps,
            style: [nativeProps.style, styles.field, inputStyle],
            'aria-label': props['aria-label'] ?? props.accessibilityLabel ?? nativeProps['aria-label'],
            accessibilityHint: props.accessibilityHint ?? nativeProps.accessibilityHint
          })
        }
      />
    </View>
  );
}

export function AppSwitch({
  onValueChange,
  disabled,
  ...props
}: Omit<ComponentProps<typeof Switch>, 'trackColor' | 'thumbColor' | 'ios_backgroundColor'>) {
  const { theme } = useReaderThemeStyles(createStyles);
  return (
    <Switch
      {...props}
      disabled={disabled}
      onValueChange={onValueChange}
      trackColor={{ false: theme.lineStrong, true: theme.primary }}
      thumbColor={theme.dark ? theme.ink : theme.surface}
      ios_backgroundColor={theme.lineStrong}
    />
  );
}
