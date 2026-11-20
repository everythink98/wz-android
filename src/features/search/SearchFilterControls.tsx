import { useRef } from 'react';
import { Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';
import { Check, ChevronRight, Search, X } from 'lucide-react-native';
import { recordUserInteraction } from '@/platform/network/userPresence';
import { IconButton } from '@/ui/controls/ButtonControls';
import type { ReaderTheme } from '@/ui/theme/tokens';
import type { SearchStyles } from './styles';

export type FilterAppearance = { styles: SearchStyles; theme: ReaderTheme };
export type FilterOption<Value extends string = string> = { value: Value; label: string };

export function FilterFieldRow({
  active,
  clear,
  error,
  field,
  label,
  styles,
  testID,
  theme,
  value,
  onPress
}: FilterAppearance & {
  active?: boolean;
  clear?: { label: string; onPress: () => void };
  error?: string;
  field: string;
  label: string;
  testID?: string;
  value: string;
  onPress: () => void;
}) {
  return (
    <>
      <View style={[styles.searchFilterRow, error && styles.searchFilterRowInvalid]}>
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={error}
          accessibilityValue={{ text: value }}
          style={styles.searchFilterRowMain}
          onPress={onPress}
        >
          <Text style={[styles.searchFilterLabel, styles.searchFilterLabelColumn]}>{field}</Text>
          <Text style={[styles.searchFilterValue, active && styles.searchFilterActiveText]}>{value}</Text>
          {!clear ? (
            <View style={styles.searchFilterTrailing}>
              <ChevronRight size={17} color={theme.muted} strokeWidth={1.8} accessible={false} />
            </View>
          ) : null}
        </Pressable>
        {clear ? (
          <IconButton ghost iconOnly iconSize={16} icon={X} label={clear.label} onPress={clear.onPress} />
        ) : null}
      </View>
      {error ? <FilterFieldError message={error} styles={styles} /> : null}
    </>
  );
}

export function FilterTextField({
  error,
  field,
  id,
  keyboardType,
  label = field,
  placeholder,
  styles,
  theme,
  value,
  onChange
}: FilterAppearance & {
  error?: string;
  field: string;
  id: string;
  keyboardType?: TextInputProps['keyboardType'];
  label?: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<TextInput>(null);
  return (
    <>
      <View style={[styles.searchFilterRow, error && styles.searchFilterRowInvalid]}>
        <View style={styles.searchFilterRowMain}>
          <Pressable
            accessible={false}
            focusable={false}
            importantForAccessibility="no-hide-descendants"
            style={[styles.searchFilterLabelColumn, styles.searchFilterInputLabel]}
            onPress={() => inputRef.current?.focus()}
          >
            <Text style={styles.searchFilterLabel}>{field}</Text>
          </Pressable>
          <TextInput
            ref={inputRef}
            testID={id}
            accessible
            accessibilityLabel={label}
            accessibilityHint={error}
            style={styles.searchFilterTextInput}
            value={value}
            onChange={recordUserInteraction}
            onChangeText={onChange}
            placeholder={placeholder}
            placeholderTextColor={theme.muted}
            underlineColorAndroid="transparent"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType={keyboardType}
            returnKeyType="done"
          />
        </View>
        {value ? (
          <IconButton ghost iconOnly iconSize={16} icon={X} label={`清除${label}`} onPress={() => onChange('')} />
        ) : (
          <View style={styles.searchFilterTrailing} />
        )}
      </View>
      {error ? <FilterFieldError message={error} styles={styles} /> : null}
    </>
  );
}

function FilterFieldError({ message, styles }: { message: string; styles: SearchStyles }) {
  return (
    <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.searchFilterFieldError}>
      {message}
    </Text>
  );
}

export function FilterSegments<Value extends string>({
  items,
  label,
  value,
  styles,
  onChange
}: FilterAppearance & {
  items: readonly FilterOption<Value>[];
  label: string;
  value: Value;
  onChange: (value: Value) => void;
}) {
  return (
    <View style={styles.searchFilterRow}>
      <Text style={[styles.searchFilterLabel, styles.searchFilterLabelColumn]}>{label}</Text>
      <View style={styles.searchFilterSegments}>
        {items.map((item, index) => {
          const selected = value === item.value;
          return (
            <Pressable
              key={item.value}
              accessibilityRole="radio"
              accessibilityLabel={item.label}
              accessibilityState={{ checked: selected }}
              style={[
                styles.searchFilterSegment,
                index > 0 && styles.searchFilterSegmentDivider,
                selected && styles.searchFilterOptionActive
              ]}
              onPress={() => onChange(item.value)}
            >
              <View style={styles.searchFilterSegmentMark}>
                {selected ? (
                  <Check size={14} color={styles.searchFilterActiveText.color} strokeWidth={2} accessible={false} />
                ) : null}
              </View>
              <Text style={[styles.searchFilterSegmentText, selected && styles.searchFilterActiveText]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function FilterOptionRow({
  checked,
  detail,
  label,
  role = 'radio',
  styles,
  testID,
  title = label,
  onPress
}: FilterAppearance & {
  checked: boolean;
  detail?: string;
  label: string;
  role?: 'radio' | 'checkbox';
  testID?: string;
  title?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      accessibilityValue={detail ? { text: detail } : undefined}
      style={[styles.searchFilterRow, checked && styles.searchFilterOptionActive]}
      onPress={onPress}
    >
      <View style={styles.searchFilterOptionCopy}>
        <Text style={[styles.searchFilterLabel, checked && styles.searchFilterActiveText]}>{title}</Text>
        {detail ? <Text style={styles.searchFilterDetail}>{detail}</Text> : null}
      </View>
      <View style={styles.searchFilterTrailing}>
        {checked ? (
          <Check size={18} color={styles.searchFilterActiveText.color} strokeWidth={2} accessible={false} />
        ) : role === 'checkbox' ? (
          <View style={styles.searchFilterUnchecked} />
        ) : null}
      </View>
    </Pressable>
  );
}

export function FilterCandidateInput({
  id,
  label,
  styles,
  theme,
  value,
  onChange
}: FilterAppearance & {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.searchFilterCandidateInput}>
      <Search size={17} strokeWidth={1.8} color={theme.muted} accessible={false} />
      <TextInput
        testID={id}
        accessible
        accessibilityLabel={label}
        style={styles.searchFilterTextInput}
        value={value}
        onChange={recordUserInteraction}
        onChangeText={onChange}
        placeholder={label}
        placeholderTextColor={theme.muted}
        underlineColorAndroid="transparent"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />
      {value ? (
        <IconButton ghost iconOnly iconSize={16} icon={X} label={`清空${label}`} onPress={() => onChange('')} />
      ) : null}
    </View>
  );
}
