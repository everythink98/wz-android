import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Animated, View } from 'react-native';
import { ContentLoadingPlaceholder, LoadingCover } from '@/ui/controls/ContentLoadingPlaceholder';
import { TopicListPlaceholder } from '@/ui/topic/TopicCard';
import { render } from '../render';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('loading placeholder handoff', () => {
  it('keeps the visible shapes mounted when a preloaded tab starts or stops shimmering', async () => {
    const placeholder = (animating: boolean) => (
      <ContentLoadingPlaceholder animating={animating} label="加载中">
        <View testID="shape" />
      </ContentLoadingPlaceholder>
    );
    const view = await render(placeholder(false));
    const shape = view.getByTestId('shape');
    await view.rerender(placeholder(true));
    expect(view.getByTestId('shape') === shape).toBe(true);
    await view.rerender(placeholder(false));
    expect(view.getByTestId('shape') === shape).toBe(true);
  });

  it('extends the existing list placeholder when the tab receives its final height', async () => {
    const placeholder = (height: number) => (
      <TopicListPlaceholder animating={false} label="加载中" fillHeight={height} />
    );
    const view = await render(placeholder(200));
    const firstLayout = view.getByTestId('content-loading-placeholder');
    const firstRow = firstLayout.children[0];
    const initialCount = firstLayout.children.length;
    await view.rerender(placeholder(700));
    const expanded = view.getByTestId('content-loading-placeholder');
    expect(expanded.children.length).toBeGreaterThan(initialCount);
    expect(expanded.children[0] === firstRow).toBe(true);
  });

  it('composites the fading cover as one layer over the already drawn content', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1000);
    jest.spyOn(Animated, 'timing').mockReturnValue({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() });
    const cover = (visible: boolean) => (
      <LoadingCover active visible={visible} style={{ backgroundColor: 'white' }}>
        <View testID="covered-title" />
      </LoadingCover>
    );
    const view = await render(cover(true));
    expect(view.getByTestId('covered-title').parent).not.toHaveProp('renderToHardwareTextureAndroid', true);
    clock.mockReturnValue(1500);
    await view.rerender(cover(false));
    const fadedLayer = view.getByTestId('covered-title', { includeHiddenElements: true }).parent;
    expect(fadedLayer).toHaveProp('needsOffscreenAlphaCompositing', true);
    expect(fadedLayer).toHaveProp('renderToHardwareTextureAndroid', true);
  });
});
