import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

type TopicSplitDisclosureKind = 'callout' | 'details';
type TopicSplitDisclosurePart = 'first' | 'middle' | 'last' | 'only';

type TopicSplitDisclosureStoreValue = {
  expandedByKey: Readonly<Record<string, boolean>>;
  toggle: (key: string, defaultExpanded: boolean) => void;
};

const TopicSplitDisclosureStoreContext = createContext<TopicSplitDisclosureStoreValue | null>(null);
const TopicSplitDisclosureScopeContext = createContext<string | null>(null);

export function TopicSplitDisclosureProvider({ children }: { children: ReactNode }) {
  const [expandedByKey, setExpandedByKey] = useState<Record<string, boolean>>({});
  const toggle = useCallback((key: string, defaultExpanded: boolean) => {
    setExpandedByKey((current) => ({
      ...current,
      [key]: Object.prototype.hasOwnProperty.call(current, key) ? !current[key] : !defaultExpanded
    }));
  }, []);
  const value = useMemo(() => ({ expandedByKey, toggle }), [expandedByKey, toggle]);
  return (
    <TopicSplitDisclosureStoreContext.Provider value={value}>{children}</TopicSplitDisclosureStoreContext.Provider>
  );
}

export function TopicSplitDisclosureScope({ children, scopeKey }: { children: ReactNode; scopeKey: string }) {
  return (
    <TopicSplitDisclosureScopeContext.Provider value={scopeKey}>{children}</TopicSplitDisclosureScopeContext.Provider>
  );
}

function disclosureAttributes(kind: TopicSplitDisclosureKind) {
  return kind === 'details'
    ? { group: 'data-wz-details-group', part: 'data-wz-details-part' }
    : { group: 'data-wz-callout-group', part: 'data-wz-callout-part' };
}

function splitPart(value: string | undefined): TopicSplitDisclosurePart | null {
  return value === 'first' || value === 'middle' || value === 'last' || value === 'only' ? value : null;
}

export function useTopicSplitDisclosure({
  attributes,
  defaultExpanded,
  kind
}: {
  attributes: Readonly<Record<string, string | undefined>>;
  defaultExpanded: boolean;
  kind: TopicSplitDisclosureKind;
}) {
  const store = useContext(TopicSplitDisclosureStoreContext);
  const scopeKey = useContext(TopicSplitDisclosureScopeContext);
  const [localExpanded, setLocalExpanded] = useState(defaultExpanded);
  const names = disclosureAttributes(kind);
  const group = attributes[names.group] || '';
  const part = splitPart(attributes[names.part]);
  const isShared = Boolean(store && scopeKey && group && part && part !== 'only');
  const sharedKey = isShared ? `${scopeKey}\u0000${kind}\u0000${group}` : '';
  const expanded =
    isShared && store
      ? Object.prototype.hasOwnProperty.call(store.expandedByKey, sharedKey)
        ? store.expandedByKey[sharedKey]
        : defaultExpanded
      : localExpanded;
  const toggle = useCallback(() => {
    if (isShared && store) {
      store.toggle(sharedKey, defaultExpanded);
      return;
    }
    setLocalExpanded((current) => !current);
  }, [defaultExpanded, isShared, sharedKey, store]);

  return {
    expanded,
    headerVisible: !(group && (part === 'middle' || part === 'last')),
    shared: isShared,
    toggle
  };
}
