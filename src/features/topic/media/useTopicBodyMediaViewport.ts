import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CompiledForumContentRow } from '@/domain/forum/topicContentSplit';
import { getReplyKey } from '../model/replyListModel';
import type { TopicListItem } from '../model/topicListModel';

type ViewableTopicListItem = {
  index?: number | null;
  isViewable?: boolean;
  item: TopicListItem;
};

type RegionSnapshot = {
  identity: string;
  rowKeys: readonly string[];
};

type ViewportSnapshot = {
  regions: readonly RegionSnapshot[];
  rowKeys: readonly string[];
  scrollingForward: boolean;
  sessionIdentity: string;
  visibleRowKeys: readonly string[];
};

type ViewportItemMetadata = {
  indexByKey: ReadonlyMap<string, number>;
  regionMembership: ReadonlyMap<string, readonly string[]>;
};

function compiledRow(item: TopicListItem): CompiledForumContentRow | null {
  if (item.type === 'topicContent' || item.type === 'topicQuoteContent' || item.type === 'topicAcceptedAnswerContent') {
    return item.content.type === 'accessNotice' ? null : item.content.row;
  }
  if (item.type === 'topicQuoteSummary') return item.content.row;
  if (item.type === 'replyContent' || item.type === 'replyQuoteContent') return item.content;
  if (item.type === 'replySignatureContent') return item.content;
  return null;
}

function contentScope(item: TopicListItem) {
  if (item.type === 'topicQuoteSummary') return `topic-quote:${item.content.instanceKey}`;
  if (item.type === 'topicQuoteContent') return `topic-quote:${item.instanceKey}`;
  if (item.type === 'topicAcceptedAnswerContent') return item.key.split(':', 1)[0];
  if (item.type === 'topicContent') return 'opening';
  if (item.type === 'replyQuoteSummary' || item.type === 'replyQuoteContent')
    return `reply-quote:${item.key.split(':body:', 1)[0]}`;
  if (item.type === 'replyContent') return `reply:${getReplyKey(item.reply)}:body`;
  if (item.type === 'replySignatureContent') return `reply:${getReplyKey(item.reply)}:signature`;
  return '';
}

function dynamicRegionIdentities(item: TopicListItem) {
  const identities: string[] = [];
  if (item.type === 'topicQuoteSummary' || item.type === 'topicQuoteContent') {
    identities.push(`quote:${item.type === 'topicQuoteSummary' ? item.content.instanceKey : item.instanceKey}`);
  }
  if (item.type === 'replyQuoteSummary' || item.type === 'replyQuoteContent') {
    identities.push(`quote:${item.type === 'replyQuoteSummary' ? item.key : item.instanceKey}`);
  }
  if (item.type === 'topicAcceptedAnswer' || item.type === 'topicAcceptedAnswerContent') {
    identities.push(`accepted:${item.key.split(':', 1)[0]}`);
  }

  const row = compiledRow(item);
  const scope = contentScope(item);
  if (!row || !scope) return identities;
  if (row.type === 'disclosureHeader') {
    identities.push(`${scope}:disclosure:${row.disclosureKind}:${row.semanticId}`);
  }
  if (row.type === 'terminalReportHeader') {
    identities.push(`${scope}:terminal:${row.semanticId}`);
  }
  row.ancestorFrames.forEach((frame) => {
    if (frame.kind === 'details' || frame.kind === 'callout') {
      identities.push(`${scope}:disclosure:${frame.kind}:${frame.semanticId}`);
    } else if (frame.kind === 'terminalTab') {
      identities.push(`${scope}:terminal:${frame.reportSemanticId}`);
    }
  });
  return [...new Set(identities)];
}

function createViewportItemMetadata(items: readonly TopicListItem[]): ViewportItemMetadata {
  const indexByKey = new Map<string, number>();
  const membership = new Map<string, string[]>();
  items.forEach((item, index) => {
    indexByKey.set(item.key, index);
    dynamicRegionIdentities(item).forEach((identity) => {
      const rowKeys = membership.get(identity) || [];
      rowKeys.push(item.key);
      membership.set(identity, rowKeys);
    });
  });
  return { indexByKey, regionMembership: membership };
}

function sameKeys(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function sameSnapshot(left: ViewportSnapshot, right: ViewportSnapshot) {
  return (
    left.sessionIdentity === right.sessionIdentity &&
    left.scrollingForward === right.scrollingForward &&
    sameKeys(left.rowKeys, right.rowKeys) &&
    sameKeys(left.visibleRowKeys, right.visibleRowKeys) &&
    left.regions.length === right.regions.length &&
    left.regions.every(
      (region, index) =>
        region.identity === right.regions[index]?.identity &&
        sameKeys(region.rowKeys, right.regions[index]?.rowKeys || [])
    )
  );
}

function emptySnapshot(sessionIdentity: string): ViewportSnapshot {
  return {
    regions: [],
    rowKeys: [],
    scrollingForward: true,
    sessionIdentity,
    visibleRowKeys: []
  };
}

function directionalWindowIndexes(visibleIndexes: readonly number[], scrollingForward: boolean, itemCount: number) {
  const firstVisibleIndex = visibleIndexes[0];
  const lastVisibleIndex = visibleIndexes.at(-1);
  if (firstVisibleIndex === undefined || lastVisibleIndex === undefined) return [];
  const nearbyIndexes = scrollingForward
    ? [lastVisibleIndex + 1, lastVisibleIndex + 2, firstVisibleIndex - 1]
    : [firstVisibleIndex - 1, firstVisibleIndex - 2, lastVisibleIndex + 1];
  return [...new Set([...visibleIndexes, ...nearbyIndexes])].filter((index) => index >= 0 && index < itemCount);
}

function reconcileSnapshot(
  snapshot: ViewportSnapshot,
  items: readonly TopicListItem[],
  metadata: ViewportItemMetadata,
  sessionIdentity: string
): ViewportSnapshot {
  if (snapshot.sessionIdentity !== sessionIdentity) return emptySnapshot(sessionIdentity);

  const { indexByKey, regionMembership: membership } = metadata;
  const stableRowKeys = snapshot.rowKeys.filter((key) => indexByKey.has(key));
  const stableVisibleRowKeys = snapshot.visibleRowKeys.filter((key) => indexByKey.has(key));
  if (!snapshot.regions.length) {
    const next = { ...snapshot, rowKeys: stableRowKeys, visibleRowKeys: stableVisibleRowKeys };
    return sameSnapshot(snapshot, next) ? snapshot : next;
  }
  const changedRegions = snapshot.regions.filter(
    (region) => !sameKeys(region.rowKeys, membership.get(region.identity) || [])
  );
  if (!changedRegions.length) {
    const next = { ...snapshot, rowKeys: stableRowKeys, visibleRowKeys: stableVisibleRowKeys };
    return sameSnapshot(snapshot, next) ? snapshot : next;
  }

  const projectedVisibleRowKeys = new Set<string>();
  changedRegions.forEach((region) => {
    const currentRegionRowKeys = membership.get(region.identity) || [];
    snapshot.visibleRowKeys.forEach((visibleKey) => {
      const previousOrdinal = region.rowKeys.indexOf(visibleKey);
      if (previousOrdinal < 0) return;
      if (indexByKey.has(visibleKey)) {
        projectedVisibleRowKeys.add(visibleKey);
        return;
      }
      const replacementKey = currentRegionRowKeys[Math.min(previousOrdinal, currentRegionRowKeys.length - 1)];
      if (replacementKey) projectedVisibleRowKeys.add(replacementKey);
    });
  });

  const projectedVisibleIndexes = [...projectedVisibleRowKeys]
    .map((key) => indexByKey.get(key))
    .filter((index): index is number => index !== undefined)
    .sort((left, right) => left - right);
  if (!projectedVisibleIndexes.length) {
    return {
      ...snapshot,
      regions: [],
      rowKeys: stableRowKeys,
      visibleRowKeys: stableVisibleRowKeys
    };
  }

  const changedRegionRowKeys = new Set(changedRegions.flatMap((region) => membership.get(region.identity) || []));
  const stableRowKeySet = new Set(stableRowKeys);
  const rowKeys = directionalWindowIndexes(projectedVisibleIndexes, snapshot.scrollingForward, items.length)
    .map((index) => items[index]?.key)
    .filter((key): key is string => Boolean(key && (stableRowKeySet.has(key) || changedRegionRowKeys.has(key))));
  const visibleRowKeys = [...projectedVisibleRowKeys];
  const regions = snapshot.regions.flatMap((region): RegionSnapshot[] => {
    const currentRegionRowKeys = membership.get(region.identity) || [];
    return visibleRowKeys.some((key) => currentRegionRowKeys.includes(key))
      ? [{ identity: region.identity, rowKeys: currentRegionRowKeys }]
      : [];
  });
  return { ...snapshot, regions, rowKeys, visibleRowKeys };
}

export function useTopicBodyMediaViewport({
  items,
  sessionIdentity
}: {
  items: readonly TopicListItem[];
  sessionIdentity: string;
}) {
  const [snapshot, setSnapshot] = useState<ViewportSnapshot>(() => emptySnapshot(sessionIdentity));
  const previousVisibleRef = useRef({ firstIndex: -1, sessionIdentity });
  const itemMetadata = useMemo(() => createViewportItemMetadata(items), [items]);
  const reconciledSnapshot = useMemo(
    () => reconcileSnapshot(snapshot, items, itemMetadata, sessionIdentity),
    [itemMetadata, items, sessionIdentity, snapshot]
  );

  useLayoutEffect(() => {
    if (!sameSnapshot(snapshot, reconciledSnapshot)) setSnapshot(reconciledSnapshot);
  }, [reconciledSnapshot, snapshot]);

  const observeViewableItems = useCallback(
    ({ viewableItems }: { viewableItems: readonly ViewableTopicListItem[] }) => {
      const { indexByKey, regionMembership: membership } = itemMetadata;
      const visibleIndexes = [
        ...new Set(
          viewableItems.flatMap(({ index, isViewable, item }) => {
            if (isViewable === false) return [];
            const stableIndex = indexByKey.get(item.key);
            if (stableIndex !== undefined) return [stableIndex];
            return typeof index === 'number' && items[index]?.key === item.key ? [index] : [];
          })
        )
      ].sort((left, right) => left - right);
      const firstVisibleIndex = visibleIndexes[0];
      const previous = previousVisibleRef.current;
      const scrollingForward =
        previous.sessionIdentity !== sessionIdentity ||
        firstVisibleIndex === undefined ||
        previous.firstIndex < 0 ||
        firstVisibleIndex >= previous.firstIndex;
      previousVisibleRef.current = { firstIndex: firstVisibleIndex ?? -1, sessionIdentity };

      const visibleRowKeys = visibleIndexes
        .map((index) => items[index]?.key)
        .filter((key): key is string => Boolean(key));
      const rowKeys = directionalWindowIndexes(visibleIndexes, scrollingForward, items.length)
        .map((index) => items[index]?.key)
        .filter((key): key is string => Boolean(key));
      const activeRegionIdentities = [
        ...new Set(visibleIndexes.flatMap((index) => (items[index] ? dynamicRegionIdentities(items[index]) : [])))
      ];
      setSnapshot({
        regions: activeRegionIdentities.map((identity) => ({ identity, rowKeys: membership.get(identity) || [] })),
        rowKeys,
        scrollingForward,
        sessionIdentity,
        visibleRowKeys
      });
    },
    [itemMetadata, items, sessionIdentity]
  );

  return {
    observeViewableItems,
    visibleRowKeys: reconciledSnapshot.visibleRowKeys,
    viewportRowKeys: reconciledSnapshot.rowKeys
  };
}
