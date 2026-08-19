import type { TopicStyles } from '../styles';
import type { ReplyComposerIntent } from '../useTopicSessionController';
import type { DiscourseEmojiUrlMap } from '@/sources/discourse/reactions';
import { type ReaderTheme } from '@/ui/theme/tokens';
import type { Source } from '@/domain/forum/models';
import { ReplyComposer } from '@/ui/composer/ReplyComposer';
import { ComposerBottomSheet } from '@/ui/sheets/ComposerBottomSheet';

export function ReplyComposerSheet({
  actionBusy,
  discourseEmojiUrls = {},
  intent,
  replyContent,
  replyFace,
  source,
  styles,
  theme,
  visible,
  onReplyComposerOpenChange,
  onReplyContentChange,
  onReplyFaceChange,
  onSubmitReply,
  onUploadReplyImage
}: {
  actionBusy: boolean;
  discourseEmojiUrls?: DiscourseEmojiUrlMap;
  intent: ReplyComposerIntent;
  replyContent: string;
  replyFace: string;
  source?: Source;
  styles: TopicStyles;
  theme: ReaderTheme;
  visible: boolean;
  onReplyComposerOpenChange: (open: boolean) => void;
  onReplyContentChange: (value: string) => void;
  onReplyFaceChange: (value: string) => void;
  onSubmitReply: () => void;
  onUploadReplyImage?: () => void;
}) {
  let closeLabel = '收起回复';
  let placeholder = '输入回复内容';
  let submitLabel = '发送回复';
  let title = '回复';
  if (intent.kind === 'floor') {
    const author = intent.target.author?.trim().replace(/^@+/, '');
    closeLabel = '取消楼层回复';
    placeholder = '输入楼层回复内容';
    title = `回复 ${author ? `@${author} · ` : ''}#${intent.target.floor}`;
  } else if (intent.kind === 'edit') {
    closeLabel = '取消编辑';
    placeholder = '编辑回复内容';
    submitLabel = '保存编辑';
    title = intent.target.floor ? `编辑 #${intent.target.floor}` : '编辑回复';
  }
  return (
    <ComposerBottomSheet
      backgroundStyle={styles.replyComposerBottomSheetBackground}
      containerStyle={styles.replyComposerBottomSheetContainer}
      contentStyle={styles.replyComposerBottomSheetContent}
      dark={theme.dark}
      visible={visible}
      onOpenChange={onReplyComposerOpenChange}
    >
      {(focusSignal) => (
        <ReplyComposer
          actionBusy={actionBusy}
          closeLabel={closeLabel}
          content={replyContent}
          focusSignal={focusSignal}
          discourseEmojiUrls={discourseEmojiUrls}
          face={replyFace}
          placeholder={placeholder}
          source={source}
          submitLabel={submitLabel}
          title={title}
          onContentChange={onReplyContentChange}
          onFaceChange={onReplyFaceChange}
          onOpenChange={onReplyComposerOpenChange}
          onSubmit={onSubmitReply}
          onUploadImage={onUploadReplyImage}
        />
      )}
    </ComposerBottomSheet>
  );
}
