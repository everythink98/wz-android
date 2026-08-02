import { usePreventRemove } from '@react-navigation/native';

export function useTopicRouteBeforeRemove({
  imagePreviewOpen,
  replyComposerOpen,
  closeImagePreview,
  closeReplyComposer
}: {
  imagePreviewOpen: boolean;
  replyComposerOpen: boolean;
  closeImagePreview: () => void;
  closeReplyComposer: () => void;
}) {
  usePreventRemove(imagePreviewOpen || replyComposerOpen, () => {
    if (imagePreviewOpen) {
      closeImagePreview();
      return;
    }
    closeReplyComposer();
  });
}
