import { createContext, type ReactNode, useContext, useMemo } from 'react';
import type { TNode } from 'react-native-render-html';
import { contentBoundaryForContinuation, type ContentContinuation } from './htmlStyles';

type TopicContentPresentation = {
  trimLeading: boolean;
  trimTrailing: boolean;
};

const DEFAULT_TOPIC_CONTENT_PRESENTATION: TopicContentPresentation = {
  trimLeading: false,
  trimTrailing: false
};

const TopicContentPresentationContext = createContext<TopicContentPresentation>(DEFAULT_TOPIC_CONTENT_PRESENTATION);

export function TopicContentPresentationProvider({
  children,
  continuation,
  trimTrailing = false
}: {
  children: ReactNode;
  continuation: ContentContinuation;
  trimTrailing?: boolean;
}) {
  const boundary = contentBoundaryForContinuation(continuation);
  const value = useMemo<TopicContentPresentation>(
    () => ({
      trimLeading: boundary.trimLeading,
      trimTrailing: boundary.trimTrailing || trimTrailing
    }),
    [boundary.trimLeading, boundary.trimTrailing, trimTrailing]
  );
  return <TopicContentPresentationContext.Provider value={value}>{children}</TopicContentPresentationContext.Provider>;
}

function isDocumentEdgeDescendant(tnode: TNode, edge: 'leading' | 'trailing') {
  let child = tnode;
  for (let parent = child.parent; parent; parent = parent.parent) {
    const expectedIndex = edge === 'leading' ? 0 : parent.children.length - 1;
    if (child.nodeIndex !== expectedIndex) return false;
    child = parent;
  }
  return true;
}

export function useContentBoundarySpacing(tnode: TNode) {
  const presentation = useContext(TopicContentPresentationContext);
  const trimLeading = presentation.trimLeading && isDocumentEdgeDescendant(tnode, 'leading');
  const trimTrailing = presentation.trimTrailing && isDocumentEdgeDescendant(tnode, 'trailing');
  if (!trimLeading && !trimTrailing) return undefined;
  return {
    ...(trimLeading ? { marginTop: 0 as const } : {}),
    ...(trimTrailing ? { marginBottom: 0 as const } : {})
  };
}
