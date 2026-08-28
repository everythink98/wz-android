import { describe, expect, it, vi } from 'vitest';

const reanimatedTransition = vi.hoisted(() => {
  const reduceMotion = vi.fn();
  const transition = { reduceMotion };
  reduceMotion.mockReturnValue(transition);
  return {
    duration: vi.fn(() => transition),
    reduceMotion
  };
});

vi.mock('@/platform/network/networkProxy', () => ({
  releaseReadNetworkRuntimeGeneration: vi.fn(async () => true),
  retainReadNetworkRuntimeGeneration: vi.fn(async (generation: number) => ({ generation, retained: true }))
}));

vi.mock('@/platform/network/readNetworkRuntime', () => ({
  getReadNetworkRuntimeSnapshot: () => ({ generation: 0, triggerSource: null }),
  useReadNetworkRuntimeGeneration: () => 0,
  useReadNetworkRuntimeSnapshot: () => ({ generation: 0, triggerSource: null })
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  PixelRatio: { get: () => 1 },
  Pressable: 'Pressable',
  StyleSheet: {
    absoluteFillObject: {},
    create: (styles: unknown) => styles,
    flatten: (style: unknown) => (Array.isArray(style) ? Object.assign({}, ...style) : style),
    hairlineWidth: 1
  },
  Text: 'Text',
  View: 'View'
}));

vi.mock('react-native-webview', () => ({
  WebView: 'WebView'
}));

vi.mock('react-native-reanimated', () => {
  return {
    default: { View: 'AnimatedView' },
    LinearTransition: { duration: reanimatedTransition.duration },
    ReduceMotion: { System: 'system' }
  };
});

vi.mock('expo-image', () => ({
  Image: 'ExpoImage',
  useImage: vi.fn()
}));

vi.mock('@shopify/flash-list', () => ({
  useLayoutState: vi.fn()
}));

vi.mock('expo', () => ({
  useEvent: vi.fn((_player, _eventName, initialValue) => initialValue)
}));

vi.mock('expo-video', () => ({
  VideoView: 'VideoView',
  useVideoPlayer: vi.fn(() => ({
    pause: vi.fn(),
    play: vi.fn(),
    playing: false
  }))
}));

vi.mock('lucide-react-native', () => ({
  Bug: 'Bug',
  Check: 'Check',
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  CircleCheck: 'CircleCheck',
  CircleHelp: 'CircleHelp',
  ClipboardList: 'ClipboardList',
  Flame: 'Flame',
  Lightbulb: 'Lightbulb',
  List: 'List',
  Maximize2: 'Maximize2',
  Play: 'Play',
  Quote: 'Quote',
  SquarePen: 'SquarePen',
  TriangleAlert: 'TriangleAlert',
  X: 'X',
  Zap: 'Zap'
}));

vi.mock('react-native-render-html', () => ({
  HTMLContentModel: { block: 'block', mixed: 'mixed' },
  HTMLElementModel: { fromCustomModel: vi.fn((model) => model) },
  TChildrenRenderer: 'TChildrenRenderer',
  getNativePropsForTNode: vi.fn(() => ({})),
  useContentWidth: vi.fn(() => 320),
  useIMGElementProps: vi.fn(),
  useIMGElementStateWithCache: vi.fn()
}));

import { cachedImageDisplayDimensions, rememberImageDisplayDimensions } from '@/platform/media/imageDisplayDimensions';
import { FORUM_CALLOUT_TRANSITION_MS } from '@/ui/content/ForumCallout';

describe('HTML topic media loading state', () => {
  it('configures the Callout layout transition with system Reduce Motion', () => {
    expect(reanimatedTransition.duration).toHaveBeenCalledWith(FORUM_CALLOUT_TRANSITION_MS);
    expect(reanimatedTransition.reduceMotion).toHaveBeenCalledWith('system');
  });

  it('bounds preview dimensions with pure reads and committed promotion', () => {
    rememberImageDisplayDimensions('nodeseek:1:https://img.example.com/shared.png', { height: 4, width: 5 });
    expect(cachedImageDisplayDimensions('nodeseek:2:https://img.example.com/shared.png')).toBeUndefined();

    for (let index = 0; index < 512; index += 1) {
      rememberImageDisplayDimensions(`session:lru-${index}`, { height: index + 1, width: index + 2 });
    }
    const firstDimensions = cachedImageDisplayDimensions('session:lru-0');
    expect(firstDimensions).toEqual({ height: 1, width: 2 });

    rememberImageDisplayDimensions('session:lru-overflow', { height: 9, width: 10 });

    expect(cachedImageDisplayDimensions('session:lru-0')).toBeUndefined();
    const promotedDimensions = cachedImageDisplayDimensions('session:lru-1');
    expect(promotedDimensions).toEqual({ height: 2, width: 3 });
    rememberImageDisplayDimensions('session:lru-1', promotedDimensions!);
    rememberImageDisplayDimensions('session:lru-second-overflow', { height: 11, width: 12 });

    expect(cachedImageDisplayDimensions('session:lru-1')).toEqual({ height: 2, width: 3 });
    expect(cachedImageDisplayDimensions('session:lru-2')).toBeUndefined();
  });
});
