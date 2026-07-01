import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import type { ReplyEditTarget, ReplyTarget } from '../../appTypes';
import { createStyles, type ReaderTheme } from '../../theme';
import { AppButton } from '../../components/AppControls';
import type { Source } from '../../types';
import { applyReplyComposerFormat, replyComposerFormatActions, type ReplyComposerFormatAction } from './replyComposerFormatting';

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
  onSubmitReply: () => void;
  onUploadReplyImage?: () => void;
}) {
  const [selection, setSelection] = useState({ start: replyContent.length, end: replyContent.length });
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
    onReplyContentChange(applyReplyComposerFormat({ action, content: replyContent, selection, source }));
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
        style={[styles.input, styles.replyInput]}
        value={replyContent}
        onChangeText={onReplyContentChange}
        onSelectionChange={(event) => setSelection(event.nativeEvent.selection)}
        placeholder={placeholder}
        placeholderTextColor={theme.muted}
        multiline
      />
      {replyTarget || replyEditTarget ? <AppButton label={replyEditTarget ? '取消编辑' : '取消楼层回复'} variant="ghost" styles={styles} disabled={actionBusy} onPress={() => onReplyComposerOpenChange(false)} /> : null}
      <AppButton label={submitLabel} variant="primary" styles={styles} disabled={actionBusy || !replyContent.trim()} onPress={onSubmitReply} />
    </View>
  );
}
