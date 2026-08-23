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
  it('reports a controlled toggle from the 48dp accessible header', async () => {
    const onExpandedChange = jest.fn();
    const view = await render(
      <ForumCallout
        expanded={false}
        foldable
        onExpandedChange={onExpandedChange}
        theme={lightTheme}
        title={<Text>警告标题</Text>}
        titleLabel="警告标题"
        type="warning"
      />
    );

    const header = view.getByRole('button', { name: '警告标题' });
    expect(header.props.accessibilityState).toEqual({ expanded: false });
    expect(header).toHaveStyle({ minHeight: 48 });
    const [icon] = view.root?.queryAll((instance) => instance.props.testID === 'forum-callout-icon') || [];
    expect(icon.props.accessible).toBe(false);

    await fireEvent.press(header);

    expect(onExpandedChange).toHaveBeenCalledWith(true);
    expect(FORUM_CALLOUT_TRANSITION_MS).toBe(100);
  });

  it('uses static header semantics when there is no foldable body', async () => {
    const view = await render(
      <ForumCallout
        expanded
        foldable={false}
        onExpandedChange={jest.fn()}
        theme={lightTheme}
        title={<Text>只有标题</Text>}
        titleLabel="只有标题"
        type="tip"
      />
    );

    expect(view.getByRole('header', { name: '只有标题' })).toBeTruthy();
    expect(view.queryByRole('button')).toBeNull();
  });

  it('keeps a foldable Callout expanded when its title link handles the press', async () => {
    const stopPropagation = jest.fn();
    const onExpandedChange = jest.fn();
    const view = await render(
      <ForumCallout
        expanded
        foldable
        onExpandedChange={onExpandedChange}
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
    expect(onExpandedChange).not.toHaveBeenCalled();
  });

  it('[REG-PERF-010] applies exact boundary spacing from the compiled row', async () => {
    const view = await render(
      <ForumCallout
        boundarySpacing={{ marginBottom: 0, marginTop: 0 }}
        expanded
        foldable={false}
        onExpandedChange={jest.fn()}
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
      <ForumCallout
        expanded
        foldable={false}
        onExpandedChange={jest.fn()}
        theme={theme}
        title={<Text>标题</Text>}
        titleLabel="标题"
        type="warning"
      />
    );

    expect(palette).toEqual({
      backgroundColor: alphaColor(theme.warning, backgroundAlpha),
      borderColor: alphaColor(theme.warning, borderAlpha),
      color: theme.warning
    });
    expect(view.getByTestId('forum-callout')).toHaveStyle(palette);
  });
});
