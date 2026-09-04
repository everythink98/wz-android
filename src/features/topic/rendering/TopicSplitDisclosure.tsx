import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { CompiledForumContentRow, ForumContentAncestorFrame } from '@/domain/forum/topicContentSplit';

export type TopicSplitDisclosureKind = 'callout' | 'details';

export type TopicSplitDisclosureStoreValue = {
  activeTabByKey: Readonly<Record<string, string>>;
  expandedByKey: Readonly<Record<string, boolean>>;
  selectTab: (key: string, tabId: string) => void;
  toggle: (key: string, defaultExpanded: boolean) => void;
};

const TopicSplitDisclosureStoreContext = createContext<TopicSplitDisclosureStoreValue | null>(null);
const TopicSplitDisclosureScopeContext = createContext<string | null>(null);

type TopicSplitDisclosureState = {
  activeTabByKey: Record<string, string>;
  expandedByKey: Record<string, boolean>;
  identity?: string;
};

const EMPTY_ACTIVE_TABS: Readonly<Record<string, string>> = {};
const EMPTY_DISCLOSURES: Readonly<Record<string, boolean>> = {};

export function useTopicSplitDisclosureStore(identity?: string) {
  const [state, setState] = useState<TopicSplitDisclosureState>(() => ({
    activeTabByKey: {},
    expandedByKey: {},
    identity
  }));
  const activeTabByKey = state.identity === identity ? state.activeTabByKey : EMPTY_ACTIVE_TABS;
  const expandedByKey = state.identity === identity ? state.expandedByKey : EMPTY_DISCLOSURES;
  useEffect(() => {
    setState((current) =>
      current.identity === identity ? current : { activeTabByKey: {}, expandedByKey: {}, identity }
    );
  }, [identity]);
  const selectTab = useCallback(
    (key: string, tabId: string) => {
      setState((current) => {
        const activeTabs = current.identity === identity ? current.activeTabByKey : {};
        if (activeTabs[key] === tabId && current.identity === identity) return current;
        return {
          activeTabByKey: { ...activeTabs, [key]: tabId },
          expandedByKey: current.identity === identity ? current.expandedByKey : {},
          identity
        };
      });
    },
    [identity]
  );
  const toggle = useCallback(
    (key: string, defaultExpanded: boolean) => {
      setState((current) => {
        const expanded = current.identity === identity ? current.expandedByKey : {};
        return {
          activeTabByKey: current.identity === identity ? current.activeTabByKey : {},
          expandedByKey: {
            ...expanded,
            [key]: Object.prototype.hasOwnProperty.call(expanded, key) ? !expanded[key] : !defaultExpanded
          },
          identity
        };
      });
    },
    [identity]
  );
  return useMemo(
    () => ({ activeTabByKey, expandedByKey, selectTab, toggle }),
    [activeTabByKey, expandedByKey, selectTab, toggle]
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

export function topicSplitDisclosureKey(scopeKey: string, kind: TopicSplitDisclosureKind, semanticId: string) {
  return `${scopeKey}\u0000${kind}\u0000${semanticId}`;
}

export function topicTerminalReportKey(scopeKey: string, semanticId: string) {
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
