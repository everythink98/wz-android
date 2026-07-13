import { beforeEach, describe, expect, it, vi } from 'vitest';

type HookSlot = { deps?: unknown[]; value?: unknown };
const hookHarness = vi.hoisted(() => {
  const slots: HookSlot[] = [];
  let cursor = 0;
  const depsEqual = (left?: unknown[], right?: unknown[]) => Boolean(
    left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
  );
  return {
    beginRender() {
      cursor = 0;
    },
    reset() {
      slots.splice(0, slots.length);
      cursor = 0;
    },
    useCallback<T>(callback: T, deps: unknown[]) {
      const index = cursor++;
      const slot = slots[index];
      if (!slot || !depsEqual(slot.deps, deps)) {
        slots[index] = { deps, value: callback };
      }
      return slots[index].value as T;
    },
    useLayoutEffect(effect: () => void, deps: unknown[]) {
      const index = cursor++;
      const slot = slots[index];
      if (!slot || !depsEqual(slot.deps, deps)) {
        slots[index] = { deps };
        effect();
      }
    },
    useMemo<T>(factory: () => T, deps: unknown[]) {
      const index = cursor++;
      const slot = slots[index];
      if (!slot || !depsEqual(slot.deps, deps)) {
        slots[index] = { deps, value: factory() };
      }
      return slots[index].value as T;
    },
    useRef<T>(initialValue: T) {
      const index = cursor++;
      if (!slots[index]) {
        slots[index] = { value: { current: initialValue } };
      }
      return slots[index].value as { current: T };
    },
    useState<T>(initialValue: T) {
      const index = cursor++;
      if (!slots[index]) {
        slots[index] = { value: initialValue };
      }
      const setValue = (next: T | ((current: T) => T)) => {
        const current = slots[index].value as T;
        slots[index].value = typeof next === 'function' ? (next as (current: T) => T)(current) : next;
      };
      return [slots[index].value as T, setValue] as const;
    }
  };
});

vi.mock('react', () => ({
  useCallback: hookHarness.useCallback,
  useLayoutEffect: hookHarness.useLayoutEffect,
  useMemo: hookHarness.useMemo,
  useRef: hookHarness.useRef,
  useState: hookHarness.useState
}));
vi.mock('../appUtils', () => ({
  parseForumTopicLink: vi.fn(() => null),
  parseForumUserLink: vi.fn(() => null)
}));
vi.mock('../htmlImages', () => ({
  isHttpOrHttpsUrl: vi.fn(() => false),
  isPreviewableImageUrl: vi.fn(() => false),
  normalizeImagePreviewUrl: (url: string) => url
}));
vi.mock('../htmlRenderingStyles', () => ({
  buildHtmlRenderingStyles: vi.fn(() => ({
    htmlBaseStyle: { lineHeight: 24 },
    htmlClassesStyles: {},
    htmlIgnoredStyles: [],
    htmlTagsStyles: {}
  }))
}));
vi.mock('../screens/topic/ForumHtmlRendererProvider', () => ({
  shouldShowPreviewImageLoading: vi.fn(),
  shouldShowVideoStickerLoading: vi.fn()
}));
vi.mock('../theme', () => ({
  fontFamilyValue: vi.fn(() => undefined),
  lineHeightMultiplier: vi.fn(() => 1)
}));
vi.mock('../topicDerivedData', () => ({
  createTopicImageDeriver: vi.fn(() => ({ identity: Symbol('topic-deriver') }))
}));

import { useHtmlRenderingController } from './useHtmlRenderingController';

describe('HTML rendering controller identity', () => {
  beforeEach(() => hookHarness.reset());

  it('keeps renderer context stable for detail/reply clones and resets topic-scoped state only on source:id change', () => {
    const settings = {
      theme: 'light',
      fontScale: 1,
      lineHeight: 'standard',
      contentWidth: 'standard',
      fontFamily: 'sans',
      listDensity: 'standard'
    } as const;
    const styles = {} as never;
    const theme = { ink: '#111' } as never;
    const selectedTopic = { source: 'nodeseek' as const, id: '1', url: 'https://www.nodeseek.com/post-1-1' };
    const baseProps = {
      onOpenExternalUrl: vi.fn(),
      onOpenImagePreview: vi.fn(),
      onOpenTopic: vi.fn(),
      onOpenUser: vi.fn(),
      selectedTopic: selectedTopic as never,
      settings,
      styles,
      theme,
      topicKey: 'nodeseek:1',
      webViewBlockMessage: ''
    };

    hookHarness.beginRender();
    const first = useHtmlRenderingController({
      ...baseProps,
      topicDetail: { ...selectedTopic, replies: [] } as never
    });
    hookHarness.beginRender();
    const detailClone = useHtmlRenderingController({
      ...baseProps,
      topicDetail: { ...selectedTopic, replies: [{ floor: 2 }] } as never
    });

    expect(detailClone.htmlRendererContext).toBe(first.htmlRendererContext);
    expect(detailClone.htmlRendererContext.openHtmlLink).toBe(first.htmlRendererContext.openHtmlLink);
    expect(detailClone.topicImageDeriver).toBe(first.topicImageDeriver);

    hookHarness.beginRender();
    const nextTopic = useHtmlRenderingController({
      ...baseProps,
      selectedTopic: { source: 'nodeseek', id: '2', url: 'https://www.nodeseek.com/post-2-1' } as never,
      topicDetail: null,
      topicKey: 'nodeseek:2'
    });

    expect(nextTopic.htmlRendererContext).not.toBe(first.htmlRendererContext);
    expect(nextTopic.htmlRendererContext.openHtmlLink).toBe(first.htmlRendererContext.openHtmlLink);
    expect(nextTopic.topicImageDeriver).not.toBe(first.topicImageDeriver);
  });
});
