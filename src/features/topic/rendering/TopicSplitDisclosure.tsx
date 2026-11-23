import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore
} from 'react';
import type { CompiledForumContentRow, ForumContentAncestorFrame } from '@/domain/forum/topicContentSplit';

type TopicSplitDisclosureKind = 'callout' | 'details';

type TopicSplitDisclosureStoreValue = {
  activeTabByKey: Readonly<Record<string, string>>;
  expandedByKey: Readonly<Record<string, boolean>>;
  galleries: Map<string, ReturnType<typeof createGalleryPosition>>;
  selectTab: (key: string, tabId: string) => void;
  toggle: (key: string, defaultExpanded: boolean) => void;
};

const TopicSplitDisclosureStoreContext = createContext<TopicSplitDisclosureStoreValue | null>(null);
const TopicSplitDisclosureScopeContext = createContext<string | null>(null);

type TopicSplitDisclosureState = {
  activeTabByKey: Record<string, string>;
  expandedByKey: Record<string, boolean>;
  galleries: Map<string, ReturnType<typeof createGalleryPosition>>;
  identity?: string;
};

function createGalleryPosition() {
  let index = 0;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => index,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    select: (next: number) => {
      if (index === next) return;
      index = next;
      listeners.forEach((listener) => listener());
    }
  };
}

export function useTopicSplitDisclosureStore(identity?: string) {
  const initial = useMemo<TopicSplitDisclosureState>(
    () => ({ activeTabByKey: {}, expandedByKey: {}, galleries: new Map(), identity }),
    [identity]
  );
  const [state, setState] = useState(initial);
  const { activeTabByKey, expandedByKey, galleries } = state.identity === identity ? state : initial;
  useEffect(() => {
    setState((current) => (current.identity === identity ? current : initial));
  }, [identity, initial]);
  const selectTab = useCallback(
    (key: string, tabId: string) => {
      setState((current) => {
        const topic = current.identity === identity ? current : initial;
        if (topic.activeTabByKey[key] === tabId) return topic;
        return { ...topic, activeTabByKey: { ...topic.activeTabByKey, [key]: tabId } };
      });
    },
    [identity, initial]
  );
  const toggle = useCallback(
    (key: string, defaultExpanded: boolean) => {
      setState((current) => {
        const topic = current.identity === identity ? current : initial;
        const expanded = topic.expandedByKey;
        return {
          ...topic,
          expandedByKey: {
            ...expanded,
            [key]: Object.prototype.hasOwnProperty.call(expanded, key) ? !expanded[key] : !defaultExpanded
          }
        };
      });
    },
    [identity, initial]
  );
  return useMemo(
    () => ({ activeTabByKey, expandedByKey, galleries, selectTab, toggle }),
    [activeTabByKey, expandedByKey, galleries, selectTab, toggle]
  );
}

export function TopicSplitDisclosureProvider({
  children,
  value
}: {
  children: ReactNode;
  value: TopicSplitDisclosureStoreValue;
}) {
  return (
    <TopicSplitDisclosureStoreContext.Provider value={value}>{children}</TopicSplitDisclosureStoreContext.Provider>
  );
}

export function TopicSplitDisclosureScope({ children, scopeKey }: { children: ReactNode; scopeKey: string }) {
  return (
    <TopicSplitDisclosureScopeContext.Provider value={scopeKey}>{children}</TopicSplitDisclosureScopeContext.Provider>
  );
}

export function useTopicSplitDisclosureScopeKey() {
  return useContext(TopicSplitDisclosureScopeContext);
}

export function useTopicImageGallery(semanticId: string) {
  const store = useContext(TopicSplitDisclosureStoreContext);
  const scopeKey = useTopicSplitDisclosureScopeKey();
  if (!store || !scopeKey) throw new Error('TopicSplitDisclosureProvider and scope are required');
  const key = `${scopeKey}\u0000imageGallery\u0000${semanticId}`;
  let gallery = store.galleries.get(key);
  if (!gallery) {
    gallery = createGalleryPosition();
    store.galleries.set(key, gallery);
  }
  const index = useSyncExternalStore(gallery.subscribe, gallery.getSnapshot, gallery.getSnapshot);
  return { index, select: gallery.select };
}

function topicSplitDisclosureKey(scopeKey: string, kind: TopicSplitDisclosureKind, semanticId: string) {
  return `${scopeKey}\u0000${kind}\u0000${semanticId}`;
}

function topicTerminalReportKey(scopeKey: string, semanticId: string) {
  return `${scopeKey}\u0000terminalReport\u0000${semanticId}`;
}

function frameExpanded(
  frame: Extract<ForumContentAncestorFrame, { kind: 'callout' | 'details' }>,
  scopeKey: string,
  store: Pick<TopicSplitDisclosureStoreValue, 'expandedByKey'>
) {
  const key = topicSplitDisclosureKey(scopeKey, frame.kind, frame.semanticId);
  return Object.prototype.hasOwnProperty.call(store.expandedByKey, key)
    ? store.expandedByKey[key]
    : frame.defaultExpanded;
}

export function topicSemanticRowVisible(
  row: CompiledForumContentRow,
  scopeKey: string,
  store: Pick<TopicSplitDisclosureStoreValue, 'activeTabByKey' | 'expandedByKey'>
) {
  return row.ancestorFrames.every((frame) => {
    if (frame.kind === 'callout' || frame.kind === 'details') return frameExpanded(frame, scopeKey, store);
    if (frame.kind !== 'terminalTab') return true;
    const key = topicTerminalReportKey(scopeKey, frame.reportSemanticId);
    return (store.activeTabByKey[key] || frame.defaultTabId) === frame.tabId;
  });
}

export function useTopicSplitDisclosure({
  defaultExpanded,
  kind,
  semanticId
}: {
  defaultExpanded: boolean;
  kind: TopicSplitDisclosureKind;
  semanticId: string;
}) {
  const store = useContext(TopicSplitDisclosureStoreContext);
  const scopeKey = useTopicSplitDisclosureScopeKey();
  if (!store || !scopeKey) throw new Error('TopicSplitDisclosureProvider and scope are required');
  const key = topicSplitDisclosureKey(scopeKey, kind, semanticId);
  const expanded = Object.prototype.hasOwnProperty.call(store.expandedByKey, key)
    ? store.expandedByKey[key]
    : defaultExpanded;
  const toggle = useCallback(() => store.toggle(key, defaultExpanded), [defaultExpanded, key, store]);
  return { expanded, toggle };
}

export function useTopicTerminalReport({ defaultTabId, semanticId }: { defaultTabId: string; semanticId: string }) {
  const store = useContext(TopicSplitDisclosureStoreContext);
  const scopeKey = useTopicSplitDisclosureScopeKey();
  if (!store || !scopeKey) throw new Error('TopicSplitDisclosureProvider and scope are required');
  const key = topicTerminalReportKey(scopeKey, semanticId);
  const activeTabId = store.activeTabByKey[key] || defaultTabId;
  const select = useCallback(
    (tabId: string) => {
      if (tabId !== activeTabId) store.selectTab(key, tabId);
    },
    [activeTabId, key, store]
  );
  return { activeTabId, select };
}
