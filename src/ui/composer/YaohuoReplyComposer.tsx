import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { ScrollView as GestureScrollView } from 'react-native-gesture-handler';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { AppButton } from '@/ui/controls/ButtonControls';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { alphaColor, fontFamilyValue, type ReaderTheme } from '@/ui/theme/tokens';
import { YAOHUO_FACE_ITEMS } from './expressionCatalogs';

type FormatAction = 'bold' | 'italic' | 'link' | 'image' | 'quote' | 'code' | 'list';
type Selection = { start: number; end: number };

const FORMAT_ACTIONS: readonly { action: FormatAction; label: string }[] = [
  { action: 'bold', label: 'B' },
  { action: 'italic', label: 'I' },
  { action: 'link', label: '链接' },
  { action: 'image', label: '图片' },
  { action: 'quote', label: '引用' },
  { action: 'code', label: '代码' },
  { action: 'list', label: '列表' }
];

function selectedText(content: string, selection: Selection) {
  const start = Math.max(0, Math.min(selection.start, content.length));
  const end = Math.max(start, Math.min(selection.end, content.length));
  return content.slice(start, end);
}

function replaceSelection(content: string, selection: Selection, value: string) {
  const start = Math.max(0, Math.min(selection.start, content.length));
  const end = Math.max(start, Math.min(selection.end, content.length));
  return `${content.slice(0, start)}${value}${content.slice(end)}`;
}

function formatUbb(action: FormatAction, text: string) {
  switch (action) {
    case 'bold':
      return `[b]${text || '粗体'}[/b]`;
    case 'italic':
      return `[i]${text || '斜体'}[/i]`;
    case 'link':
      return `[url=https://]${text || '链接文字'}[/url]`;
    case 'image':
      return `[img]${text || 'https://'}[/img]`;
    case 'quote':
      return `[quote]${text || '引用内容'}[/quote]`;
    case 'code':
      return `[code]${text || '代码'}[/code]`;
    case 'list':
      return `[list]\n[*]${text || '列表项'}\n[/list]`;
  }
}

function createStyles(theme: ReaderTheme, settings: ReaderSettings) {
  const fontFamily = fontFamilyValue(settings.fontFamily);
  const scaled = (value: number) => Math.round(value * settings.fontScale);
  const neutral = theme.dark ? '#ffffff' : '#000000';
  const neutralSurface = alphaColor(neutral, theme.dark ? 0.06 : 0.035);
  const neutralBorder = alphaColor(neutral, theme.dark ? 0.12 : 0.09);
  return StyleSheet.create({
    composer: { gap: 10, paddingHorizontal: 16, paddingTop: 14, width: '100%' },
    title: { color: theme.ink, fontFamily, fontSize: scaled(15), fontWeight: '600' },
    toolbar: {
      backgroundColor: neutralSurface,
      borderColor: neutralBorder,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      minHeight: 48,
      width: '100%'
    },
    toolbarContent: { alignItems: 'center', flexDirection: 'row', gap: 6, padding: 6 },
    selectedFace: {
      alignSelf: 'flex-start',
      backgroundColor: neutralSurface,
      borderRadius: 999,
      color: theme.ink,
      fontFamily,
      fontSize: scaled(12),
      fontWeight: '700',
      lineHeight: scaled(18),
      paddingHorizontal: 9,
      paddingVertical: 3
    },
    facePanel: {
      backgroundColor: neutralSurface,
      borderColor: neutralBorder,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      maxHeight: 238
    },
    faceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 10 },
    faceChip: {
      alignItems: 'center',
      backgroundColor: theme.surface,
      borderColor: neutralBorder,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      justifyContent: 'center',
      minHeight: 44,
      paddingHorizontal: 10,
      paddingVertical: 7
    },
    faceChipActive: { backgroundColor: theme.mist, borderColor: theme.primary },
    faceText: { color: theme.ink, fontFamily, fontSize: scaled(12), fontWeight: '500' },
    input: {
      backgroundColor: theme.surface,
      borderColor: neutralBorder,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      color: theme.ink,
      fontFamily,
      fontSize: scaled(14),
      lineHeight: scaled(21),
      maxHeight: 180,
      minHeight: 92,
      paddingHorizontal: 12,
      paddingVertical: 9,
      textAlignVertical: 'top'
    },
    actions: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
    disabled: { opacity: 0.45 },
    disabledReason: { color: theme.muted, fontFamily, fontSize: scaled(12), lineHeight: scaled(18) },
    error: { color: theme.danger, fontFamily, fontSize: scaled(12), lineHeight: scaled(18) },
    status: { color: theme.muted, fontFamily, fontSize: scaled(12), lineHeight: scaled(18) }
  });
}

type InputHandle = {
  blur: () => void;
  focus: () => void;
  setNativeProps: (props: { selection?: Selection }) => void;
};

export function YaohuoReplyComposer({
  actionBusy,
  closeLabel = '收起回复',
  content,
  disabledReason,
  error,
  face = '',
  focusSignal,
  format = 'ubb',
  inputAccessibilityLabel,
  placeholder = '输入回复内容',
  status,
  submitLabel = '发送回复',
  title = '回复',
  onContentChange,
  onFaceChange = () => undefined,
  onOpenChange,
  onSubmit,
  onUploadImage
}: {
  actionBusy: boolean;
  closeLabel?: string;
  content: string;
  disabledReason?: string;
  error?: string;
  face?: string;
  focusSignal?: number;
  format?: 'ubb' | 'plain-text';
  inputAccessibilityLabel?: string;
  placeholder?: string;
  status?: string;
  submitLabel?: string;
  title?: string;
  onContentChange: (value: string) => void;
  onFaceChange?: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
  onUploadImage?: () => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
  const inputRef = useRef<InputHandle | null>(null);
  const contentRef = useCommittedRef(content);
  const selectionRef = useRef<Selection>({ start: content.length, end: content.length });
  const [selection, setSelection] = useState(selectionRef.current);
  const [facePanelOpen, setFacePanelOpen] = useState(false);
  const selectedFaceLabel = YAOHUO_FACE_ITEMS.find((item) => item.value === face)?.label;
  const toolbarActions = FORMAT_ACTIONS.filter((item) => item.action !== 'image' || Boolean(onUploadImage));

  const updateSelection = useCallback((next: Selection) => {
    selectionRef.current = next;
    setSelection(next);
  }, []);
  const focusAtSelection = useCallback((next?: Selection) => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      if (next) inputRef.current?.setNativeProps({ selection: next });
    });
  }, []);
  const changeContent = useCallback(
    (value: string) => {
      contentRef.current = value;
      onContentChange(value);
    },
    [contentRef, onContentChange]
  );
  const applyFormat = (action: FormatAction) => {
    setFacePanelOpen(false);
    if (action === 'image' && onUploadImage) {
      onUploadImage();
      return;
    }
    const replacement = formatUbb(action, selectedText(contentRef.current, selectionRef.current));
    const next = replaceSelection(contentRef.current, selectionRef.current, replacement);
    const cursor = selectionRef.current.start + replacement.length;
    changeContent(next);
    updateSelection({ start: cursor, end: cursor });
    focusAtSelection({ start: cursor, end: cursor });
  };

  useEffect(() => {
    const end = Math.min(selectionRef.current.end, content.length);
    updateSelection({ start: Math.min(selectionRef.current.start, end), end });
  }, [content.length, updateSelection]);
  useEffect(() => {
    if (focusSignal) focusAtSelection();
  }, [focusAtSelection, focusSignal]);
  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidHide', () => inputRef.current?.blur());
    return () => subscription.remove();
  }, []);

  return (
    <View style={styles.composer}>
      <Text style={styles.title}>{title}</Text>
      {format === 'ubb' ? (
        <GestureScrollView
          testID="yaohuo-reply-composer-toolbar"
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={styles.toolbar}
          contentContainerStyle={styles.toolbarContent}
        >
          <AppButton
            compact
            label="表情"
            variant={facePanelOpen ? 'primary' : 'ghost'}
            disabled={actionBusy}
            onPress={() => {
              const next = !facePanelOpen;
              if (next) {
                inputRef.current?.blur();
                Keyboard.dismiss();
              }
              setFacePanelOpen(next);
            }}
          />
          {toolbarActions.map((item) => (
            <AppButton
              key={item.action}
              compact
              label={item.label}
              variant="ghost"
              disabled={actionBusy}
              onPress={() => applyFormat(item.action)}
            />
          ))}
        </GestureScrollView>
      ) : null}
      {face && selectedFaceLabel ? <Text style={styles.selectedFace}>表情：{selectedFaceLabel}</Text> : null}
      {disabledReason ? <Text style={styles.disabledReason}>{disabledReason}</Text> : null}
      {error ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {status ? (
        <Text accessibilityLiveRegion="polite" style={styles.status}>
          {status}
        </Text>
      ) : null}
      {facePanelOpen ? (
        <GestureScrollView
          nestedScrollEnabled
          style={styles.facePanel}
          contentContainerStyle={styles.faceGrid}
          keyboardShouldPersistTaps="handled"
        >
          {YAOHUO_FACE_ITEMS.map((item) => (
            <Pressable
              key={item.value || 'empty'}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              disabled={actionBusy}
              style={[styles.faceChip, item.value === face && styles.faceChipActive, actionBusy && styles.disabled]}
              onPress={() => {
                onFaceChange(item.value);
                setFacePanelOpen(false);
              }}
            >
              <Text style={styles.faceText}>{item.label}</Text>
            </Pressable>
          ))}
        </GestureScrollView>
      ) : null}
      <BottomSheetTextInput
        ref={(node) => {
          inputRef.current = node ? (node as InputHandle) : null;
        }}
        accessibilityLabel={inputAccessibilityLabel}
        editable={!actionBusy && !disabledReason}
        multiline
        scrollEnabled
        style={styles.input}
        value={content}
        selection={selection}
        placeholder={placeholder}
        placeholderTextColor={theme.muted}
        cursorColor={theme.primary}
        selectionColor={theme.primary}
        onChangeText={changeContent}
        onFocus={() => setFacePanelOpen(false)}
        onSelectionChange={(event) => updateSelection(event.nativeEvent.selection)}
      />
      <View style={styles.actions}>
        <AppButton label={closeLabel} variant="ghost" disabled={actionBusy} onPress={() => onOpenChange(false)} />
        <AppButton
          label={submitLabel}
          variant={content.trim() ? 'primary' : 'default'}
          disabled={actionBusy || Boolean(disabledReason) || !content.trim()}
          onPress={onSubmit}
        />
      </View>
    </View>
  );
}
