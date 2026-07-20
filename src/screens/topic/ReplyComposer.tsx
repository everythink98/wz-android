import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, Text, View } from 'react-native';
import { BottomSheetFlatList, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Image as ExpoImage } from 'expo-image';
import { ScrollView as GestureScrollView } from 'react-native-gesture-handler';
import type { ReplyEditTarget, ReplyTarget } from '../../appTypes';
import { createStyles, type ReaderTheme } from '../../theme';
import { AppButton } from '../../components/AppControls';
import type { Source } from '../../types';
import type { DiscourseEmojiUrlMap } from '../../discourseReactions';
import { imageSourceFromUrl } from '../../htmlImages';
import {
  applyReplyComposerFormat,
  replyComposerExpressionGridKey,
  replyComposerKeepsAccessoryOpenAfterExpressionInsert,
  replyComposerToolbarItems,
  replaceReplyComposerSelection,
  type ReplyComposerAccessory,
  type ReplyComposerFormatAction
} from './replyComposerFormatting';
import {
  discourseEmojiCatalogFromUrlMap,
  NODESEEK_STICKER_CATEGORIES,
  YAOHUO_FACE_ITEMS,
  type ReplyComposerInsertExpression
} from './replyComposerExpressionCatalogs';
import { useCommittedRef } from '../../app/useCommittedRef';

type ReplyComposerInputHandle = {
  blur: () => void;
  focus: () => void;
  setNativeProps: (props: { selection?: { start: number; end: number } }) => void;
};

export function ReplyComposer({
  actionBusy,
  discourseEmojiUrls = {},
  replyContent,
  replyEditTarget,
  replyFace,
  replyTarget,
  source,
  styles,
  theme,
  focusSignal,
  onReplyComposerOpenChange,
  onReplyContentChange,
  onReplyFaceChange,
  onSubmitReply,
  onUploadReplyImage
}: {
  actionBusy: boolean;
  discourseEmojiUrls?: DiscourseEmojiUrlMap;
  replyContent: string;
  replyFace: string;
  replyEditTarget?: ReplyEditTarget | null;
  replyTarget: ReplyTarget | null;
  source?: Source;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  focusSignal?: number;
  onReplyComposerOpenChange: (open: boolean) => void;
  onReplyContentChange: (value: string) => void;
  onReplyFaceChange: (value: string) => void;
  onSubmitReply: () => void;
  onUploadReplyImage?: () => void;
}) {
  const inputRef = useRef<ReplyComposerInputHandle | null>(null);
  const inputFocusedRef = useRef(false);
  const [selection, setSelection] = useState({ start: replyContent.length, end: replyContent.length });
  const [activeAccessory, setActiveAccessory] = useState<ReplyComposerAccessory | null>(null);
  const [activeNodeSeekStickerCategory, setActiveNodeSeekStickerCategory] = useState(NODESEEK_STICKER_CATEGORIES[0]?.label || '');
  const selectionRef = useRef(selection);
  const replyContentRef = useCommittedRef(replyContent);
  const toolbarItems = replyComposerToolbarItems(source);
  const discourseEmojiItems = useMemo(() => discourseEmojiCatalogFromUrlMap(discourseEmojiUrls), [discourseEmojiUrls]);
  const selectedFaceLabel = YAOHUO_FACE_ITEMS.find((item) => item.value === replyFace)?.label;
  const replyTargetAuthor = replyTarget?.author?.trim().replace(/^@+/, '');
  const replyTargetTitle = replyTarget
    ? `回复 ${replyTargetAuthor ? `@${replyTargetAuthor} · ` : ''}#${replyTarget.floor}`
    : replyEditTarget
      ? replyEditTarget.floor ? `编辑 #${replyEditTarget.floor}` : '编辑回复'
      : '回复';
  const placeholder = replyEditTarget ? '编辑回复内容' : replyTarget ? '输入楼层回复内容' : '输入回复内容';
  const submitLabel = replyEditTarget ? '保存编辑' : '发送回复';
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
  const insertText = useCallback((value: string, focusAfterInsert: boolean) => {
    const content = replyContentRef.current;
    const start = Math.max(0, Math.min(selectionRef.current.start, content.length));
    const nextSelection = { start: start + value.length, end: start + value.length };
    const nextContent = replaceReplyComposerSelection(content, selectionRef.current, value);
    replyContentRef.current = nextContent;
    onReplyContentChange(nextContent);
    updateSelection(nextSelection);
    if (focusAfterInsert) {
      focusInputAtSelection(nextSelection);
    }
  }, [focusInputAtSelection, onReplyContentChange, updateSelection]);
  const applyFormat = (action: ReplyComposerFormatAction) => {
    setActiveAccessory(null);
    if (action === 'image' && onUploadReplyImage) {
      onUploadReplyImage();
      return;
    }
    onReplyContentChange(applyReplyComposerFormat({ action, content: replyContent, selection: selectionRef.current, source }));
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
      start: Math.min(selectionRef.current.start, replyContent.length),
      end: Math.min(selectionRef.current.end, replyContent.length)
    };
    updateSelection(nextSelection);
  }, [replyContent.length, updateSelection]);
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
  const insertExpression = useCallback((item: ReplyComposerInsertExpression) => {
    const keepOpen = activeAccessory ? replyComposerKeepsAccessoryOpenAfterExpressionInsert(activeAccessory) : false;
    insertText(item.code, !keepOpen);
    if (!keepOpen) {
      setActiveAccessory(null);
    }
  }, [activeAccessory, insertText]);
  const renderToolbarItem = (item: ReturnType<typeof replyComposerToolbarItems>[number]) => {
    const active = item.type === 'accessory' && activeAccessory === item.accessory;
    const onPress = item.type === 'format'
      ? () => applyFormat(item.action)
      : () => toggleAccessory(item.accessory);
    return <AppButton key={item.type === 'format' ? item.action : item.accessory} compact label={item.label} variant={active ? 'primary' : 'ghost'} styles={styles} disabled={actionBusy} onPress={onPress} />;
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
        style={[sticker ? styles.replyStickerChip : styles.replyExpressionChip, actionBusy && styles.buttonDisabled]}
        onPress={() => insertExpression(item)}
      >
        {item.imageUrl ? <ExpoImage contentFit="contain" recyclingKey={item.imageUrl} source={imageSourceFromUrl(item.imageUrl)} style={sticker ? styles.replyStickerPreview : styles.replyExpressionPreview} /> : null}
        {sticker ? null : <Text numberOfLines={1} style={styles.replyExpressionChipText}>{item.label}</Text>}
      </Pressable>
    );
    if (activeAccessory === 'nodeseek-sticker') {
      const activeCategory = NODESEEK_STICKER_CATEGORIES.find((category) => category.label === activeNodeSeekStickerCategory) || NODESEEK_STICKER_CATEGORIES[0];
      return (
        <View style={styles.replyExpressionPanel}>
          <GestureScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} contentContainerStyle={styles.replyStickerCategoryRail} keyboardShouldPersistTaps="handled">
            {NODESEEK_STICKER_CATEGORIES.map((category) => (
              <Pressable
                key={category.label}
                accessibilityRole="button"
                accessibilityState={{ selected: category.label === activeCategory.label }}
                disabled={actionBusy}
                style={[styles.replyStickerCategoryTab, category.label === activeCategory.label && styles.replyStickerCategoryTabActive, actionBusy && styles.buttonDisabled]}
                onPress={() => setActiveNodeSeekStickerCategory(category.label)}
              >
                <Text numberOfLines={1} style={[styles.replyStickerCategoryTabText, category.label === activeCategory.label && styles.replyStickerCategoryTabTextActive]}>{category.label}</Text>
              </Pressable>
            ))}
          </GestureScrollView>
          <GestureScrollView key={replyComposerExpressionGridKey(activeAccessory, activeCategory.label)} nestedScrollEnabled style={styles.replyStickerGridScroll} contentContainerStyle={styles.replyExpressionGrid} keyboardShouldPersistTaps="handled">
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
          style={[styles.replyLinuxDoEmojiItem, actionBusy && styles.buttonDisabled]}
          onPress={() => insertExpression(item)}
        >
          {item.imageUrl ? <ExpoImage contentFit="contain" recyclingKey={item.imageUrl} source={imageSourceFromUrl(item.imageUrl)} style={styles.replyExpressionPreview} /> : null}
          <Text numberOfLines={1} style={styles.replyLinuxDoEmojiItemText}>{item.label}</Text>
        </Pressable>
      );
      return (
        <BottomSheetFlatList
          key={replyComposerExpressionGridKey(activeAccessory)}
          data={discourseEmojiItems}
          keyExtractor={(item) => item.code}
          renderItem={renderDiscourseEmojiItem}
          nestedScrollEnabled
          numColumns={2}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          windowSize={5}
          style={styles.replyLinuxDoEmojiList}
          contentContainerStyle={styles.replyLinuxDoEmojiListContent}
          columnWrapperStyle={styles.replyLinuxDoEmojiRow}
        />
      );
    }
    return (
      <GestureScrollView nestedScrollEnabled style={styles.replyExpressionPanel} contentContainerStyle={styles.replyExpressionGrid} keyboardShouldPersistTaps="handled">
        {YAOHUO_FACE_ITEMS.map((item) => (
          <Pressable
            key={item.value || 'empty'}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            disabled={actionBusy}
            style={[styles.replyExpressionChip, item.value === replyFace && styles.replyExpressionChipActive, actionBusy && styles.buttonDisabled]}
            onPress={() => {
              onReplyFaceChange(item.value);
              setActiveAccessory(null);
            }}
          >
            <Text numberOfLines={1} style={styles.replyExpressionChipText}>{item.label}</Text>
          </Pressable>
        ))}
      </GestureScrollView>
    );
  }, [actionBusy, activeAccessory, activeNodeSeekStickerCategory, discourseEmojiItems, insertExpression, onReplyFaceChange, replyFace, styles]);

  return (
    <View style={[styles.replyBox, styles.replyComposerSheetBox]}>
      <Text style={styles.panelTitle}>{replyTargetTitle}</Text>
      {toolbarItems.length ? (
        <GestureScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} style={styles.replyFormatToolbarScroll} contentContainerStyle={styles.replyFormatToolbar} keyboardShouldPersistTaps="handled">
          {toolbarItems.map(renderToolbarItem)}
        </GestureScrollView>
      ) : null}
      {replyFace && selectedFaceLabel ? <Text style={styles.replyExpressionSelected}>表情：{selectedFaceLabel}</Text> : null}
      {accessoryPanel}
      <BottomSheetTextInput
        ref={(node) => {
          inputRef.current = node ? node as ReplyComposerInputHandle : null;
        }}
        style={[styles.input, styles.replyInput]}
        value={replyContent}
        selection={selection}
        onBlur={handleBlur}
        onChangeText={onReplyContentChange}
        onFocus={handleFocus}
        onSelectionChange={(event) => {
          updateSelection(event.nativeEvent.selection);
        }}
        placeholder={placeholder}
        placeholderTextColor={theme.muted}
        multiline
        scrollEnabled
      />
      <View style={styles.replyComposerActions}>
        <AppButton label={replyEditTarget ? '取消编辑' : replyTarget ? '取消楼层回复' : '收起回复'} variant="ghost" styles={styles} disabled={actionBusy} onPress={() => onReplyComposerOpenChange(false)} />
        <AppButton label={submitLabel} variant={replyContent.trim() ? 'primary' : 'default'} styles={styles} disabled={actionBusy || !replyContent.trim()} onPress={onSubmitReply} />
      </View>
    </View>
  );
}
