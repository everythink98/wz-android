import React from 'react';

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
import { render } from '../../../render';
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
      new Set(['TOPIC-01', 'TOPIC-02', 'TOPIC-03', 'TOPIC-04', 'WRITE-02', 'WRITE-03'])
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
    expect(structured.getByText('正文排版标题')).toBeTruthy();
    expect(structured.getByText('引用内容用于检查层级与留白。')).toBeTruthy();
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
});
