import { useEffect, useRef, useState } from 'react';
import { Keyboard, ScrollView, Text, TextInput, View } from 'react-native';
import type { ReplyEditTarget, ReplyTarget } from '../../appTypes';
import { createStyles, type ReaderTheme } from '../../theme';
import { AppButton } from '../../components/AppControls';
import type { Source } from '../../types';
import { applyReplyComposerFormat, replyComposerFormatActions, type ReplyComposerFormatAction } from './replyComposerFormatting';
import { replyComposerSelectionIndexFromPress } from './replyComposerSelection';

export function ReplyComposer({
  actionBusy,
  replyContent,
  replyEditTarget,
  replyTarget,
  source,
  styles,
  theme,
  topicColumnStyle,
  onReplyComposerOpenChange,
  onReplyContentChange,
  onReplyComposerBlur,
  onReplyComposerFocus,
  onSubmitReply,
  onUploadReplyImage
}: {
  actionBusy: boolean;
  replyContent: string;
  replyEditTarget?: ReplyEditTarget | null;
  replyTarget: ReplyTarget | null;
  source?: Source;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  topicColumnStyle: { width: number };
  onReplyComposerOpenChange: (open: boolean) => void;
  onReplyContentChange: (value: string) => void;
  onReplyComposerBlur?: () => void;
  onReplyComposerFocus?: () => void;
  onSubmitReply: () => void;
  onUploadReplyImage?: () => void;
}) {
  const inputRef = useRef<TextInput>(null);
  const inputFocusedRef = useRef(false);
  const inputWidthRef = useRef(0);
  const [selection, setSelection] = useState({ start: replyContent.length, end: replyContent.length });
  const selectionRef = useRef(selection);
  const formatActions = replyComposerFormatActions(source);
  const replyTargetAuthor = replyTarget?.author?.trim().replace(/^@+/, '');
  const replyTargetTitle = replyTarget
    ? `回复 ${replyTargetAuthor ? `@${replyTargetAuthor} · ` : ''}#${replyTarget.floor}`
    : replyEditTarget
      ? replyEditTarget.floor ? `编辑 #${replyEditTarget.floor}` : '编辑回复'
      : '回复';
  const placeholder = replyEditTarget ? '编辑回复内容' : replyTarget ? '输入楼层回复内容' : '输入回复内容';
  const submitLabel = replyEditTarget ? '保存编辑' : '发送回复';
  const applyFormat = (action: ReplyComposerFormatAction) => {
    if (action === 'image' && onUploadReplyImage) {
      onUploadReplyImage();
      return;
    }
    onReplyContentChange(applyReplyComposerFormat({ action, content: replyContent, selection: selectionRef.current, source }));
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
    onReplyComposerFocus?.();
  };
  const handleBlur = () => {
    inputFocusedRef.current = false;
    onReplyComposerBlur?.();
  };
  const updateSelection = (nextSelection: { start: number; end: number }) => {
    if (selectionRef.current.start === nextSelection.start && selectionRef.current.end === nextSelection.end) {
      return;
    }
    selectionRef.current = nextSelection;
    setSelection(nextSelection);
  };
  useEffect(() => {
    const nextSelection = {
      start: Math.min(selectionRef.current.start, replyContent.length),
      end: Math.min(selectionRef.current.end, replyContent.length)
    };
    updateSelection(nextSelection);
  }, [replyContent.length]);
  const moveSelectionToPress = (locationX: number, locationY: number) => {
    const index = replyComposerSelectionIndexFromPress({
      content: replyContent,
      inputWidth: inputWidthRef.current,
      locationX,
      locationY
    });
    const nextSelection = { start: index, end: index };
    updateSelection(nextSelection);
    inputRef.current?.focus();
    requestAnimationFrame(() => {
      inputRef.current?.setNativeProps({ selection: nextSelection });
    });
  };

  return (
    <View style={[styles.replyBox, topicColumnStyle]}>
      <Text style={styles.panelTitle}>{replyTargetTitle}</Text>
      {formatActions.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.replyFormatToolbar}>
          {formatActions.map((item) => (
            <AppButton key={item.action} compact label={item.label} variant="ghost" styles={styles} disabled={actionBusy} onPress={() => applyFormat(item.action)} />
          ))}
        </ScrollView>
      ) : null}
      <TextInput
        ref={inputRef}
        style={[styles.input, styles.replyInput]}
        value={replyContent}
        selection={selection}
        onBlur={handleBlur}
        onChangeText={onReplyContentChange}
        onFocus={handleFocus}
        onLayout={(event) => {
          inputWidthRef.current = event.nativeEvent.layout.width;
        }}
        onPressIn={(event) => {
          moveSelectionToPress(event.nativeEvent.locationX, event.nativeEvent.locationY);
        }}
        onSelectionChange={(event) => {
          updateSelection(event.nativeEvent.selection);
        }}
        placeholder={placeholder}
        placeholderTextColor={theme.muted}
        multiline
      />
      <View style={styles.replyComposerActions}>
        {replyTarget || replyEditTarget ? <AppButton label={replyEditTarget ? '取消编辑' : '取消楼层回复'} variant="ghost" styles={styles} disabled={actionBusy} onPress={() => onReplyComposerOpenChange(false)} /> : null}
        <AppButton label={submitLabel} variant="primary" styles={styles} disabled={actionBusy || !replyContent.trim()} onPress={onSubmitReply} />
      </View>
    </View>
  );
}
