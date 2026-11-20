import { useEffect, useMemo, useRef } from 'react';
import { FlatList } from 'react-native';
import type { Category } from '@/domain/forum/models';
import { AppButton } from '@/ui/controls/ButtonControls';
import { EmptyText, LoadingState } from '@/ui/controls/FeedbackStates';
import { FilterOptionRow, type FilterAppearance } from './SearchFilterControls';

const commonNodes: Category[] = [
  { source: 'v2ex', id: 'qna', name: '问与答' },
  { source: 'v2ex', id: 'programmer', name: '程序员' },
  { source: 'v2ex', id: 'create', name: '分享创造' },
  { source: 'v2ex', id: 'jobs', name: '酷工作' }
];

export function v2exSearchNodes(recent: Category[], directory: Category[] = []) {
  const nodes = new Map<string, Category>();
  for (const group of [commonNodes, recent, directory]) {
    for (const node of group) nodes.set(node.id, node);
  }
  return [...nodes.values()];
}

export function V2exNodePicker({
  nodes,
  query,
  selected,
  height,
  loading,
  error,
  retry,
  onSelect,
  ...appearance
}: FilterAppearance & {
  nodes: Category[];
  query: string;
  selected: string;
  height: number;
  loading: boolean;
  error: boolean;
  retry: () => void;
  onSelect: (id: string) => void;
}) {
  const list = useRef<FlatList<Pick<Category, 'id' | 'name'>>>(null);
  useEffect(() => {
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }, [query]);
  const options = useMemo(() => {
    const term = query.trim().toLowerCase();
    const current = selected && (nodes.find((node) => node.id === selected) ?? { id: selected, name: selected });
    const ordered = current ? [current, ...nodes.filter((node) => node.id !== selected)] : nodes;
    return term
      ? ordered.filter(({ id, name }) => name.toLowerCase().includes(term) || id.toLowerCase().includes(term))
      : ordered;
  }, [nodes, query, selected]);

  return (
    <FlatList
      ref={list}
      testID="search-filter-body-nodes"
      style={[appearance.styles.searchFilterBody, { height }]}
      keyboardShouldPersistTaps="handled"
      overScrollMode="never"
      data={options}
      keyExtractor={(node) => node.id}
      ListHeaderComponent={
        <>
          <FilterOptionRow
            {...appearance}
            label="节点 全部节点"
            testID="search-filter-all-nodes"
            title="全部节点"
            checked={!selected}
            onPress={() => onSelect('')}
          />
          {error ? <AppButton compact label="节点目录加载失败，重试" variant="ghost" onPress={retry} /> : null}
        </>
      }
      renderItem={({ item }) => (
        <FilterOptionRow
          {...appearance}
          label={`节点 ${item.name}`}
          testID={`search-filter-node-option-${item.id}`}
          title={item.name}
          detail={item.name.toLowerCase() !== item.id.toLowerCase() ? item.id : undefined}
          checked={selected === item.id}
          onPress={() => onSelect(item.id)}
        />
      )}
      ListEmptyComponent={!loading && !error ? <EmptyText text="没有匹配节点" /> : null}
      ListFooterComponent={loading ? <LoadingState compact text="加载节点目录中" /> : null}
    />
  );
}
