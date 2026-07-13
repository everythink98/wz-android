import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: {
    absoluteFillObject: {},
    create: (styles: unknown) => styles,
    flatten: (style: unknown) => Array.isArray(style) ? Object.assign({}, ...style) : style,
    hairlineWidth: 1
  },
  Text: 'Text',
  View: 'View'
}));

vi.mock('react-native-webview', () => ({ WebView: 'WebView' }));
vi.mock('expo-image', () => ({ Image: 'ExpoImage' }));
vi.mock('expo', () => ({ useEvent: vi.fn((_player, _eventName, initialValue) => initialValue) }));
vi.mock('expo-video', () => ({
  VideoView: 'VideoView',
  useVideoPlayer: vi.fn(() => ({ pause: vi.fn(), play: vi.fn(), playing: false }))
}));
vi.mock('lucide-react-native', () => ({
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  ChevronUp: 'ChevronUp',
  Play: 'Play'
}));
vi.mock('react-native-render-html', () => ({
  HTMLContentModel: { block: 'block', mixed: 'mixed', textual: 'textual' },
  HTMLElementModel: { fromCustomModel: vi.fn((model) => model) },
  RenderHTMLConfigProvider: 'RenderHTMLConfigProvider',
  TChildrenRenderer: 'TChildrenRenderer',
  TRenderEngineProvider: 'TRenderEngineProvider',
  defaultHTMLElementModels: {
    details: { extend: vi.fn((model) => model) },
    summary: { extend: vi.fn((model) => model) }
  },
  getNativePropsForTNode: vi.fn(() => ({})),
  useContentWidth: vi.fn(),
  useIMGElementProps: vi.fn(),
  useIMGElementState: vi.fn(),
  useTNodeChildrenProps: vi.fn()
}));
vi.mock('../../components/ForumContentVideo', () => ({ ForumContentVideo: 'ForumContentVideo' }));
vi.mock('../../forumMediaPlayback', () => ({ useForumMediaPlaybackActive: () => true }));

import { FORUM_TERMINAL_REPORT_TAG } from '../../localHtml';
import { getForumHtmlRenderers } from './ForumHtmlRendererProvider';

describe('forum HTML renderer identity', () => {
  it('keeps every stateful renderer type stable across provider updates', () => {
    const first = getForumHtmlRenderers();
    const second = getForumHtmlRenderers();

    expect(second).toBe(first);
    for (const tag of ['img', FORUM_TERMINAL_REPORT_TAG, 'aside', 'details']) {
      expect(second[tag]).toBe(first[tag]);
    }
  });
});
