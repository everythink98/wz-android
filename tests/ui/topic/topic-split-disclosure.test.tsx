import { describe, expect, it } from '@jest/globals';
import { fireEvent, render } from '../render';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { compileForumContent, type CompiledForumContentSegment } from '@/domain/forum/topicContentSplit';
import { forumContentRegionSegments } from '../../helpers/forumContentSegments';
import {
  TopicSplitDisclosureProvider,
  TopicSplitDisclosureScope,
  topicMaterializationRegionVisible,
  useTopicSplitDisclosure,
  useTopicSplitDisclosureStore,
  useTopicTerminalReport
} from '@/features/topic/rendering/TopicSplitDisclosure';

type DisclosureRow = Extract<CompiledForumContentSegment, { type: 'disclosureHeader' }>;

function Header({ row }: { row: DisclosureRow }) {
  const disclosure = useTopicSplitDisclosure({
    defaultExpanded: row.defaultExpanded,
    kind: row.disclosureKind,
    semanticId: row.semanticId
  });
  return (
    <Pressable accessibilityLabel={`toggle-${row.titleLabel}`} onPress={disclosure.toggle}>
      <Text>{row.titleLabel}</Text>
    </Pressable>
  );
}

function visibleText(row: CompiledForumContentSegment) {
  if (row.type === 'codeBlock') return row.text;
  return 'html' in row ? row.html.replace(/<[^>]+>/g, '').trim() : '';
}

function DisclosureFixture({
  html,
  routeKey = 'topic-1',
  scopeKey
}: {
  html: string;
  routeKey?: string;
  scopeKey: string;
}) {
  const store = useTopicSplitDisclosureStore(routeKey);
  const regions = compileForumContent({ html, role: 'opening', source: 'linuxdo' }).regions;
  return (
    <TopicSplitDisclosureProvider value={store}>
      <TopicSplitDisclosureScope scopeKey={scopeKey}>
        <View>
          {regions
            .filter((region) => topicMaterializationRegionVisible(region, scopeKey, store))
            .flatMap((region) => forumContentRegionSegments(region))
            .map((row) =>
              row.type === 'disclosureHeader' ? (
                <Header key={row.keySuffix} row={row} />
              ) : (
                <Text key={row.keySuffix}>{visibleText(row)}</Text>
              )
            )}
        </View>
      </TopicSplitDisclosureScope>
    </TopicSplitDisclosureProvider>
  );
}

type TerminalReportHeaderRow = Extract<CompiledForumContentSegment, { type: 'terminalReportHeader' }>;

function TerminalHeader({ row }: { row: TerminalReportHeaderRow }) {
  const report = useTopicTerminalReport({ defaultTabId: row.defaultTabId, semanticId: row.semanticId });
  return row.tabs.map((tab) => (
    <Pressable key={tab.id} accessibilityLabel={`select-${tab.title}`} onPress={() => report.select(tab.id)}>
      <Text>{tab.title}</Text>
    </Pressable>
  ));
}

function TerminalFixture({
  routeKey = 'topic-1',
  scopeKey,
  visible = true
}: {
  routeKey?: string;
  scopeKey: string;
  visible?: boolean;
}) {
  const store = useTopicSplitDisclosureStore(routeKey);
  const regions = compileForumContent({
    html: '<forum-terminal-report><forum-terminal-tab title="First"><p>first body</p></forum-terminal-tab><forum-terminal-tab title="Second"><p>second body</p></forum-terminal-tab></forum-terminal-report>',
    role: 'opening',
    source: 'nodeseek'
  }).regions;
  return (
    <TopicSplitDisclosureProvider value={store}>
      <TopicSplitDisclosureScope scopeKey={scopeKey}>
        <View>
          {(visible ? regions : [])
            .filter((region) => topicMaterializationRegionVisible(region, scopeKey, store))
            .flatMap((region) => forumContentRegionSegments(region))
            .map((row) =>
              row.type === 'terminalReportHeader' ? (
                <TerminalHeader key={row.keySuffix} row={row} />
              ) : (
                <Text key={row.keySuffix}>{visibleText(row)}</Text>
              )
            )}
        </View>
      </TopicSplitDisclosureScope>
    </TopicSplitDisclosureProvider>
  );
}

const splitDetails = (label: string) =>
  `<details><summary>${label}</summary><p>${Array.from(
    { length: 9 },
    (_, index) => `body-${index}<img src="https://img.example/${label}-${index}.jpg">`
  ).join('')}</p></details>`;

describe('typed topic disclosure state', () => {
  it('[REG-TOPIC-090] keeps terminal tab selection in route state while virtual rows rematerialize', async () => {
    const view = await render(<TerminalFixture scopeKey="opening" />);
    expect(view.getByText('first body')).toBeTruthy();
    expect(view.queryByText('second body')).toBeNull();

    await fireEvent.press(view.getByLabelText('select-Second'));
    expect(view.queryByText('first body')).toBeNull();
    expect(view.getByText('second body')).toBeTruthy();

    await view.rerender(<TerminalFixture scopeKey="opening" />);
    expect(view.getByText('second body')).toBeTruthy();

    await view.rerender(<TerminalFixture scopeKey="opening" visible={false} />);
    expect(view.queryByText('second body')).toBeNull();
    await view.rerender(<TerminalFixture scopeKey="opening" />);
    expect(view.getByText('second body')).toBeTruthy();

    await view.rerender(<TerminalFixture routeKey="topic-2" scopeKey="opening" />);
    expect(view.getByText('first body')).toBeTruthy();
    expect(view.queryByText('second body')).toBeNull();
  });

  it('[REG-TOPIC-086] filters every typed details and callout body row with one semantic identity', async () => {
    const fixtures = [
      { html: splitDetails('Details'), label: 'Details' },
      {
        html: '<blockquote data-forum-callout="true" data-forum-callout-type="warning" data-forum-callout-fold="collapsed"><div class="forum-callout-title">Warning</div><div class="forum-callout-content"><p>callout body</p></div></blockquote>',
        label: 'Warning'
      }
    ];
    for (const { html, label } of fixtures) {
      const view = await render(<DisclosureFixture html={html} scopeKey="opening" />);
      expect(view.queryByText(/body/)).toBeNull();
      await fireEvent.press(view.getByLabelText(`toggle-${label}`));
      expect(view.getAllByText(/body/).length).toBeGreaterThan(0);
      await fireEvent.press(view.getByLabelText(`toggle-${label}`));
      expect(view.queryByText(/body/)).toBeNull();
      await view.unmount();
    }
  });

  it('isolates equal semantic ids by content scope', async () => {
    const view = await render(
      <>
        <DisclosureFixture html={splitDetails('First')} scopeKey="opening-copy-a" />
        <DisclosureFixture html={splitDetails('Second')} scopeKey="opening-copy-b" />
      </>
    );

    await fireEvent.press(view.getByLabelText('toggle-First'));
    expect(view.getAllByText(/body/).length).toBeGreaterThan(0);
    expect(view.getByLabelText('toggle-Second')).toBeTruthy();
  });

  it('resets route-local disclosure state when topic identity changes', async () => {
    const first = <DisclosureFixture html={splitDetails('Reset')} routeKey="topic-1" scopeKey="opening" />;
    const view = await render(first);
    await fireEvent.press(view.getByLabelText('toggle-Reset'));
    expect(view.getAllByText(/body/).length).toBeGreaterThan(0);

    await view.rerender(<DisclosureFixture html={splitDetails('Reset')} routeKey="topic-2" scopeKey="opening" />);
    expect(view.queryByText(/body/)).toBeNull();
  });
});
