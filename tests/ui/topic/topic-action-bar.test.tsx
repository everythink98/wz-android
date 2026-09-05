import { StyleSheet, View } from 'react-native';
import type { LucideIcon, LucideProps } from 'lucide-react-native';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { DetailActionButton, type DetailActionTone } from '@/features/topic/components/TopicActionBar';
import { createTopicStyles } from '@/features/topic/styles';
import { createTheme } from '@/ui/theme/tokens';
import { fireEvent, render } from '../render';

const TestIcon = (({ color, fill, size, strokeWidth }: LucideProps) => (
  <View
    accessibilityValue={{ text: [color, fill, size, strokeWidth].map(String).join('|') }}
    style={{ height: Number(size), width: Number(size) }}
    testID="topic-action-icon"
  />
)) as LucideIcon;

const SelectedTestIcon = (({ size }: LucideProps) => (
  <View style={{ height: Number(size), width: Number(size) }} testID="topic-action-selected-icon" />
)) as LucideIcon;

async function renderAction({
  active = false,
  activeIcon,
  appearance = 'light',
  compact = false,
  count = 12,
  disabled = false,
  fontScale = 1,
  iconSize,
  pending = false,
  tone = 'success'
}: {
  active?: boolean;
  activeIcon?: LucideIcon;
  appearance?: 'dark' | 'light';
  compact?: boolean;
  count?: number;
  disabled?: boolean;
  fontScale?: number;
  iconSize?: number;
  pending?: boolean;
  tone?: DetailActionTone;
} = {}) {
  const settings = { ...createEmptyReaderData().settings, fontScale, theme: appearance };
  const theme = createTheme(settings);
  const styles = createTopicStyles(theme, settings);
  const onPress = jest.fn();
  const view = await render(
    <DetailActionButton
      accessibilityLabel="点赞"
      active={active}
      activeIcon={activeIcon}
      compact={compact}
      count={count}
      disabled={disabled}
      icon={TestIcon}
      iconSize={iconSize}
      label="赞"
      pending={pending}
      styles={styles}
      theme={theme}
      tone={tone}
      onPress={onPress}
    />
  );
  return { onPress, theme, view };
}

describe('topic post action rail', () => {
  it('keeps compact actions labeled, caps their count, and invokes the action once', async () => {
    const { onPress, view } = await renderAction({ compact: true, count: 100 });

    expect(view.getByText('赞')).toBeTruthy();
    expect(view.getByText('99+')).toBeTruthy();
    expect(view.queryByText('100')).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: '点赞' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('keeps a selected non-repeatable action transparent and fully legible', async () => {
    const { theme, view } = await renderAction({ active: true, disabled: true });
    const button = view.getByLabelText('点赞');

    expect(button.props.accessibilityState).toEqual({ busy: false, disabled: true, selected: true });
    expect(StyleSheet.flatten(button.props.style)).toMatchObject({
      backgroundColor: 'transparent',
      gap: 6,
      minHeight: 48
    });
    expect(StyleSheet.flatten(button.props.style).opacity).toBeUndefined();
    expect(StyleSheet.flatten(view.getByTestId('topic-action-icon').parent?.props.style)).toMatchObject({
      height: 22,
      width: 22
    });
    expect(StyleSheet.flatten(view.getByTestId('topic-action-icon').props.style)).toMatchObject({
      height: 18,
      width: 18
    });
    expect(view.getByTestId('topic-action-icon').props.accessibilityValue.text).toBe(
      [theme.primary, theme.primary, 18, 2.1].join('|')
    );
    expect(StyleSheet.flatten(view.getByText('赞').props.style)).toMatchObject({
      color: theme.ink,
      fontWeight: '600'
    });
    expect(StyleSheet.flatten(view.getByText('12').props.style)).toMatchObject({
      color: theme.muted,
      fontWeight: '500'
    });
  });

  it('keeps default outline icons neutral instead of forming a rainbow rail', async () => {
    const { theme, view } = await renderAction();

    expect(view.getByTestId('topic-action-icon').props.accessibilityValue.text).toBe(
      [theme.muted, 'none', 18, 1.8].join('|')
    );
  });

  it('keeps the favorite outline in its established deep-gold color', async () => {
    const { theme, view } = await renderAction({ tone: 'favorite' });

    expect(view.getByTestId('topic-action-icon').props.accessibilityValue.text).toBe(
      [theme.warning, 'none', 18, 1.8].join('|')
    );
  });

  it('keeps the established yellow fill and deep-gold outline on selected favorite', async () => {
    const { theme, view } = await renderAction({ active: true, tone: 'favorite' });

    expect(view.getByTestId('topic-action-icon').props.accessibilityValue.text).toBe(
      [theme.warning, theme.favorite, 18, 2.1].join('|')
    );
  });

  it('uses a warm roast-red color for the selected chicken action', async () => {
    const { view } = await renderAction({ active: true, tone: 'warning' });
    const { view: darkView } = await renderAction({ active: true, appearance: 'dark', tone: 'warning' });

    expect(view.getByTestId('topic-action-icon').props.accessibilityValue.text).toBe(
      ['#B75D42', '#B75D42', 18, 2.1].join('|')
    );
    expect(darkView.getByTestId('topic-action-icon').props.accessibilityValue.text).toBe(
      ['#E09678', '#E09678', 18, 2.1].join('|')
    );
  });

  it('uses a vivid red for the selected negative action', async () => {
    const { view } = await renderAction({ active: true, tone: 'danger' });
    const { view: darkView } = await renderAction({ active: true, appearance: 'dark', tone: 'danger' });

    expect(view.getByTestId('topic-action-icon').props.accessibilityValue.text).toBe(
      ['#EB3B3B', '#EB3B3B', 18, 2.1].join('|')
    );
    expect(darkView.getByTestId('topic-action-icon').props.accessibilityValue.text).toBe(
      ['#FF5C5C', '#FF5C5C', 18, 2.1].join('|')
    );
  });

  it('uses the selected glyph without changing the normal icon geometry', async () => {
    const { view } = await renderAction({ active: true, activeIcon: SelectedTestIcon });

    expect(view.queryByTestId('topic-action-icon')).toBeNull();
    expect(StyleSheet.flatten(view.getByTestId('topic-action-selected-icon').props.style)).toMatchObject({
      height: 18,
      width: 18
    });
  });

  it('honors an optically calibrated icon size inside the fixed slot', async () => {
    const { view } = await renderAction({ iconSize: 20 });

    expect(StyleSheet.flatten(view.getByTestId('topic-action-icon').props.style)).toMatchObject({
      height: 20,
      width: 20
    });
  });

  it('shows a pending action without stacking disabled opacity', async () => {
    const { theme, view } = await renderAction({ disabled: true, pending: true });
    const button = view.getByLabelText('点赞');

    expect(button.props.accessibilityState).toEqual({ busy: true, disabled: true, selected: false });
    expect(StyleSheet.flatten(button.props.style).backgroundColor).toBe('transparent');
    expect(StyleSheet.flatten(button.props.style).opacity).toBeUndefined();
    const indicators = view.container.queryAll((node) => /ActivityIndicator|ProgressBar/.test(node.type));
    expect(indicators).toHaveLength(1);
    expect(indicators[0]?.props.color).toBe(theme.primary);
    expect(StyleSheet.flatten(indicators[0]?.parent?.props.style)).toMatchObject({ height: 22, width: 22 });
  });

  it('keeps ordinary unavailable actions visibly disabled', async () => {
    const { view } = await renderAction({ disabled: true });

    expect(StyleSheet.flatten(view.getByLabelText('点赞').props.style).opacity).toBe(0.45);
  });

  it('scales main action labels and counts with the existing app font setting', async () => {
    const { theme, view } = await renderAction({ fontScale: 1.4 });
    const labelStyle = StyleSheet.flatten(view.getByText('赞').props.style);
    const countStyle = StyleSheet.flatten(view.getByText('12').props.style);

    expect(labelStyle).toMatchObject({ color: theme.ink, fontSize: 17, lineHeight: 22 });
    expect(countStyle).toMatchObject({ color: theme.muted, fontSize: 17, lineHeight: 22 });
  });
});
