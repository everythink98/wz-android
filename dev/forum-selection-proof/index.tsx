import 'expo-dev-client';
import { registerRootComponent } from 'expo';
import { useRef, useState } from 'react';
import { Button, Text, View, useWindowDimensions } from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { compileForumContent } from '@/domain/forum/topicContentSplit';
import {
  TopicSelectionSurface,
  TopicSelectionRowProvider,
  useTopicSelectionRowRef
} from '@/features/topic/selection/TopicSelectionSurface';
import { TopicHorizontalScroll, TopicTableScrollProvider } from '@/features/topic/rendering/topicTableRenderers';
import { TopicSplitDisclosureScope } from '@/features/topic/rendering/TopicSplitDisclosure';

const wide = 'one two three four five six seven eight nine ten '.repeat(5);
const rows = [
  '有无适合新手练手的 🐣 ，最好月抛',
  wide,
  wide,
  wide,
  ...Array.from(
    { length: 60 },
    (_, index) => `段落 ${index + 1}。跨行选择 😀 e\u0301 中文与 English。\n上下经过空白，保持连续端点。`
  )
].map((text, index) => ({
  text,
  key: `proof:${index}`,
  index,
  selectionToken: compileForumContent({ html: `<pre>${text}</pre>`, role: 'opening', source: 'nodeseek' }).rows[0]!
    .selectionToken
}));
const items = rows.map((row) => ({
  documentId: 'opening' as const,
  rowKey: row.key,
  selectionToken: row.selectionToken
}));

function ProofRow({ item, width, refs }: { item: (typeof rows)[number]; width: number; refs: Map<number, Text> }) {
  const marker = useTopicSelectionRowRef(item.key);
  const horizontal = item.index >= 1 && item.index <= 3;
  const text = (
    <Text
      ref={(view) => {
        if (view) refs.set(item.index, view);
        else refs.delete(item.index);
      }}
      style={{ fontSize: 18, lineHeight: 28, ...(horizontal ? { width: 2300 } : {}) }}
    >
      {item.text}
    </Text>
  );
  return (
    <TopicSelectionRowProvider active>
      <View {...marker} collapsable={false} style={{ paddingVertical: 16 }}>
        {horizontal ? (
          <TopicHorizontalScroll
            accessibilityLabel={`片段 ${item.index}`}
            testID={`proof-horizontal-${item.index}`}
            semanticId={item.index === 3 ? 'unrelated' : 'same-table'}
            contentWidth={2300}
            viewportWidth={width}
          >
            {text}
          </TopicHorizontalScroll>
        ) : (
          text
        )}
      </View>
    </TopicSelectionRowProvider>
  );
}

function ForumSelectionProof() {
  const { width } = useWindowDimensions();
  const list = useRef<FlashListRef<(typeof rows)[number]>>(null);
  const refs = useRef(new Map<number, Text>());
  const [result, setResult] = useState('Measure reads actual Fabric text positions.');
  function measure() {
    const positions: number[] = [];
    for (const index of [1, 2, 3])
      refs.current.get(index)?.measureInWindow((x) => {
        positions[index - 1] = x;
        if (positions.filter(Number.isFinite).length === 3)
          setResult(`x=${positions.map((v) => v.toFixed(1)).join(',')}`);
      });
  }
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#ffffff', paddingTop: 50 }}>
      <Text style={{ color: '#000000' }}>Selection event / shared table / FlashList proof</Text>
      <Button title="Measure mounted text" onPress={measure} />
      <Text testID="selection-proof-result">{result}</Text>
      <TopicTableScrollProvider>
        <TopicSplitDisclosureScope scopeKey="opening">
          <TopicSelectionSurface active items={items} listRef={list} sessionKey="forum-selection-proof">
            <FlashList
              ref={list}
              data={rows}
              keyExtractor={(item) => item.key}
              renderItem={({ item }) => <ProofRow item={item} width={width - 32} refs={refs.current} />}
              contentContainerStyle={{ paddingHorizontal: 16 }}
            />
          </TopicSelectionSurface>
        </TopicSplitDisclosureScope>
      </TopicTableScrollProvider>
    </GestureHandlerRootView>
  );
}

registerRootComponent(ForumSelectionProof);
