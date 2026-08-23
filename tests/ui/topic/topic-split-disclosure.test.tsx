import { describe, expect, it } from '@jest/globals';
import { fireEvent, render } from '../render';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { compileForumContent, type CompiledForumContentRow } from '@/domain/forum/topicContentSplit';
import { TopicContentBlock } from '@/features/topic/components/TopicContentBlock';
import {
  TopicSplitDisclosureProvider,
  TopicSplitDisclosureScope,
  topicSemanticRowVisible,
  useTopicSplitDisclosureStore,
  useTopicTerminalReport
} from '@/features/topic/rendering/TopicSplitDisclosure';

type DisclosureRow = Extract<CompiledForumContentRow, { type: 'disclosureHeader' }>;

function visibleText(row: CompiledForumContentRow) {
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
  const rows = compileForumContent({ html, role: 'opening', source: 'linuxdo' }).rows;
  return (
    <TopicSplitDisclosureProvider value={store}>
      <TopicSplitDisclosureScope scopeKey={scopeKey}>
        <View>
          {rows
            .filter((row) => topicSemanticRowVisible(row, scopeKey, store))
            .map((row) =>
              row.type === 'disclosureHeader' ? (
                <TopicContentBlock key={row.keySuffix} contentWidth={320} row={row} />
              ) : (
                <Text key={row.keySuffix}>{visibleText(row)}</Text>
              )
            )}
        </View>
      </TopicSplitDisclosureScope>
    </TopicSplitDisclosureProvider>
  );
}

function RenderedDisclosureHeaderFixture({ html, scopeKey }: { html: string; scopeKey: string }) {
  const store = useTopicSplitDisclosureStore();
  const row = compileForumContent({ html, role: 'opening', source: 'linuxdo' }).rows.find(
    (candidate): candidate is DisclosureRow => candidate.type === 'disclosureHeader'
  );
  if (!row) throw new Error('Expected a disclosure header row');
  return (
    <TopicSplitDisclosureProvider value={store}>
      <TopicSplitDisclosureScope scopeKey={scopeKey}>
        <TopicContentBlock contentWidth={320} row={row} />
      </TopicSplitDisclosureScope>
    </TopicSplitDisclosureProvider>
  );
}

type TerminalReportHeaderRow = Extract<CompiledForumContentRow, { type: 'terminalReportHeader' }>;

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
  const rows = compileForumContent({
    html: '<forum-terminal-report><forum-terminal-tab title="First"><p>first body</p></forum-terminal-tab><forum-terminal-tab title="Second"><p>second body</p></forum-terminal-tab></forum-terminal-report>',
    role: 'opening',
    source: 'nodeseek'
  }).rows;
  return (
    <TopicSplitDisclosureProvider value={store}>
      <TopicSplitDisclosureScope scopeKey={scopeKey}>
        <View>
          {(visible ? rows : [])
            .filter((row) => topicSemanticRowVisible(row, scopeKey, store))
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
  it('[REG-TOPIC-111] keeps explicit frame edges and the title when expanded disclosures collapse', async () => {
    const fixtures = [
      {
        html: '<details open><summary>Details</summary><p>details body</p></details>',
        label: 'Details'
      },
      {
        html: '<blockquote data-forum-callout="true" data-forum-callout-type="quote" data-forum-callout-fold="expanded"><div class="forum-callout-title">Quote</div><div class="forum-callout-content"><p>callout body</p></div></blockquote>',
        label: 'Quote'
      }
    ];

    for (const { html, label } of fixtures) {
      const view = await render(<RenderedDisclosureHeaderFixture html={html} scopeKey={`opening-${label}`} />);
      let header = view.getByRole('button');
      expect(header.props.accessibilityState).toEqual({ expanded: true });
      expect(StyleSheet.flatten(header.parent?.props.style)).toMatchObject({
        borderBottomWidth: 0,
        borderTopWidth: StyleSheet.hairlineWidth
      });

      await fireEvent.press(header);

      header = view.getByRole('button');
      expect(header.props.accessibilityState).toEqual({ expanded: false });
      expect(view.getByText(label)).toBeTruthy();
      expect(StyleSheet.flatten(header.parent?.props.style)).toMatchObject({
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderTopWidth: StyleSheet.hairlineWidth
      });
      await view.unmount();
    }
  });

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

  it('[REG-TOPIC-056][REG-TOPIC-086] unmounts every typed details and callout body row from the real header state', async () => {
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
      await fireEvent.press(view.getByRole('button', { name: label }));
      expect(view.getAllByText(/body/).length).toBeGreaterThan(0);
      await fireEvent.press(view.getByRole('button', { name: label }));
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

    await fireEvent.press(view.getByRole('button', { name: 'First' }));
    expect(view.getAllByText(/body/).length).toBeGreaterThan(0);
    expect(view.getByRole('button', { name: 'Second' })).toBeTruthy();
  });

  it('resets route-local disclosure state when topic identity changes', async () => {
    const first = <DisclosureFixture html={splitDetails('Reset')} routeKey="topic-1" scopeKey="opening" />;
    const view = await render(first);
    await fireEvent.press(view.getByRole('button', { name: 'Reset' }));
    expect(view.getAllByText(/body/).length).toBeGreaterThan(0);

    await view.rerender(<DisclosureFixture html={splitDetails('Reset')} routeKey="topic-2" scopeKey="opening" />);
    expect(view.queryByText(/body/)).toBeNull();
  });
});
