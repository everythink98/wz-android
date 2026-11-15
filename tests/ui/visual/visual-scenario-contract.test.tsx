import type { ForwardedRef } from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fireEvent, render, within } from '@testing-library/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaFrameContext, SafeAreaInsetsContext } from 'react-native-safe-area-context';

jest.mock('@shopify/flash-list', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  return {
    FlashList: React.forwardRef(function MockFlashList(
      { data = [], keyExtractor, renderItem, ListHeaderComponent, ListFooterComponent, ...props }: Record<string, any>,
      ref: ForwardedRef<unknown>
    ) {
      React.useImperativeHandle(ref, () => ({ scrollToIndex: jest.fn(), scrollToOffset: jest.fn() }));
      return React.createElement(
        View,
        props,
        typeof ListHeaderComponent === 'function' ? React.createElement(ListHeaderComponent) : ListHeaderComponent,
        data.map((item: unknown, index: number) =>
          React.createElement(
            View,
            { key: keyExtractor?.(item, index) || String(index) },
            renderItem?.({ index, item, target: 'Cell' })
          )
        ),
        typeof ListFooterComponent === 'function' ? React.createElement(ListFooterComponent) : ListFooterComponent
      );
    }),
    useFlashListContext: () => null,
    useLayoutState: (initialValue: unknown) => React.useState(initialValue),
    useMappingHelper: () => ({ getMappingKey: (value: string) => value }),
    useRecyclingState: (initialValue: unknown) => React.useState(initialValue)
  };
});

jest.mock('expo-video', () => ({
  createVideoPlayer: jest.fn(),
  VideoView: () => null,
  useVideoPlayer: () => ({ pause: jest.fn(), play: jest.fn(), playing: false })
}));

import { visualScenarioCatalog, VisualScenarioView } from './catalog';
import { VisualGalleryApp } from '../../../dev/visual-gallery/VisualGalleryApp';

describe('visual scenario catalog', () => {
  it('keeps fullscreen portals on the window while only ordinary content consumes vertical safe areas', async () => {
    const view = await render(
      <SafeAreaFrameContext.Provider value={{ x: 0, y: 0, width: 390, height: 844 }}>
        <SafeAreaInsetsContext.Provider value={{ top: 48, right: 0, bottom: 24, left: 0 }}>
          <VisualGalleryApp />
        </SafeAreaInsetsContext.Provider>
      </SafeAreaFrameContext.Provider>
    );
    await fireEvent.changeText(view.getByLabelText('搜索视觉场景'), 'notifications.detail.conversation');
    const controlFrame = view.getByTestId('visual-frame-notifications.detail.conversation-light-1-controls');
    expect(controlFrame).toHaveProp('edges', {
      top: 'additive',
      right: 'additive',
      bottom: 'additive',
      left: 'additive'
    });
    const lastMessage = view.getByText('本地会话消息 80：保留上下文，检查草稿编辑与返回。');
    await fireEvent.press(view.getByRole('button', { name: '全屏预览' }));
    const fullFrame = view.getByTestId('visual-frame-notifications.detail.conversation-light-1-full');
    expect(fullFrame).toHaveProp('edges', { top: 'off', right: 'additive', bottom: 'off', left: 'additive' });
    const ordinaryContent = view.getByTestId('visual-scenario-content');
    expect(ordinaryContent).toHaveProp('edges', { top: 'additive', right: 'off', bottom: 'additive', left: 'off' });
    await fireEvent.press(view.getByLabelText('继续编辑私信草稿'));
    expect(view.getByTestId('composer-bottom-sheet-backdrop', { includeHiddenElements: true })).toBeTruthy();
    expect(
      within(ordinaryContent).queryByTestId('composer-bottom-sheet-backdrop', { includeHiddenElements: true })
    ).toBeNull();
    expect(within(ordinaryContent).queryByTestId('composer-bottom-sheet', { includeHiddenElements: true })).toBeNull();
    expect(view.getByText('本地会话消息 80：保留上下文，检查草稿编辑与返回。')).toBe(lastMessage);
    await view.unmount();
  });

  it('classifies exactly the App capabilities declared in the product map', () => {
    const productMap = readFileSync(path.resolve(__dirname, '../../../docs/product-map.md'), 'utf8');
    const expected = [...new Set(Array.from(productMap.matchAll(/`([A-Z]+-\d{2})`/g), (match) => match[1]))]
      .filter((id) => !id.startsWith('RELEASE-'))
      .sort();
    expect(expected.length).toBeGreaterThan(0);
    expect([...new Set(visualScenarioCatalog.flatMap((scenario) => scenario.capabilityIds))].sort()).toEqual(expected);
  });

  it('uses unique stable scenario and capability ids', () => {
    const ids = visualScenarioCatalog.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const scenario of visualScenarioCatalog) {
      expect(scenario.id).toMatch(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
      expect(scenario.capabilityIds.length).toBeGreaterThan(0);
      expect(scenario.capabilityIds.every((id) => /^[A-Z]+-\d{2}$/.test(id))).toBe(true);
    }
  });

  it.each(
    visualScenarioCatalog
      .filter(({ kind }) => kind === 'rendered')
      .flatMap(({ id }) => (['light', 'dark'] as const).map((theme) => ({ id, theme })))
  )('renders $id in the $theme theme', async ({ id, theme }) => {
    const view = await render(
      <GestureHandlerRootView>
        <VisualScenarioView appearance={{ theme }} id={id} />
      </GestureHandlerRootView>
    );
    if (id.startsWith('write.composer.')) {
      const editor = id.includes('.yaohuo.') ? 'yaohuo-reply-composer-toolbar' : 'structured-composer-webview';
      expect(view.getByTestId(editor, { includeHiddenElements: true })).toBeTruthy();
    }
    await view.unmount();
  });

  it.each(['search.aggregate.partial', 'user.profile.long'])(
    'keeps %s dates stable across capture days',
    async (id) => {
      const clock = jest.spyOn(Date, 'now');
      try {
        for (const day of ['2026-09-17T12:00:00Z', '2026-10-17T12:00:00Z']) {
          clock.mockReturnValue(Date.parse(day));
          const view = await render(
            <GestureHandlerRootView>
              <VisualScenarioView id={id} />
            </GestureHandlerRootView>
          );
          expect(view.getAllByText('2026-08-29').length).toBeGreaterThan(0);
          await view.unmount();
        }
      } finally {
        clock.mockRestore();
      }
    }
  );

  it('keeps the proxy gallery modal clear of its parent safe area', async () => {
    const view = await render(
      <GestureHandlerRootView>
        <SafeAreaInsetsContext.Provider value={{ top: 32, right: 0, bottom: 24, left: 0 }}>
          <VisualScenarioView id="more.proxy.failed" />
        </SafeAreaInsetsContext.Provider>
      </GestureHandlerRootView>
    );
    const modalContent = view.getByText('服务器代理').parent?.parent;
    expect(modalContent).toHaveStyle({
      paddingTop: 32,
      paddingBottom: 24
    });
    await view.unmount();
  });
});
