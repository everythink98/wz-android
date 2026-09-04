import { usePreventRemove } from '@react-navigation/native';
import { createContext, createElement, type ReactNode, useCallback, useContext, useState } from 'react';

const SelectionBackContext = createContext<(cancel: (() => void) | null) => void>(() => undefined);

export function useTopicSelectionBackReport() {
  return useContext(SelectionBackContext);
}

export function TopicRouteBackBoundary({
  children,
  ...props
}: Parameters<typeof useTopicRouteBeforeRemove>[0] & { children: ReactNode }) {
  const [cancelSelection, setCancelSelection] = useState<(() => void) | null>(null);
  const report = useCallback((cancel: (() => void) | null) => setCancelSelection(() => cancel), []);
  useTopicRouteBeforeRemove({ ...props, cancelSelection });
  return createElement(SelectionBackContext.Provider, { value: report }, children);
}

export function useTopicRouteBeforeRemove({
  imagePreviewOpen,
  replyComposerOpen,
  closeImagePreview,
  closeReplyComposer,
  cancelSelection
}: {
  imagePreviewOpen: boolean;
  replyComposerOpen: boolean;
  closeImagePreview: () => void;
  closeReplyComposer: () => void;
  cancelSelection?: (() => void) | null;
}) {
  usePreventRemove(imagePreviewOpen || replyComposerOpen || Boolean(cancelSelection), () => {
    if (imagePreviewOpen) {
      closeImagePreview();
      return;
    }
    if (replyComposerOpen) closeReplyComposer();
    else cancelSelection?.();
  });
}
