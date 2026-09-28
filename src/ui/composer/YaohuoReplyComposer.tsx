import { recordUserInteraction } from '@/platform/network/userPresence';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ScrollView as GestureScrollView } from 'react-native-gesture-handler';
import {
  Bold,
  Code,
  ImagePlus,
  Italic,
  Keyboard as KeyboardIcon,
  Link,
  List,
  Quote,
  Smile,
  Type,
  type LucideIcon
} from 'lucide-react-native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { AppButton, IconButton } from '@/ui/controls/ButtonControls';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { alphaColor, fontFamilyValue, type ReaderTheme } from '@/ui/theme/tokens';
import { YAOHUO_FACE_ITEMS, yaohuoFaceImageUrl } from './expressionCatalogs';

type FormatAction = 'bold' | 'italic' | 'link' | 'image' | 'quote' | 'code' | 'list';
type Selection = { start: number; end: number };

const FORMAT_ACTIONS: readonly { action: FormatAction; label: string; icon: LucideIcon }[] = [
  { action: 'bold', label: '粗体', icon: Bold },
  { action: 'italic', label: '斜体', icon: Italic },
  { action: 'link', label: '链接', icon: Link },
  { action: 'image', label: '图片', icon: ImagePlus },
  { action: 'quote', label: '引用', icon: Quote },
  { action: 'code', label: '代码', icon: Code },
  { action: 'list', label: '列表', icon: List }
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
    embedded: { flex: 1, minHeight: 0, gap: 0, paddingHorizontal: 0, paddingTop: 0 },
    embeddedInput: { flex: 1, maxHeight: undefined, borderRadius: 0, borderWidth: 0, paddingHorizontal: 16 },
    bottomTools: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-around',
      minHeight: 56,
      paddingHorizontal: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.line
    },
    embeddedToolbar: {
      flexGrow: 0,
      flexShrink: 0,
      maxHeight: 238,
      borderRadius: 0,
      borderWidth: 0,
      borderBottomWidth: StyleSheet.hairlineWidth,
      backgroundColor: theme.surface
    },
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
    embeddedToolbarContent: { flexWrap: 'wrap', justifyContent: 'space-around', gap: 4, padding: 8 },
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
  setSelection: (start: number, end: number) => void;
};

export function YaohuoReplyComposer({
  actionBusy,
  awaitKeyboardSettled,
  uploadingImage = false,
  closeLabel = '收起回复',
  content,
  disabledReason,
  error,
  face = '',
  faceMode = 'selection',
  focusSignal,
  format = 'ubb',
  inputAccessibilityLabel,
  placeholder = '输入回复内容',
  presentation = 'sheet',
  status,
  submitLabel = '发送回复',
  title = '回复',
  onContentChange,
  onFaceChange = () => undefined,
  onOpenChange,
  onPanelChange,
  onReturnToEditor,
  dismissPanels = false,
  onSubmit,
  onUploadImage
}: {
  actionBusy: boolean;
  awaitKeyboardSettled?: () => Promise<void>;
  uploadingImage?: boolean;
  closeLabel?: string;
  content: string;
  disabledReason?: string;
  error?: string;
  face?: string;
  faceMode?: 'selection' | 'inline';
  focusSignal?: number;
  format?: 'ubb' | 'plain-text';
  inputAccessibilityLabel?: string;
  placeholder?: string;
  presentation?: 'sheet' | 'embedded';
  status?: string;
  submitLabel?: string;
  title?: string;
  onContentChange: (value: string) => void;
  onFaceChange?: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  dismissPanels?: boolean;
  // Includes keyboard handoff so the host keeps tool presentation stable until it settles.
  onPanelChange?: (active: boolean) => void;
  onReturnToEditor?: () => void;
  onSubmit?: () => void;
  onUploadImage?: (() => void) | (() => Promise<string | undefined | void>);
}) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
  const inputRef = useRef<InputHandle | null>(null);
  // Portal forwards parent props after the input's native change has committed.
  // Echo typing locally so TextInput never restores the preceding parent value.
  const [inputContent, setInputContent] = useState(content);
  useLayoutEffect(() => setInputContent(content), [content]);
  const contentRef = useCommittedRef(inputContent);
  // Let the IME own selection while composing; only toolbar actions move it.
  const selectionRef = useRef<Selection>({ start: content.length, end: content.length });
  const [facePanelOpen, setFacePanelOpen] = useState(false);
  const [formatPanelOpen, setFormatPanelOpen] = useState(false);
  const [panelPending, setPanelPending] = useState(false);
  const panelRequestRef = useRef<object | null>(null);
  const cancelPanelRequest = useCallback(() => {
    panelRequestRef.current = null;
    setPanelPending(false);
  }, []);
  const closePanels = useCallback(() => {
    cancelPanelRequest();
    setFacePanelOpen(false);
    setFormatPanelOpen(false);
  }, [cancelPanelRequest]);
  useLayoutEffect(() => {
    if (actionBusy || disabledReason || dismissPanels) cancelPanelRequest();
  }, [actionBusy, cancelPanelRequest, disabledReason, dismissPanels]);
  useLayoutEffect(() => {
    cancelPanelRequest();
  }, [cancelPanelRequest, format, presentation]);
  useEffect(() => {
    if (dismissPanels) {
      closePanels();
      inputRef.current?.blur();
    }
  }, [closePanels, dismissPanels]);
  const panelActive = panelPending || facePanelOpen || formatPanelOpen;
  useLayoutEffect(() => {
    onPanelChange?.(panelActive);
  }, [panelActive, onPanelChange]);
  const [imagePending, setImagePending] = useState<'keyboard' | 'upload' | null>(null);
  const [imageError, setImageError] = useState('');
  const contentVersionRef = useRef(0);
  const imageRequestRef = useRef<{ version: number } | null>(null);
  const uploadAllowed = useCommittedRef(!actionBusy && !disabledReason);
  useLayoutEffect(() => {
    contentVersionRef.current += 1;
  }, [content, format, presentation]);
  useLayoutEffect(
    () => () => {
      imageRequestRef.current = null;
      panelRequestRef.current = null;
    },
    []
  );
  const inputBusy = actionBusy || Boolean(imagePending);
  const displayError = error || imageError;
  const selectedFaceLabel = YAOHUO_FACE_ITEMS.find((item) => item.value === face)?.label;
  const toolbarActions = FORMAT_ACTIONS.filter(
    (item) => item.action !== 'image' || (Boolean(onUploadImage) && presentation !== 'embedded')
  );

  const focusAtSelection = useCallback(
    (next?: Selection) => {
      cancelPanelRequest();
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        if (next) inputRef.current?.setSelection(next.start, next.end);
      });
    },
    [cancelPanelRequest]
  );
  const changeContent = useCallback(
    (value: string) => {
      contentVersionRef.current += 1;
      contentRef.current = value;
      setInputContent(value);
      onContentChange(value);
    },
    [contentRef, onContentChange]
  );
  const uploadAtSelection = async () => {
    if (!onUploadImage || actionBusy || disabledReason || imageRequestRef.current || panelRequestRef.current) return;
    const request = { version: contentVersionRef.current };
    const original = contentRef.current;
    const selection = { ...selectionRef.current };
    imageRequestRef.current = request;
    setImagePending('keyboard');
    setImageError('');
    try {
      if (!awaitKeyboardSettled) throw new Error('当前入口尚未准备好图片选择');
      await awaitKeyboardSettled();
      if (imageRequestRef.current !== request || !uploadAllowed.current) return;
      if (contentVersionRef.current !== request.version || contentRef.current !== original)
        throw new Error('正文已变化，请重新选择图片。');
      inputRef.current?.blur();
      setImagePending('upload');
      const markup = await onUploadImage();
      if (presentation !== 'embedded') return;
      if (imageRequestRef.current !== request || typeof markup !== 'string' || !markup.trim()) return;
      if (contentVersionRef.current !== request.version || contentRef.current !== original) {
        setImageError('正文已变化，未自动插入图片。');
        return;
      }
      changeContent(replaceSelection(original, selection, markup));
      const cursor = Math.max(0, Math.min(selection.start, original.length)) + markup.length;
      selectionRef.current = { start: cursor, end: cursor };
    } catch (cause) {
      if (imageRequestRef.current === request)
        setImageError(cause instanceof Error ? cause.message : '图片上传失败，请重试');
    } finally {
      if (imageRequestRef.current === request) {
        imageRequestRef.current = null;
        setImagePending(null);
      }
    }
  };
  const togglePanel = async (panel: 'face' | 'format') => {
    if (actionBusy || disabledReason || dismissPanels || imageRequestRef.current || panelRequestRef.current) return;
    if (panel === 'face' ? facePanelOpen : formatPanelOpen) {
      closePanels();
      return;
    }
    const request = {};
    panelRequestRef.current = request;
    setPanelPending(true);
    setImageError('');
    try {
      if (!awaitKeyboardSettled) throw new Error('当前入口尚未准备好面板切换');
      await awaitKeyboardSettled();
      if (panelRequestRef.current !== request || !uploadAllowed.current) return;
      inputRef.current?.blur();
      setFacePanelOpen(panel === 'face');
      setFormatPanelOpen(panel === 'format');
    } catch (cause) {
      if (panelRequestRef.current === request)
        setImageError(cause instanceof Error ? cause.message : '键盘尚未收起，请重试');
    } finally {
      if (panelRequestRef.current === request) cancelPanelRequest();
    }
  };
  const applyFormat = (action: FormatAction) => {
    if (imageRequestRef.current || panelRequestRef.current) return;
    setFacePanelOpen(false);
    if (action === 'image' && onUploadImage) {
      void uploadAtSelection();
      return;
    }
    const replacement = formatUbb(action, selectedText(contentRef.current, selectionRef.current));
    const next = replaceSelection(contentRef.current, selectionRef.current, replacement);
    const cursor = Math.max(0, Math.min(selectionRef.current.start, contentRef.current.length)) + replacement.length;
    changeContent(next);
    selectionRef.current = { start: cursor, end: cursor };
    if (!formatPanelOpen) focusAtSelection({ start: cursor, end: cursor });
  };

  useEffect(() => {
    if (focusSignal) focusAtSelection();
  }, [focusAtSelection, focusSignal]);

  const formatTools =
    format === 'ubb' && (presentation !== 'embedded' || formatPanelOpen) ? (
      <GestureScrollView
        testID="yaohuo-reply-composer-toolbar"
        horizontal={presentation !== 'embedded'}
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        style={[styles.toolbar, presentation === 'embedded' && styles.embeddedToolbar]}
        contentContainerStyle={[styles.toolbarContent, presentation === 'embedded' && styles.embeddedToolbarContent]}
      >
        {presentation !== 'embedded' ? (
          <IconButton
            icon={Smile}
            iconOnly
            iconSize={20}
            label="表情"
            disabled={inputBusy}
            onPress={() => void togglePanel('face')}
          />
        ) : null}
        {toolbarActions.map((item) => (
          <IconButton
            key={item.action}
            icon={item.icon}
            iconOnly
            iconSize={20}
            label={item.label}
            disabled={inputBusy}
            onPress={() => applyFormat(item.action)}
          />
        ))}
      </GestureScrollView>
    ) : null;
  const facePanel = facePanelOpen ? (
    <GestureScrollView
      nestedScrollEnabled
      style={styles.facePanel}
      contentContainerStyle={styles.faceGrid}
      keyboardShouldPersistTaps="handled"
    >
      {YAOHUO_FACE_ITEMS.filter((item) => faceMode === 'selection' || item.value).map((item) => (
        <Pressable
          key={item.value || 'empty'}
          accessibilityRole="button"
          accessibilityLabel={item.label}
          disabled={inputBusy}
          style={[styles.faceChip, item.value === face && styles.faceChipActive, inputBusy && styles.disabled]}
          onPress={() => {
            if (faceMode === 'inline') {
              const replacement = formatUbb('image', yaohuoFaceImageUrl(item.value));
              const next = replaceSelection(contentRef.current, selectionRef.current, replacement);
              const cursor =
                Math.max(0, Math.min(selectionRef.current.start, contentRef.current.length)) + replacement.length;
              changeContent(next);
              selectionRef.current = { start: cursor, end: cursor };
              if (!disabledReason && !dismissPanels) onReturnToEditor?.();
              focusAtSelection(selectionRef.current);
            } else onFaceChange(item.value);
            setFacePanelOpen(false);
          }}
        >
          <Text style={styles.faceText}>{item.label}</Text>
        </Pressable>
      ))}
    </GestureScrollView>
  ) : null;

  return (
    <View style={[styles.composer, presentation === 'embedded' && styles.embedded]}>
      {presentation !== 'embedded' ? <Text style={styles.title}>{title}</Text> : null}
      {face && selectedFaceLabel ? <Text style={styles.selectedFace}>表情：{selectedFaceLabel}</Text> : null}
      {disabledReason ? <Text style={styles.disabledReason}>{disabledReason}</Text> : null}
      {displayError ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {displayError}
        </Text>
      ) : null}
      {status ? (
        <Text accessibilityLiveRegion="polite" style={styles.status}>
          {status}
        </Text>
      ) : null}
      <TextInput
        ref={(node) => {
          inputRef.current = node ? (node as InputHandle) : null;
        }}
        accessibilityLabel={inputAccessibilityLabel}
        editable={!actionBusy && imagePending !== 'upload' && !disabledReason}
        multiline
        scrollEnabled
        style={[styles.input, presentation === 'embedded' && styles.embeddedInput]}
        value={inputContent}
        placeholder={placeholder}
        placeholderTextColor={theme.muted}
        cursorColor={theme.primary}
        selectionColor={theme.primary}
        onChange={recordUserInteraction}
        onChangeText={changeContent}
        onFocus={() => {
          if (panelActive && !inputBusy && !disabledReason && !dismissPanels) onReturnToEditor?.();
          closePanels();
        }}
        onSelectionChange={(event) => {
          selectionRef.current = event.nativeEvent.selection;
        }}
      />
      {presentation === 'embedded' ? (
        <View testID="yaohuo-embedded-toolbar" style={styles.bottomTools}>
          {onUploadImage ? (
            <IconButton
              icon={ImagePlus}
              iconOnly
              iconSize={22}
              label={imagePending ? '上传中…' : '图片'}
              disabled={inputBusy}
              onPress={() => applyFormat('image')}
            />
          ) : null}
          <IconButton
            icon={Smile}
            iconOnly
            iconSize={22}
            label="表情"
            disabled={inputBusy}
            onPress={() => void togglePanel('face')}
          />
          <IconButton
            icon={Type}
            iconOnly
            iconSize={22}
            label="文字格式"
            disabled={inputBusy}
            onPress={() => void togglePanel('format')}
          />
          <IconButton
            icon={KeyboardIcon}
            iconOnly
            iconSize={22}
            label="输入正文"
            disabled={inputBusy}
            onPress={() => {
              if (panelPending && !disabledReason && !dismissPanels) onReturnToEditor?.();
              focusAtSelection();
            }}
          />
        </View>
      ) : null}
      {formatTools}
      {facePanel}
      {presentation !== 'embedded' ? (
        <View style={styles.actions}>
          <AppButton
            label={closeLabel}
            variant="ghost"
            disabled={actionBusy}
            onPress={() => {
              closePanels();
              onOpenChange?.(false);
            }}
          />
          <AppButton
            label={actionBusy ? (uploadingImage ? '上传中…' : '发送中…') : submitLabel}
            variant={content.trim() ? 'primary' : 'default'}
            disabled={inputBusy || Boolean(disabledReason) || !content.trim()}
            onPress={() => onSubmit?.()}
          />
        </View>
      ) : null}
    </View>
  );
}
