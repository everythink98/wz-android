import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, useWindowDimensions } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ReplyEditTarget, ReplyTarget } from '../../appTypes';
import type { LinuxDoEmojiUrlMap } from '../../linuxdoReactions';
import { createStyles, type ReaderTheme } from '../../theme';
import type { Source } from '../../types';
import { ReplyComposer } from './ReplyComposer';
import { replyComposerDraftSessionKey, replyComposerDraftWithUploadedMarkup } from './replyComposerDraft';

export function ReplyComposerSheet({
  actionBusy,
  linuxDoEmojiUrls = {},
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
  linuxDoEmojiUrls?: LinuxDoEmojiUrlMap;
  replyContent: string;
  replyFace: string;
  replyEditTarget?: ReplyEditTarget | null;
  replyTarget: ReplyTarget | null;
  source?: Source;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  visible: boolean;
  onReplyComposerOpenChange: (open: boolean) => void;
  onReplyContentChange: (value: string) => void;
  onReplyFaceChange: (value: string) => void;
  onSubmitReply: (content: string) => void | Promise<void>;
  onUploadReplyImage?: () => Promise<string | null | undefined>;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const bottomSheetRef = useRef<BottomSheet>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const [draftContent, setDraftContent] = useState(replyContent);
  const draftContentRef = useRef(replyContent);
  const externalContentRef = useRef(replyContent);
  const visibleRef = useRef(visible);
  const editingRef = useRef(Boolean(replyEditTarget));
  const draftSessionKey = replyComposerDraftSessionKey(replyTarget, replyEditTarget);
  const draftSessionKeyRef = useRef(draftSessionKey);
  const maxDynamicContentSize = Math.round(height * 0.58);
  const renderBackdrop = useCallback((props: BottomSheetBackdropProps) => (
    <BottomSheetBackdrop
      {...props}
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      opacity={theme.dark ? 0.56 : 0.38}
      pressBehavior="close"
    />
  ), [theme.dark]);
  const replaceDraft = useCallback((content: string) => {
    draftContentRef.current = content;
    setDraftContent(content);
  }, []);
  const commitDraft = useCallback(() => {
    const content = draftContentRef.current;
    if (content === externalContentRef.current) {
      return content;
    }
    externalContentRef.current = content;
    onReplyContentChange(content);
    return content;
  }, [onReplyContentChange]);
  const close = useCallback(() => {
    Keyboard.dismiss();
    commitDraft();
    onReplyComposerOpenChange(false);
  }, [commitDraft, onReplyComposerOpenChange]);
  const handleReplyComposerOpenChange = useCallback((open: boolean) => {
    if (open) {
      onReplyComposerOpenChange(true);
      return;
    }
    close();
  }, [close, onReplyComposerOpenChange]);
  const bottomSheetContentStyle = useMemo(() => [
    styles.replyComposerBottomSheetContent,
    { paddingBottom: Math.max(10, insets.bottom + 10) }
  ], [insets.bottom, styles.replyComposerBottomSheetContent]);

  const handleDraftChange = useCallback((content: string) => {
    replaceDraft(content);
  }, [replaceDraft]);
  const handleSubmitReply = useCallback((content: string) => {
    replaceDraft(content);
    if (content !== externalContentRef.current) {
      externalContentRef.current = content;
      onReplyContentChange(content);
    }
    void onSubmitReply(content);
  }, [onReplyContentChange, onSubmitReply, replaceDraft]);
  const handleUploadReplyImage = useCallback(async () => {
    const markup = await onUploadReplyImage?.();
    if (!markup) {
      return;
    }
    const nextContent = replyComposerDraftWithUploadedMarkup(draftContentRef.current, markup);
    replaceDraft(nextContent);
    externalContentRef.current = nextContent;
    onReplyContentChange(nextContent);
  }, [onReplyContentChange, onUploadReplyImage, replaceDraft]);

  useEffect(() => {
    externalContentRef.current = replyContent;
    replaceDraft(replyContent);
  }, [replyContent, replaceDraft]);
  useEffect(() => {
    if (draftSessionKeyRef.current === draftSessionKey) {
      return;
    }
    const previousWasEdit = editingRef.current;
    draftSessionKeyRef.current = draftSessionKey;
    editingRef.current = Boolean(replyEditTarget);
    if (replyEditTarget) {
      externalContentRef.current = replyEditTarget.contentMarkdown;
      replaceDraft(replyEditTarget.contentMarkdown);
    } else if (previousWasEdit) {
      externalContentRef.current = replyContent;
      replaceDraft(replyContent);
    } else if (visible) {
      commitDraft();
    }
  }, [commitDraft, draftSessionKey, replyContent, replyEditTarget, replaceDraft, visible]);
  useEffect(() => {
    const wasVisible = visibleRef.current;
    if (visible) {
      editingRef.current = Boolean(replyEditTarget);
      if (!wasVisible) {
        replaceDraft(replyContent);
      }
    } else if (!visible && wasVisible) {
      if (!editingRef.current) {
        commitDraft();
      }
      editingRef.current = false;
    }
    visibleRef.current = visible;
  }, [commitDraft, replyContent, replyEditTarget, replaceDraft, visible]);

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
          linuxDoEmojiUrls={linuxDoEmojiUrls}
          replyContent={draftContent}
          replyFace={replyFace}
          replyEditTarget={replyEditTarget}
          replyTarget={replyTarget}
          source={source}
          styles={styles}
          theme={theme}
          onReplyComposerOpenChange={handleReplyComposerOpenChange}
          onReplyContentChange={handleDraftChange}
          onReplyContentCommit={commitDraft}
          onReplyFaceChange={onReplyFaceChange}
          onSubmitReply={handleSubmitReply}
          onUploadReplyImage={onUploadReplyImage ? handleUploadReplyImage : undefined}
        />
      </BottomSheetView>
    </BottomSheet>
  );
}
