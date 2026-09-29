import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ReduceMotion } from 'react-native-reanimated';
import { ExpandablePanel } from '@/ui/controls/ExpandableControls';
import { fireEvent, render } from '../render';

let mockOpacity = 0.5;
const mockWithTiming = jest.fn((_value: number, _config: unknown) => mockOpacity);

jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual<Record<string, unknown>>('react-native-reanimated/mock'),
  withTiming: (value: number, config: unknown) => mockWithTiming(value, config)
}));

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { ChevronDown: Icon, ChevronRight: Icon, ChevronUp: Icon };
});

beforeEach(() => {
  mockOpacity = 0.5;
  mockWithTiming.mockClear();
});

describe('ExpandablePanel', () => {
  it('keeps visibility and draft interaction independent of an unfinished opening fade', async () => {
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
    const body = content.parent!;

    expect(StyleSheet.flatten(body.props.style)).toMatchObject({ display: 'none' });
    expect(body.props.pointerEvents).toBe('none');
    expect(view.queryByLabelText('草稿')).toBeNull();
    expect(mockWithTiming).not.toHaveBeenCalled();

    await fireEvent.press(view.getByLabelText('展开测试面板'));

    const openingStyle = StyleSheet.flatten(body.props.style);
    expect(openingStyle).toMatchObject({ display: 'flex', opacity: 0.5 });
    expect(openingStyle).not.toHaveProperty('transform');
    expect(openingStyle).not.toHaveProperty('height');
    expect(body.props.pointerEvents).toBe('auto');
    expect(mockWithTiming).toHaveBeenCalledWith(1, expect.objectContaining({ reduceMotion: ReduceMotion.System }));
    await fireEvent.changeText(view.getByLabelText('草稿'), '尚未保存的内容');

    mockWithTiming.mockClear();
    await fireEvent.press(view.getByLabelText('收起测试面板'));

    expect(StyleSheet.flatten(body.props.style)).toMatchObject({ display: 'none', opacity: 0 });
    expect(body.props.pointerEvents).toBe('none');
    expect(view.queryByLabelText('保存草稿')).toBeNull();
    expect(mockWithTiming).not.toHaveBeenCalled();
    expect(view.getByTestId('draft-content', { includeHiddenElements: true })).toBe(content);

    mockOpacity = 0.25;
    await fireEvent.press(view.getByLabelText('展开测试面板'));

    expect(StyleSheet.flatten(body.props.style)).toMatchObject({ display: 'flex', opacity: 0.25 });
    expect(body.props.pointerEvents).toBe('auto');
    expect(view.getByLabelText('草稿').props.value).toBe('尚未保存的内容');
    await fireEvent.press(view.getByLabelText('保存草稿'));
    expect(saveDraft).toHaveBeenCalledWith('尚未保存的内容');
    expect(expandedChanges.mock.calls).toEqual([[true], [false], [true]]);
  });
});
