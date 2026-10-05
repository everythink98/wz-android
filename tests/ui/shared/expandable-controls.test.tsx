import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ReduceMotion } from 'react-native-reanimated';
import { ChevronDown } from 'lucide-react-native';
import { DisclosureChevron, ExpandableContent, ExpandablePanel, MenuButton } from '@/ui/controls/ExpandableControls';
import { fireEvent, render } from '../render';

let mockProgress = 0.5;
let mockNativeAnimation = false;
const mockWithTiming = jest.fn((value: number | string, _config: unknown) =>
  mockNativeAnimation
    ? { current: value }
    : typeof value === 'string'
      ? value
      : value === 0
        ? 0.25
        : value * mockProgress
);

jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual<Record<string, unknown>>('react-native-reanimated/mock'),
  useSharedValue: (initial: number) => {
    const { useRef } = jest.requireActual<typeof import('react')>('react');
    return useRef({
      value: initial,
      set(value: number) {
        this.value = value;
      }
    }).current;
  },
  withTiming: (value: number, config: unknown) => mockWithTiming(value, config)
}));

jest.mock('lucide-react-native', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { ChevronDown: () => React.createElement(View, { testID: 'disclosure-arrow' }), ChevronRight: () => null };
});

beforeEach(() => {
  mockProgress = 0.5;
  mockNativeAnimation = false;
  mockWithTiming.mockClear();
});

describe('MenuButton', () => {
  it('does not reserve a subtitle row for an empty value', async () => {
    const view = await render(<MenuButton icon={ChevronDown} label="收藏" value="" onPress={jest.fn()} />);
    const button = view.getByRole('button', { name: '收藏' });

    expect(button.queryAll((node) => node.type === 'Text')).toHaveLength(1);
    expect(StyleSheet.flatten(button.props.style)).toMatchObject({ alignItems: 'center', minHeight: 48 });
  });

  it.each(['0', '已连接'])('keeps the visible subtitle %s', async (value) => {
    const view = await render(<MenuButton icon={ChevronDown} label="服务器代理" value={value} onPress={jest.fn()} />);

    expect(view.getByText(value)).toBeTruthy();
    expect(view.getByRole('button').queryAll((node) => node.type === 'Text')).toHaveLength(2);
  });
});

describe('ExpandablePanel', () => {
  it('fits changed content immediately while already expanded', async () => {
    mockProgress = 1;
    const view = await render(
      <ExpandableContent expanded>
        <Text testID="account-content">缓存账号</Text>
      </ExpandableContent>
    );
    const measured = view.getByTestId('account-content').parent;
    const body = measured?.parent;
    if (!measured || !body) throw new Error('Missing disclosure content');

    for (const height of [240, 380, 200]) {
      mockWithTiming.mockClear();
      await fireEvent(measured, 'layout', { nativeEvent: { layout: { height, width: 320 } } });
      await view.rerender(
        <ExpandableContent expanded>
          <Text testID="account-content">缓存账号 {height}</Text>
        </ExpandableContent>
      );

      expect(StyleSheet.flatten(body.props.style)).toMatchObject({ height, opacity: 1 });
      expect(mockWithTiming).not.toHaveBeenCalledWith(height, expect.anything());
      expect(body.props.pointerEvents).toBe('auto');
    }
  });

  it('keeps disclosure rotation valid while opening and closing', async () => {
    mockNativeAnimation = true;
    const view = await render(<DisclosureChevron expanded={false} color="#333333" />);
    const chevron = view.getByTestId('disclosure-arrow', { includeHiddenElements: true }).parent;
    if (!chevron) throw new Error('Missing disclosure rotation');
    expect(StyleSheet.flatten(chevron.props.style).transform).toEqual([{ rotate: { current: '0deg' } }]);
    await view.rerender(<DisclosureChevron expanded color="#333333" />);
    expect(StyleSheet.flatten(chevron.props.style).transform).toEqual([{ rotate: { current: '180deg' } }]);
  });
  it('keeps drafts while animating both directions and blocks collapsed content before animation finishes', async () => {
    const saveDraft = jest.fn();
    const expandedChanges = jest.fn();

    function DraftContent() {
      const [draft, setDraft] = useState('');
      return (
        <View testID="draft-content">
          <TextInput accessibilityLabel="草稿" value={draft} onChangeText={setDraft} />
          <Pressable accessibilityRole="button" accessibilityLabel="保存草稿" onPress={() => saveDraft(draft)}>
            <Text>保存草稿</Text>
          </Pressable>
        </View>
      );
    }

    function Panel() {
      const [expanded, setExpanded] = useState(false);
      return (
        <ExpandablePanel
          expanded={expanded}
          title="测试面板"
          onExpandedChange={(next) => {
            expandedChanges(next);
            setExpanded(next);
          }}
        >
          <DraftContent />
        </ExpandablePanel>
      );
    }

    const view = await render(<Panel />);
    const content = view.getByTestId('draft-content', { includeHiddenElements: true });
    const measuredContent = content.parent;
    const body = measuredContent?.props.pointerEvents ? measuredContent : measuredContent?.parent;
    if (!body || !measuredContent) throw new Error('Missing disclosure content');

    expect(body.props.pointerEvents).toBe('none');
    expect(body.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(view.queryByLabelText('草稿')).toBeNull();
    await fireEvent(measuredContent, 'layout', { nativeEvent: { layout: { height: 160, width: 320 } } });

    await fireEvent.press(view.getByLabelText('展开测试面板'));

    const openingStyle = StyleSheet.flatten(body.props.style);
    expect(openingStyle).toMatchObject({ height: 80, opacity: 0.5 });
    expect(openingStyle).not.toHaveProperty('transform');
    expect(body.props.pointerEvents).toBe('auto');
    expect(body.props.importantForAccessibility).toBe('auto');
    expect(mockWithTiming).not.toHaveBeenCalledWith(160, expect.anything());
    expect(mockWithTiming).toHaveBeenCalledWith(1, expect.objectContaining({ reduceMotion: ReduceMotion.System }));
    await fireEvent.changeText(view.getByLabelText('草稿'), '尚未保存的内容');

    await fireEvent(measuredContent, 'layout', { nativeEvent: { layout: { height: 240, width: 320 } } });
    await view.rerender(<Panel />);
    expect(StyleSheet.flatten(body.props.style)).toMatchObject({ height: 120, opacity: 0.5 });
    expect(mockWithTiming).not.toHaveBeenCalledWith(240, expect.anything());
    await fireEvent(measuredContent, 'layout', { nativeEvent: { layout: { height: 160, width: 320 } } });

    mockWithTiming.mockClear();
    await fireEvent.press(view.getByLabelText('收起测试面板'));

    expect(StyleSheet.flatten(body.props.style)).toMatchObject({ height: 40, opacity: 0.25 });
    expect(body.props.pointerEvents).toBe('none');
    expect(view.queryByLabelText('保存草稿')).toBeNull();
    expect(mockWithTiming).toHaveBeenCalledWith(0, expect.objectContaining({ reduceMotion: ReduceMotion.System }));
    expect(view.getByTestId('draft-content', { includeHiddenElements: true })).toBe(content);

    mockProgress = 0.25;
    await fireEvent.press(view.getByLabelText('展开测试面板'));

    expect(StyleSheet.flatten(body.props.style)).toMatchObject({ height: 40, opacity: 0.25 });
    expect(body.props.pointerEvents).toBe('auto');
    expect(view.getByLabelText('草稿').props.value).toBe('尚未保存的内容');
    await fireEvent.press(view.getByLabelText('保存草稿'));
    expect(saveDraft).toHaveBeenCalledWith('尚未保存的内容');
    expect(expandedChanges.mock.calls).toEqual([[true], [false], [true]]);
  });

  it('announces the expanded state of nested disclosure buttons', async () => {
    function Menu() {
      const [expanded, setExpanded] = useState(false);
      return (
        <MenuButton
          nested
          icon={ChevronDown}
          label="等级详情"
          value="LV 2"
          expanded={expanded}
          onPress={() => setExpanded((value) => !value)}
        />
      );
    }
    const view = await render(<Menu />);
    const menu = view.getByRole('button');
    expect(menu.props.accessibilityState.expanded).toBe(false);
    await fireEvent.press(menu);
    expect(menu.props.accessibilityState.expanded).toBe(true);
  });
});
