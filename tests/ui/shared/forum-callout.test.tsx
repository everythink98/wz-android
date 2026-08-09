import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { Pressable, Text } from 'react-native';

import { FORUM_CALLOUT_TRANSITION_MS, ForumCallout, forumCalloutPalette } from '@/ui/content/ForumCallout';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { alphaColor, createTheme } from '@/ui/theme/tokens';

const readerData = createEmptyReaderData();
const lightTheme = createTheme(readerData.settings);
const darkTheme = createTheme({ ...readerData.settings, theme: 'dark' });

describe('REG-TOPIC-056 shared ForumCallout', () => {
  it('renders an initially collapsed body only after the 48dp accessible header is pressed', async () => {
    const view = await render(
      <ForumCallout
        body={<Text>折叠正文</Text>}
        fold="collapsed"
        theme={lightTheme}
        title={<Text>警告标题</Text>}
        titleLabel="警告标题"
        type="warning"
      />
    );

    const header = view.getByRole('button', { name: '警告标题' });
    expect(header.props.accessibilityState).toEqual({ expanded: false });
    expect(header).toHaveStyle({ minHeight: 48 });
    expect(view.queryByText('折叠正文')).toBeNull();
    const [icon] = view.root?.queryAll((instance) => instance.props.testID === 'forum-callout-icon') || [];
    expect(icon.props.accessible).toBe(false);

    await fireEvent.press(header);

    expect(view.getByRole('button', { name: '警告标题' }).props.accessibilityState).toEqual({ expanded: true });
    expect(view.getByText('折叠正文')).toBeTruthy();
    expect(FORUM_CALLOUT_TRANSITION_MS).toBe(100);
  });

  it('uses static header semantics when there is no foldable body', async () => {
    const view = await render(
      <ForumCallout fold="expanded" theme={lightTheme} title={<Text>只有标题</Text>} titleLabel="只有标题" type="tip" />
    );

    expect(view.getByRole('header', { name: '只有标题' })).toBeTruthy();
    expect(view.queryByRole('button')).toBeNull();
  });

  it('keeps a foldable Callout expanded when its title link handles the press', async () => {
    const stopPropagation = jest.fn();
    const view = await render(
      <ForumCallout
        body={<Text>正文保持可见</Text>}
        fold="expanded"
        theme={lightTheme}
        title={
          <Pressable accessibilityRole="link" onPress={(event) => event.stopPropagation()}>
            <Text>标题链接</Text>
          </Pressable>
        }
        titleLabel="带链接的标题"
        type="warning"
      />
    );

    await fireEvent.press(view.getByRole('link'), { stopPropagation });

    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(view.getByRole('button', { name: '带链接的标题' }).props.accessibilityState).toEqual({ expanded: true });
    expect(view.getByText('正文保持可见')).toBeTruthy();
  });

  it('[REG-PERF-010] renders a controlled continuation without duplicating its header', async () => {
    const onExpandedChange = jest.fn();
    const view = await render(
      <ForumCallout
        body={<Text>续段正文</Text>}
        expanded={false}
        fold="collapsed"
        headerVisible={false}
        onExpandedChange={onExpandedChange}
        theme={lightTheme}
        title={<Text>不得重复的标题</Text>}
        titleLabel="不得重复的标题"
        type="warning"
      />
    );

    expect(view.queryByText('不得重复的标题')).toBeNull();
    expect(view.queryByTestId('forum-callout-icon')).toBeNull();
    expect(view.queryByText('续段正文')).toBeNull();

    await view.rerender(
      <ForumCallout
        body={<Text>续段正文</Text>}
        expanded
        fold="collapsed"
        headerVisible={false}
        onExpandedChange={onExpandedChange}
        theme={lightTheme}
        title={<Text>不得重复的标题</Text>}
        titleLabel="不得重复的标题"
        type="warning"
      />
    );

    expect(view.getByText('续段正文')).toBeTruthy();
    expect(view.queryByText('不得重复的标题')).toBeNull();
    expect(view.queryByRole('button')).toBeNull();
    expect(onExpandedChange).not.toHaveBeenCalled();
  });

  it('[REG-PERF-010] applies exact zero margins at continuation boundaries', async () => {
    const view = await render(
      <ForumCallout
        boundarySpacing={{ marginBottom: 0, marginTop: 0 }}
        body={<Text>中间续段</Text>}
        theme={lightTheme}
        title={<Text>续段标题</Text>}
        titleLabel="续段标题"
        type="warning"
      />
    );

    expect(view.getByTestId('forum-callout')).toHaveStyle({ marginBottom: 0, marginTop: 0 });
  });

  it.each([
    { name: 'light', theme: lightTheme, backgroundAlpha: 0.1, borderAlpha: 0.28 },
    { name: 'dark', theme: darkTheme, backgroundAlpha: 0.16, borderAlpha: 0.36 }
  ])('uses App warning tone in $name theme', async ({ theme, backgroundAlpha, borderAlpha }) => {
    const palette = forumCalloutPalette('warning', theme);
    const view = await render(
      <ForumCallout body={<Text>正文</Text>} theme={theme} title={<Text>标题</Text>} titleLabel="标题" type="warning" />
    );

    expect(palette).toEqual({
      backgroundColor: alphaColor(theme.warning, backgroundAlpha),
      borderColor: alphaColor(theme.warning, borderAlpha),
      color: theme.warning
    });
    expect(view.getByTestId('forum-callout')).toHaveStyle(palette);
  });
});
