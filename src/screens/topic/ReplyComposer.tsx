import { Text, TextInput, View } from 'react-native';
import type { ReplyTarget } from '../../appTypes';
import { createStyles, type ReaderTheme } from '../../theme';
import { AppButton } from '../../components/AppControls';

export function ReplyComposer({
  actionBusy,
  replyContent,
  replyTarget,
  styles,
  theme,
  topicColumnStyle,
  onReplyComposerOpenChange,
  onReplyContentChange,
  onSubmitReply
}: {
  actionBusy: boolean;
  replyContent: string;
  replyTarget: ReplyTarget | null;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  topicColumnStyle: { width: number };
  onReplyComposerOpenChange: (open: boolean) => void;
  onReplyContentChange: (value: string) => void;
  onSubmitReply: () => void;
}) {
  return (
    <View style={[styles.replyBox, topicColumnStyle]}>
      <Text style={styles.panelTitle}>{replyTarget ? `回复 #${replyTarget.floor}${replyTarget.author ? ` · ${replyTarget.author}` : ''}` : '回复'}</Text>
      <TextInput
        style={[styles.input, styles.replyInput]}
        value={replyContent}
        onChangeText={onReplyContentChange}
        placeholder={replyTarget ? '输入楼层回复内容' : '输入回复内容'}
        placeholderTextColor={theme.muted}
        multiline
      />
      {replyTarget ? <AppButton label="取消楼层回复" variant="ghost" styles={styles} disabled={actionBusy} onPress={() => onReplyComposerOpenChange(false)} /> : null}
      <AppButton label="发送回复" variant="primary" styles={styles} disabled={actionBusy || !replyContent.trim()} onPress={onSubmitReply} />
    </View>
  );
}
