import { usePreventRemove } from '@react-navigation/native';
import { createContext, createElement, type ReactNode, useCallback, useContext, useState } from 'react';

const InteractionBackContext = createContext<(close: (() => void) | null) => void>(() => undefined);
const SelectionBackContext = createContext<(cancel: (() => void) | null) => void>(() => undefined);

export function useTopicSelectionBackReport() {
  return useContext(SelectionBackContext);
}

export function useTopicInteractionBackReport() {
  return useContext(InteractionBackContext);
}

export function TopicRouteBackBoundary({
  children,
  ...props
}: Omit<Parameters<typeof useTopicRouteBeforeRemove>[0], 'cancelSelection' | 'closeInteraction'> & {
  children: ReactNode;
}) {
  const [cancelSelection, setCancelSelection] = useState<(() => void) | null>(null);
  const report = useCallback((cancel: (() => void) | null) => setCancelSelection(() => cancel), []);
  const [closeInteraction, setCloseInteraction] = useState<(() => void) | null>(null);
  const reportInteraction = useCallback((close: (() => void) | null) => setCloseInteraction(() => close), []);
  useTopicRouteBeforeRemove({ ...props, cancelSelection, closeInteraction });
  return createElement(
    InteractionBackContext.Provider,
    { value: reportInteraction },
    createElement(SelectionBackContext.Provider, { value: report }, children)
  );
}

export function useTopicRouteBeforeRemove({
  imagePreviewOpen,
  replyComposerOpen,
  closeImagePreview,
  closeReplyComposer,
  cancelSelection,
  closeInteraction
}: {
  imagePreviewOpen: boolean;
  replyComposerOpen: boolean;
  closeImagePreview: () => void;
  closeReplyComposer: () => void;
  cancelSelection?: (() => void) | null;
  closeInteraction?: (() => void) | null;
}) {
  usePreventRemove(
    imagePreviewOpen || replyComposerOpen || Boolean(closeInteraction) || Boolean(cancelSelection),
    () => {
      if (imagePreviewOpen) {
        closeImagePreview();
        return;
      }
      if (replyComposerOpen) closeReplyComposer();
      else if (closeInteraction) closeInteraction();
      else cancelSelection?.();
    }
  );
}
