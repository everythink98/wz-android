import type { TopicStyles } from '../styles';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, useWindowDimensions } from 'react-native';
import BottomSheet, { BottomSheetBackdrop, BottomSheetView, type BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ReplyEditTarget, ReplyTarget } from '../model/types';
import type { DiscourseEmojiUrlMap } from '@/sources/discourse/reactions';
import { type ReaderTheme } from '@/ui/theme/tokens';
import type { Source } from '@/domain/forum/models';
import { ReplyComposer } from '../composer/ReplyComposer';

export function ReplyComposerSheet({
  actionBusy,
  discourseEmojiUrls = {},
  replyContent,
  replyEditTarget,
  replyFace,
  replyTarget,
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
  replyContent: string;
  replyFace: string;
  replyEditTarget?: ReplyEditTarget | null;
  replyTarget: ReplyTarget | null;
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
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const bottomSheetRef = useRef<BottomSheet>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const maxDynamicContentSize = Math.round(height * 0.58);
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={theme.dark ? 0.56 : 0.38}
        pressBehavior="close"
      />
    ),
    [theme.dark]
  );
  const close = useCallback(() => {
    Keyboard.dismiss();
    onReplyComposerOpenChange(false);
  }, [onReplyComposerOpenChange]);
  const handleReplyComposerOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        onReplyComposerOpenChange(true);
        return;
      }
      close();
    },
    [close, onReplyComposerOpenChange]
  );
  const bottomSheetContentStyle = useMemo(
    () => [styles.replyComposerBottomSheetContent, { paddingBottom: Math.max(10, insets.bottom + 10) }],
    [insets.bottom, styles.replyComposerBottomSheetContent]
  );

  useEffect(() => {
    if (!visible) {
      bottomSheetRef.current?.close();
    }
  }, [visible]);
  useEffect(() => {
    if (!visible) {
      return;
    }
    const timer = setTimeout(() => {
      setFocusSignal((value) => value + 1);
    }, 220);
    return () => {
      clearTimeout(timer);
    };
  }, [visible]);

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={visible ? 0 : -1}
      backgroundStyle={styles.replyComposerBottomSheetBackground}
      backdropComponent={renderBackdrop}
      containerStyle={styles.replyComposerBottomSheetContainer}
      enableDynamicSizing
      enablePanDownToClose
      handleComponent={null}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustPan"
      maxDynamicContentSize={maxDynamicContentSize}
      onClose={close}
    >
      <BottomSheetView style={bottomSheetContentStyle}>
        <ReplyComposer
          actionBusy={actionBusy}
          focusSignal={focusSignal}
          discourseEmojiUrls={discourseEmojiUrls}
          replyContent={replyContent}
          replyFace={replyFace}
          replyEditTarget={replyEditTarget}
          replyTarget={replyTarget}
          source={source}
          styles={styles}
          theme={theme}
          onReplyComposerOpenChange={handleReplyComposerOpenChange}
          onReplyContentChange={onReplyContentChange}
          onReplyFaceChange={onReplyFaceChange}
          onSubmitReply={onSubmitReply}
          onUploadReplyImage={onUploadReplyImage}
        />
      </BottomSheetView>
    </BottomSheet>
  );
}
