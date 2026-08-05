import { StyleSheet } from 'react-native';
import type { Source } from '@/domain/forum/models';
import type { ReaderSettings } from '@/domain/reader/readerData';
import type { DiscourseEmojiUrlMap } from '@/sources/discourse/reactions';
import { ReplyComposer } from '@/ui/composer/ReplyComposer';
import { ComposerBottomSheet } from '@/ui/sheets/ComposerBottomSheet';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import type { ReaderTheme } from '@/ui/theme/tokens';

function createStyles(theme: ReaderTheme, _settings: ReaderSettings) {
  return StyleSheet.create({
    background: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18
    },
    container: { zIndex: 30, elevation: 30 },
    content: { alignItems: 'stretch', paddingHorizontal: 0, paddingTop: 0 }
  });
}

export function MessageReplyComposerSheet({
  busy,
  content,
  disabledReason,
  discourseEmojiUrls,
  error,
  format,
  source,
  status,
  visible,
  onChangeContent,
  onClose,
  onSubmit,
  onUploadImage
}: {
  busy: boolean;
  content: string;
  disabledReason?: string;
  discourseEmojiUrls?: DiscourseEmojiUrlMap;
  error?: string;
  format: 'markdown' | 'plain-text';
  source: Source;
  status?: string;
  visible: boolean;
  onChangeContent: (content: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  onUploadImage?: () => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
  return (
    <ComposerBottomSheet
      backgroundStyle={styles.background}
      containerStyle={styles.container}
      contentStyle={styles.content}
      dark={theme.dark}
      visible={visible}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {(focusSignal) => (
        <ReplyComposer
          actionBusy={busy}
          closeLabel="取消"
          content={content}
          disabledReason={disabledReason}
          discourseEmojiUrls={discourseEmojiUrls}
          error={error}
          focusSignal={focusSignal}
          format={format}
          inputAccessibilityLabel="私信回复内容"
          placeholder="输入回复内容"
          source={source}
          status={status}
          submitLabel="发送回复"
          title="回复私信"
          onContentChange={onChangeContent}
          onOpenChange={(open) => {
            if (!open) onClose();
          }}
          onSubmit={onSubmit}
          onUploadImage={onUploadImage}
        />
      )}
    </ComposerBottomSheet>
  );
}
