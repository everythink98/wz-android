import React from 'react';
import * as Clipboard from 'expo-clipboard';

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

jest.mock('react-native', () => {
  const actual = jest.requireActual<typeof import('react-native')>('react-native');
  Object.defineProperty(actual.Platform, 'OS', { configurable: true, value: 'android' });
  return actual;
});

jest.mock('expo-modules-core', () => {
  const ReactModule = require('react') as typeof React;
  const NativeView = require('react-native').View;
  const actual = jest.requireActual<typeof import('expo-modules-core')>('expo-modules-core');
  const NativeSelectionView = ReactModule.forwardRef(function NativeSelectionView(
    props: Record<string, unknown> & { children?: React.ReactNode },
    ref: React.Ref<unknown>
  ) {
    return ReactModule.createElement(NativeView, { ...props, ref }, props.children);
  });
  return {
    ...actual,
    requireNativeViewManager: (name: string) =>
      name === 'ForumContentSelection' ? NativeSelectionView : actual.requireNativeViewManager(name)
  };
});

jest.mock('@shopify/flash-list', () => {
  const ReactModule = require('react') as typeof React;
  const { View } = require('react-native') as typeof import('react-native');
  return {
    FlashList: ReactModule.forwardRef(function MockFlashList(
      {
        ListFooterComponent,
        ListHeaderComponent,
        accessibilityLabel,
        data = [],
        keyExtractor,
        renderItem,
        testID
      }: Record<string, any>,
      ref: React.ForwardedRef<unknown>
    ) {
      ReactModule.useImperativeHandle(ref, () => ({
        scrollToIndex: jest.fn(),
        scrollToOffset: jest.fn()
      }));
      const optional = (value: unknown): React.ReactNode =>
        typeof value === 'function'
          ? ReactModule.createElement(value as React.ComponentType)
          : (value as React.ReactNode);
      return ReactModule.createElement(
        View,
        { accessibilityLabel, testID },
        optional(ListHeaderComponent),
        data.map((item: unknown, index: number) =>
          ReactModule.createElement(
            View,
            { key: keyExtractor?.(item, index) || String(index) },
            renderItem?.({ index, item, target: 'Cell' }) as React.ReactNode
          )
        ),
        optional(ListFooterComponent)
      );
    }),
    useMappingHelper: () => ({ getMappingKey: (value: string) => value }),
    useRecyclingState: (initialValue: unknown) => ReactModule.useState(initialValue)
  };
});

jest.mock('expo-video', () => ({
  createVideoPlayer: jest.fn(),
  VideoView: () => null,
  useVideoPlayer: () => ({ pause: jest.fn(), play: jest.fn(), playing: false })
}));

jest.mock('@/features/topic/components/ReplyComposerSheet', () => ({ ReplyComposerSheet: () => null }));

import { QueryTestWrapper } from '../../../QueryTestWrapper';
import { fireEvent, render } from '../../../render';
import { topicVisualScenarios } from './manifest';

function renderScenario(id: string) {
  const scenario = topicVisualScenarios.find((candidate) => candidate.id === id);
  if (!scenario || scenario.kind !== 'rendered') throw new Error(`Missing rendered scenario: ${id}`);
  return render(<QueryTestWrapper>{scenario.render()}</QueryTestWrapper>);
}

describe('topic visual scenarios', () => {
  it('keeps every required four-site state addressable', () => {
    expect(topicVisualScenarios.filter(({ tags }) => tags.includes('main-post-actions')).map(({ id }) => id)).toEqual([
      'topic.actions.nodeseek.default',
      'topic.actions.nodeseek.selected',
      'topic.actions.nodeseek.success',
      'topic.actions.nodeseek.upvote-pending',
      'topic.actions.nodeseek.failure-rollback',
      'topic.actions.nodeseek.disabled',
      'topic.actions.linuxdo.default',
      'topic.actions.linuxdo.selected',
      'topic.actions.linuxdo.like-pending',
      'topic.actions.yaohuo.default',
      'topic.actions.yaohuo.selected',
      'topic.actions.yaohuo.unknown',
      'topic.actions.v2ex.readonly'
    ]);
    expect(
      topicVisualScenarios
        .filter(({ tags }) => tags.includes('main-post-actions'))
        .every(({ capabilityIds }) => capabilityIds.includes('WRITE-03'))
    ).toBe(true);
    expect(new Set(topicVisualScenarios.flatMap(({ capabilityIds }) => capabilityIds))).toEqual(
      new Set(['TOPIC-01', 'TOPIC-02', 'TOPIC-03', 'TOPIC-04', 'WRITE-01', 'WRITE-02', 'WRITE-03'])
    );
  });

  it('renders the real NodeSeek four-button chain and its selected, pending, and disabled states', async () => {
    const idle = await renderScenario('topic.actions.nodeseek.default');
    expect(idle.getByLabelText('点赞')).toBeTruthy();
    expect(idle.getByLabelText('加鸡腿')).toBeTruthy();
    expect(idle.getByLabelText('反对')).toBeTruthy();
    expect(idle.getByLabelText('收藏')).toBeTruthy();
    await idle.unmount();

    const selected = await renderScenario('topic.actions.nodeseek.selected');
    expect(selected.getByLabelText('已点赞').props.accessibilityState.selected).toBe(true);
    expect(selected.getByLabelText('已点赞').props.accessibilityState.disabled).toBe(true);
    expect(selected.getByLabelText('已加鸡腿').props.accessibilityState.selected).toBe(true);
    expect(selected.getByLabelText('已加鸡腿').props.accessibilityState.disabled).toBe(true);
    expect(selected.getByLabelText('已反对').props.accessibilityState.selected).toBe(true);
    expect(selected.getByLabelText('已反对').props.accessibilityState.disabled).toBe(true);
    expect(selected.getByLabelText('取消收藏').props.accessibilityState.selected).toBe(true);
    expect(selected.getByLabelText('取消收藏').props.accessibilityState.disabled).toBe(false);
    await selected.unmount();

    const success = await renderScenario('topic.actions.nodeseek.success');
    expect(success.getByLabelText('已点赞').props.accessibilityState).toMatchObject({
      disabled: true,
      selected: true
    });
    expect(success.getByLabelText('取消收藏').props.accessibilityState).toMatchObject({
      disabled: false,
      selected: true
    });
    await success.unmount();

    const pending = await renderScenario('topic.actions.nodeseek.upvote-pending');
    expect(pending.getByLabelText('点赞').props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    expect(pending.getByLabelText('加鸡腿').props.accessibilityState).toMatchObject({ busy: false, disabled: false });
    expect(pending.getByLabelText('反对').props.accessibilityState).toMatchObject({ busy: false, disabled: false });
    expect(pending.getByLabelText('收藏').props.accessibilityState).toMatchObject({
      busy: false,
      disabled: false
    });
    await pending.unmount();

    const rollback = await renderScenario('topic.actions.nodeseek.failure-rollback');
    expect(rollback.getByLabelText('点赞').props.accessibilityState).toMatchObject({
      busy: false,
      disabled: false,
      selected: false
    });
    expect(rollback.getByLabelText('收藏').props.accessibilityState).toMatchObject({
      busy: false,
      disabled: false,
      selected: false
    });
    await rollback.unmount();

    const disabled = await renderScenario('topic.actions.nodeseek.disabled');
    expect(disabled.getByLabelText('点赞').props.accessibilityState).toMatchObject({
      busy: false,
      disabled: true
    });
    expect(disabled.getByLabelText('收藏').props.accessibilityState.disabled).toBe(true);
    await disabled.unmount();
  });

  it('renders linux.do, Yaohuo, and V2EX through their production source branches', async () => {
    const linuxdo = await renderScenario('topic.actions.linuxdo.selected');
    expect(linuxdo.getByLabelText('取消赞').props.accessibilityState.selected).toBe(true);
    expect(linuxdo.getByLabelText('取消收藏').props.accessibilityState.selected).toBe(true);
    expect(linuxdo.getByLabelText('heart 8')).toBeTruthy();
    await linuxdo.unmount();

    const linuxdoPending = await renderScenario('topic.actions.linuxdo.like-pending');
    expect(linuxdoPending.getByLabelText('点赞').props.accessibilityState).toMatchObject({
      busy: true,
      disabled: true
    });
    expect(linuxdoPending.getByLabelText('收藏').props.accessibilityState).toMatchObject({
      busy: false,
      disabled: false
    });
    await linuxdoPending.unmount();

    const yaohuoUnknown = await renderScenario('topic.actions.yaohuo.unknown');
    expect(yaohuoUnknown.getByLabelText('收藏状态未加载').props.accessibilityState.disabled).toBe(true);
    expect(yaohuoUnknown.getByText('状态未知')).toBeTruthy();
    await yaohuoUnknown.unmount();

    const v2ex = await renderScenario('topic.actions.v2ex.readonly');
    expect(v2ex.getByText('UP 票')).toBeTruthy();
    expect(v2ex.getByText(' 336')).toBeTruthy();
    expect(v2ex.queryByLabelText('点赞')).toBeNull();
    await v2ex.unmount();
  });

  it('renders content, reply collection, local favorite, and menu states through production owners', async () => {
    const structured = await renderScenario('topic.content.structured');
    expect(structured.getByText('给长列表加上稳定的内容缓存')).toBeTruthy();
    expect(
      structured.getByText('缓存命中只说明找到了对应的数据。它不能代替内容版本检查，也不能决定页面应该滚动到哪里。')
    ).toBeTruthy();
    await structured.unmount();

    const replies = await renderScenario('topic.replies.populated');
    expect(replies.getAllByText(/回复列表/)).not.toHaveLength(0);
    expect(replies.getByText('第一条纯文本回复。')).toBeTruthy();
    expect(replies.getByLabelText('编辑回复')).toBeTruthy();
    expect(replies.getByLabelText('删除回复')).toBeTruthy();
    await replies.unmount();

    const loading = await renderScenario('topic.replies.loading');
    expect(loading.getByText('正在读取回复...')).toBeTruthy();
    await loading.unmount();

    const empty = await renderScenario('topic.replies.empty');
    expect(empty.getByText('暂无回复')).toBeTruthy();
    await empty.unmount();

    const partial = await renderScenario('topic.replies.partial-error');
    expect(partial.getByText('部分评论未能读取，已显示 2 条')).toBeTruthy();
    expect(partial.getByText('更多回复暂时不可用')).toBeTruthy();
    await partial.unmount();

    const loadingMore = await renderScenario('topic.replies.loading-more');
    expect(loadingMore.getByLabelText('正在加载...')).toBeTruthy();
    await loadingMore.unmount();

    const favorite = await renderScenario('topic.favorite.selected');
    expect(favorite.getByLabelText('已收藏到本机')).toBeTruthy();
    await favorite.unmount();

    const menu = await renderScenario('topic.menu.open');
    for (const label of ['分享', '刷新评论', '刷新全文', '阅读设置', '原站打开']) {
      expect(menu.getByLabelText(label)).toBeTruthy();
    }
    await menu.unmount();
  });

  it('classifies native media, list continuity, and system transitions as device-only', () => {
    for (const id of [
      'topic.media.native-interaction',
      'topic.replies.device-continuity',
      'topic.menu.system-transitions'
    ]) {
      const scenario = topicVisualScenarios.find((candidate) => candidate.id === id);
      expect(scenario).toMatchObject({ id, kind: 'device-only' });
      expect(scenario?.note).toBeTruthy();
    }
  });

  it('renders once-decoded NodeSeek bodies, native poll selections, and independent reply code', async () => {
    const copy = jest.spyOn(Clipboard, 'setStringAsync').mockResolvedValue(true);
    const view = await renderScenario('topic.content.entities');
    try {
      for (const text of [
        'Heading &lt;H&gt;',
        'Text <x> &lt;x&gt; &#32; &amp;nbsp;',
        'Column &lt;H&gt;',
        'Cell &#65; &amp;nbsp;',
        'Poll &lt;P&gt;',
        'Option &lt;A&gt;',
        'Cross &amp;#32;',
        'Reply <r> &lt;r&gt; &#32; &amp;nbsp;'
      ]) {
        expect(view.getByText(text)).toBeTruthy();
      }
      const options = view.getAllByRole('checkbox');
      expect(options).toHaveLength(2);
      expect(options[0].props.accessibilityState).toEqual({ checked: false, disabled: false });
      expect(options[1].props.accessibilityState).toEqual({ checked: false, disabled: false });
      await fireEvent.press(options[0]);
      expect(view.getAllByRole('checkbox')[0].props.accessibilityState.checked).toBe(true);
      expect(view.getAllByRole('checkbox')[1].props.accessibilityState.checked).toBe(false);
      await fireEvent.press(view.getAllByRole('checkbox')[1]);
      expect(view.getAllByRole('checkbox').every((option) => option.props.accessibilityState.checked)).toBe(true);
      await fireEvent.press(view.getAllByRole('checkbox')[0]);
      expect(view.getAllByRole('checkbox')[0].props.accessibilityState.checked).toBe(false);
      expect(view.getAllByRole('checkbox')[1].props.accessibilityState.checked).toBe(true);

      const copyButtons = view.getAllByLabelText('复制完整代码');
      expect(copyButtons).toHaveLength(2);
      await fireEvent.press(copyButtons[0]);
      expect(copy).toHaveBeenLastCalledWith('line <x>\n&lt;x&gt;\n&amp;#32;');
      await fireEvent.press(copyButtons[1]);
      expect(copy).toHaveBeenLastCalledWith('reply &lt;r&gt;\n&amp;#32;');
      expect(copy).toHaveBeenCalledTimes(2);

      const selection = view.getByTestId('topic-selection-surface');
      const rows: readonly { documentId: string; selectionToken: string }[] = selection.props.rows;
      expect(rows.every((row) => row.documentId === 'opening')).toBe(true);
      const opening = rows
        .map((row) => {
          const token: {
            prefix: readonly { text: string }[];
            owners: readonly { text: string; trailing: readonly { text: string }[] }[];
          } = JSON.parse(row.selectionToken);
          return (
            token.prefix.map((run) => run.text).join('') +
            token.owners.map((owner) => owner.text + owner.trailing.map((run) => run.text).join('')).join('')
          );
        })
        .join('');
      expect(opening).toBe(
        'Heading &lt;H&gt;\n' +
          'Text <x> &lt;x&gt; &#32; &amp;nbsp;\n' +
          'Column &lt;H&gt;\n' +
          'Cell &#65; &amp;nbsp;\n' +
          'line <x>\n&lt;x&gt;\n&amp;#32;\n' +
          'Before poll\nAfter poll\n'
      );
    } finally {
      await view.unmount();
      copy.mockRestore();
    }
  });
});
