import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheetFlatList, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Image as ExpoImage } from 'expo-image';
import { ScrollView as GestureScrollView } from 'react-native-gesture-handler';
import { AppButton } from '@/ui/controls/ButtonControls';
import type { Source } from '@/domain/forum/models';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { imageSourceFromUrl } from '@/platform/media/imageRequestSource';
import {
  applyReplyComposerFormat,
  replyComposerExpressionGridKey,
  replyComposerKeepsAccessoryOpenAfterExpressionInsert,
  replyComposerToolbarItems,
  replaceReplyComposerSelection,
  type ReplyComposerAccessory,
  type ReplyComposerFormatAction
} from './replyFormatting';
import {
  discourseEmojiCatalogFromUrlMap,
  NODESEEK_STICKER_CATEGORIES,
  YAOHUO_FACE_ITEMS,
  type ReplyComposerInsertExpression
} from './expressionCatalogs';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import { useForumMediaRequestContext } from '@/platform/media/mediaSessionEpoch';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { alphaColor, fontFamilyValue, type ReaderTheme } from '@/ui/theme/tokens';

function createStyles(theme: ReaderTheme, settings: ReaderSettings) {
  const fontFamily = fontFamilyValue(settings.fontFamily);
  const scaled = (value: number) => Math.round(value * settings.fontScale);
  const neutral = theme.dark ? '#ffffff' : '#000000';
  const neutralSurface = alphaColor(neutral, theme.dark ? 0.06 : 0.035);
  const neutralSurfaceStrong = alphaColor(neutral, theme.dark ? 0.11 : 0.065);
  const neutralBorder = alphaColor(neutral, theme.dark ? 0.12 : 0.09);
  const neutralBorderStrong = alphaColor(neutral, theme.dark ? 0.24 : 0.16);
  return StyleSheet.create({
    composer: { width: '100%', gap: 10, paddingHorizontal: 16, paddingTop: 14 },
    title: { color: theme.ink, fontFamily, fontSize: scaled(15), fontWeight: '600' },
    toolbar: {
      alignItems: 'center',
      backgroundColor: neutralSurface,
      borderColor: neutralBorder,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      minHeight: 48,
      padding: 6,
      width: '100%'
    },
    selectedExpression: {
      alignSelf: 'flex-start',
      backgroundColor: neutralSurfaceStrong,
      borderColor: neutralBorderStrong,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      color: theme.ink,
      fontFamily,
      fontSize: scaled(12),
      fontWeight: '700',
      lineHeight: scaled(18),
      paddingHorizontal: 9,
      paddingVertical: 3
    },
    expressionPanel: {
      maxHeight: 238,
      borderColor: neutralBorder,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      overflow: 'hidden',
      backgroundColor: neutralSurface
    },
    expressionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 10 },
    expressionChip: {
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 6,
      borderColor: neutralBorder,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      backgroundColor: theme.surface,
      paddingHorizontal: 10,
      paddingVertical: 7
    },
    expressionChipActive: { backgroundColor: neutralSurfaceStrong, borderColor: neutralBorderStrong },
    expressionPreview: { height: 26, resizeMode: 'contain', width: 26 },
    expressionChipText: { color: theme.ink, fontFamily, fontSize: scaled(12), fontWeight: '500', maxWidth: 96 },
    discourseEmojiList: {
      maxHeight: 238,
      borderColor: neutralBorder,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      overflow: 'hidden',
      backgroundColor: neutralSurface
    },
    discourseEmojiListContent: { padding: 10, paddingBottom: 2 },
    discourseEmojiRow: { gap: 8, marginBottom: 8 },
    discourseEmojiItem: {
      minHeight: 56,
      alignItems: 'center',
      justifyContent: 'center',
      flex: 1,
      borderColor: neutralBorder,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      backgroundColor: theme.surface,
      padding: 6
    },
    discourseEmojiItemText: { color: theme.ink, fontFamily, fontSize: scaled(12), fontWeight: '500' },
    stickerCategoryRail: {
      alignItems: 'center',
      borderBottomColor: neutralBorder,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 6,
      minHeight: 42,
      paddingHorizontal: 8,
      paddingVertical: 4
    },
    stickerCategoryTab: {
      borderRadius: 10,
      minHeight: 34,
      justifyContent: 'center',
      paddingHorizontal: 10,
      paddingVertical: 6
    },
    stickerCategoryTabActive: { backgroundColor: neutralSurfaceStrong },
    stickerCategoryTabText: { color: theme.muted, fontFamily, fontSize: scaled(12), fontWeight: '600' },
    stickerCategoryTabTextActive: { color: theme.ink },
    stickerGridScroll: { maxHeight: 198 },
    stickerChip: {
      width: 56,
      height: 60,
      alignItems: 'center',
      justifyContent: 'center',
      borderColor: neutralBorder,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      backgroundColor: theme.surface,
      padding: 3
    },
    stickerPreview: { height: 46, resizeMode: 'contain', width: 46 },
    input: {
      minHeight: 92,
      maxHeight: 180,
      backgroundColor: theme.surface,
      borderColor: neutralBorder,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      color: theme.ink,
      fontFamily,
      fontSize: scaled(14),
      lineHeight: scaled(21),
      paddingHorizontal: 12,
      paddingVertical: 9,
      textAlignVertical: 'top'
    },
    actions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' },
    disabled: { opacity: 0.45 },
    disabledReason: { color: theme.muted, fontFamily, fontSize: scaled(12), lineHeight: scaled(18) },
    error: { color: theme.danger, fontFamily, fontSize: scaled(12), lineHeight: scaled(18) },
    status: { color: theme.muted, fontFamily, fontSize: scaled(12), lineHeight: scaled(18) }
  });
}

type ReplyComposerInputHandle = {
  blur: () => void;
  focus: () => void;
  setNativeProps: (props: { selection?: { start: number; end: number } }) => void;
};

export function ReplyComposer({
  actionBusy,
  closeLabel = '收起回复',
  content,
  disabledReason,
  discourseEmojiUrls = {},
  error,
  face = '',
  format = 'site',
  inputAccessibilityLabel,
  placeholder = '输入回复内容',
  source,
  status,
  submitLabel = '发送回复',
  title = '回复',
  focusSignal,
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
  discourseEmojiUrls?: Readonly<Record<string, string>>;
  error?: string;
  face?: string;
  format?: 'site' | 'markdown' | 'plain-text';
  inputAccessibilityLabel?: string;
  placeholder?: string;
  source?: Source;
  status?: string;
  submitLabel?: string;
  title?: string;
  focusSignal?: number;
  onContentChange: (value: string) => void;
  onFaceChange?: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
  onUploadImage?: () => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
  const mediaContext = useForumMediaRequestContext(source);
  const mediaSessionIdentity = mediaContext.sessionIdentity;
  const inputRef = useRef<ReplyComposerInputHandle | null>(null);
  const inputFocusedRef = useRef(false);
  const [selection, setSelection] = useState({ start: content.length, end: content.length });
  const [activeAccessory, setActiveAccessory] = useState<ReplyComposerAccessory | null>(null);
  const [activeNodeSeekStickerCategory, setActiveNodeSeekStickerCategory] = useState(
    NODESEEK_STICKER_CATEGORIES[0]?.label || ''
  );
  const selectionRef = useRef(selection);
  const contentRef = useCommittedRef(content);
  const toolbarItems = useMemo(
    () =>
      format === 'plain-text'
        ? []
        : replyComposerToolbarItems(source).filter(
            (item) => item.type !== 'format' || item.action !== 'image' || Boolean(onUploadImage)
          ),
    [format, onUploadImage, source]
  );
  const discourseEmojiItems = useMemo(() => discourseEmojiCatalogFromUrlMap(discourseEmojiUrls), [discourseEmojiUrls]);
  const selectedFaceLabel = YAOHUO_FACE_ITEMS.find((item) => item.value === face)?.label;
  const updateSelection = useCallback((nextSelection: { start: number; end: number }) => {
    if (selectionRef.current.start === nextSelection.start && selectionRef.current.end === nextSelection.end) {
      return;
    }
    selectionRef.current = nextSelection;
    setSelection(nextSelection);
  }, []);
  const focusInputAtSelection = useCallback((nextSelection?: { start: number; end: number }) => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      if (nextSelection) {
        inputRef.current?.setNativeProps({ selection: nextSelection });
      }
    });
  }, []);
  const refocusInputAfterToolbarAction = () => {
    focusInputAtSelection();
  };
  const insertText = useCallback(
    (value: string, focusAfterInsert: boolean) => {
      const currentContent = contentRef.current;
      const start = Math.max(0, Math.min(selectionRef.current.start, currentContent.length));
      const nextSelection = { start: start + value.length, end: start + value.length };
      const nextContent = replaceReplyComposerSelection(currentContent, selectionRef.current, value);
      contentRef.current = nextContent;
      onContentChange(nextContent);
      updateSelection(nextSelection);
      if (focusAfterInsert) {
        focusInputAtSelection(nextSelection);
      }
    },
    [contentRef, focusInputAtSelection, onContentChange, updateSelection]
  );
  const applyFormat = (action: ReplyComposerFormatAction) => {
    setActiveAccessory(null);
    if (action === 'image' && onUploadImage) {
      onUploadImage();
      return;
    }
    onContentChange(applyReplyComposerFormat({ action, content, selection: selectionRef.current, source }));
    refocusInputAfterToolbarAction();
  };
  useEffect(() => {
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      if (inputFocusedRef.current) {
        inputRef.current?.blur();
      }
    });
    return () => {
      hideSubscription.remove();
    };
  }, []);

  const handleFocus = () => {
    inputFocusedRef.current = true;
    setActiveAccessory(null);
  };
  const handleBlur = () => {
    inputFocusedRef.current = false;
  };
  useEffect(() => {
    const nextSelection = {
      start: Math.min(selectionRef.current.start, content.length),
      end: Math.min(selectionRef.current.end, content.length)
    };
    updateSelection(nextSelection);
  }, [content.length, updateSelection]);
  useEffect(() => {
    if (!focusSignal) {
      return;
    }
    setActiveAccessory(null);
    focusInputAtSelection();
  }, [focusInputAtSelection, focusSignal]);

  const toggleAccessory = (accessory: ReplyComposerAccessory) => {
    const shouldOpen = activeAccessory !== accessory;
    if (shouldOpen) {
      inputFocusedRef.current = false;
      inputRef.current?.blur();
      Keyboard.dismiss();
    }
    setActiveAccessory(shouldOpen ? accessory : null);
  };
  const insertExpression = useCallback(
    (item: ReplyComposerInsertExpression) => {
      const keepOpen = activeAccessory ? replyComposerKeepsAccessoryOpenAfterExpressionInsert(activeAccessory) : false;
      insertText(item.code, !keepOpen);
      if (!keepOpen) {
        setActiveAccessory(null);
      }
    },
    [activeAccessory, insertText]
  );
  const renderToolbarItem = (item: ReturnType<typeof replyComposerToolbarItems>[number]) => {
    const active = item.type === 'accessory' && activeAccessory === item.accessory;
    const onPress = item.type === 'format' ? () => applyFormat(item.action) : () => toggleAccessory(item.accessory);
    return (
      <AppButton
        key={item.type === 'format' ? item.action : item.accessory}
        compact
        label={item.label}
        variant={active ? 'primary' : 'ghost'}
        disabled={actionBusy}
        onPress={onPress}
      />
    );
  };
  const accessoryPanel = useMemo(() => {
    if (!activeAccessory) {
      return null;
    }
    const renderExpressionChip = (item: ReplyComposerInsertExpression, sticker = false) => (
      <Pressable
        key={item.code}
        accessibilityRole="button"
        accessibilityLabel={item.label}
        disabled={actionBusy}
        style={[sticker ? styles.stickerChip : styles.expressionChip, actionBusy && styles.disabled]}
        onPress={() => insertExpression(item)}
      >
        {item.imageUrl ? (
          <ExpoImage
            contentFit="contain"
            recyclingKey={`${mediaSessionIdentity}:${item.imageUrl}`}
            source={imageSourceFromUrl(item.imageUrl, { mediaContext })}
            style={sticker ? styles.stickerPreview : styles.expressionPreview}
          />
        ) : null}
        {sticker ? null : (
          <Text numberOfLines={1} style={styles.expressionChipText}>
            {item.label}
          </Text>
        )}
      </Pressable>
    );
    if (activeAccessory === 'nodeseek-sticker') {
      const activeCategory =
        NODESEEK_STICKER_CATEGORIES.find((category) => category.label === activeNodeSeekStickerCategory) ||
        NODESEEK_STICKER_CATEGORIES[0];
      return (
        <View style={styles.expressionPanel}>
          <GestureScrollView
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.stickerCategoryRail}
            keyboardShouldPersistTaps="handled"
          >
            {NODESEEK_STICKER_CATEGORIES.map((category) => (
              <Pressable
                key={category.label}
                accessibilityRole="button"
                accessibilityState={{ selected: category.label === activeCategory.label }}
                disabled={actionBusy}
                style={[
                  styles.stickerCategoryTab,
                  category.label === activeCategory.label && styles.stickerCategoryTabActive,
                  actionBusy && styles.disabled
                ]}
                onPress={() => setActiveNodeSeekStickerCategory(category.label)}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.stickerCategoryTabText,
                    category.label === activeCategory.label && styles.stickerCategoryTabTextActive
                  ]}
                >
                  {category.label}
                </Text>
              </Pressable>
            ))}
          </GestureScrollView>
          <GestureScrollView
            key={replyComposerExpressionGridKey(activeAccessory, activeCategory.label)}
            nestedScrollEnabled
            style={styles.stickerGridScroll}
            contentContainerStyle={styles.expressionGrid}
            keyboardShouldPersistTaps="handled"
          >
            {activeCategory.items.map((item) => renderExpressionChip(item, true))}
          </GestureScrollView>
        </View>
      );
    }
    if (activeAccessory === 'discourse-emoji') {
      const renderDiscourseEmojiItem = ({ item }: { item: ReplyComposerInsertExpression }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={item.label}
          disabled={actionBusy}
          style={[styles.discourseEmojiItem, actionBusy && styles.disabled]}
          onPress={() => insertExpression(item)}
        >
          {item.imageUrl ? (
            <ExpoImage
              contentFit="contain"
              recyclingKey={`${mediaSessionIdentity}:${item.imageUrl}`}
              source={imageSourceFromUrl(item.imageUrl, { mediaContext })}
              style={styles.expressionPreview}
            />
          ) : null}
          {!item.imageUrl ? (
            <Text numberOfLines={1} style={styles.discourseEmojiItemText}>
              {item.label}
            </Text>
          ) : null}
        </Pressable>
      );
      return (
        <BottomSheetFlatList
          key={replyComposerExpressionGridKey(activeAccessory)}
          data={discourseEmojiItems}
          keyExtractor={(item) => item.code}
          renderItem={renderDiscourseEmojiItem}
          testID="reply-composer-discourse-emoji-list"
          nestedScrollEnabled
          numColumns={5}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          windowSize={5}
          style={styles.discourseEmojiList}
          contentContainerStyle={styles.discourseEmojiListContent}
          columnWrapperStyle={styles.discourseEmojiRow}
        />
      );
    }
    return (
      <GestureScrollView
        nestedScrollEnabled
        style={styles.expressionPanel}
        contentContainerStyle={styles.expressionGrid}
        keyboardShouldPersistTaps="handled"
      >
        {YAOHUO_FACE_ITEMS.map((item) => (
          <Pressable
            key={item.value || 'empty'}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            disabled={actionBusy}
            style={[
              styles.expressionChip,
              item.value === face && styles.expressionChipActive,
              actionBusy && styles.disabled
            ]}
            onPress={() => {
              onFaceChange(item.value);
              setActiveAccessory(null);
            }}
          >
            <Text numberOfLines={1} style={styles.expressionChipText}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </GestureScrollView>
    );
  }, [
    actionBusy,
    activeAccessory,
    activeNodeSeekStickerCategory,
    discourseEmojiItems,
    insertExpression,
    mediaContext,
    mediaSessionIdentity,
    face,
    onFaceChange,
    styles
  ]);

  return (
    <View style={styles.composer}>
      <Text style={styles.title}>{title}</Text>
      {toolbarItems.length ? (
        <View testID="reply-composer-toolbar" style={styles.toolbar}>
          {toolbarItems.map(renderToolbarItem)}
        </View>
      ) : null}
      {face && selectedFaceLabel ? <Text style={styles.selectedExpression}>表情：{selectedFaceLabel}</Text> : null}
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
      {accessoryPanel}
      <BottomSheetTextInput
        ref={(node) => {
          inputRef.current = node ? (node as ReplyComposerInputHandle) : null;
        }}
        accessibilityLabel={inputAccessibilityLabel}
        editable={!actionBusy && !disabledReason}
        style={styles.input}
        value={content}
        selection={selection}
        onBlur={handleBlur}
        onChangeText={onContentChange}
        onFocus={handleFocus}
        onSelectionChange={(event) => {
          updateSelection(event.nativeEvent.selection);
        }}
        placeholder={placeholder}
        placeholderTextColor={theme.muted}
        cursorColor={theme.primary}
        selectionColor={theme.primary}
        multiline
        scrollEnabled
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
