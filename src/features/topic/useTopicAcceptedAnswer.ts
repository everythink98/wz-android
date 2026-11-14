import { useCallback, useEffect, useRef, useState } from 'react';

export function useTopicAcceptedAnswer({
  viewKey,
  instanceKey,
  hasReply,
  loading,
  requestReply
}: {
  viewKey: string;
  instanceKey?: string;
  hasReply: boolean;
  loading: boolean;
  requestReply: () => void;
}) {
  const [view, setView] = useState({ key: '', expanded: true, content: 'preview' as 'preview' | 'full' });
  const lastRequested = useRef('');
  useEffect(() => {
    setView((current) => (current.key === viewKey ? current : { key: viewKey, expanded: true, content: 'preview' }));
  }, [viewKey]);
  const load = useCallback(() => {
    if (!instanceKey) return;
    lastRequested.current = instanceKey;
    requestReply();
  }, [instanceKey, requestReply]);
  useEffect(() => {
    if (!instanceKey || hasReply || loading || lastRequested.current === instanceKey) return;
    load();
  }, [hasReply, instanceKey, load, loading]);
  const expand = useCallback(
    (expanded: boolean) =>
      setView((current) => ({
        key: viewKey,
        expanded,
        content: current.key === viewKey ? current.content : 'preview'
      })),
    [viewKey]
  );
  const revealFull = useCallback(() => setView({ key: viewKey, expanded: true, content: 'full' }), [viewKey]);
  return {
    expanded: view.key === viewKey ? view.expanded : true,
    fullVisible: view.key === viewKey && view.content === 'full',
    expand,
    revealFull,
    load
  };
}
