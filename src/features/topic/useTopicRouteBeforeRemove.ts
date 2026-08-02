import { useEffect } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';

export function useTopicRouteBeforeRemove({
  navigation,
  imagePreviewOpen,
  replyComposerOpen,
  closeImagePreview,
  closeReplyComposer
}: {
  navigation: NativeStackScreenProps<RootStackParamList, 'Topic'>['navigation'];
  imagePreviewOpen: boolean;
  replyComposerOpen: boolean;
  closeImagePreview: () => void;
  closeReplyComposer: () => void;
}) {
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (event) => {
        if (imagePreviewOpen) {
          event.preventDefault();
          closeImagePreview();
          return;
        }
        if (replyComposerOpen) {
          event.preventDefault();
          closeReplyComposer();
        }
      }),
    [closeImagePreview, closeReplyComposer, imagePreviewOpen, navigation, replyComposerOpen]
  );
}
