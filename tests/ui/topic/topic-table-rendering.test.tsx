import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import * as Clipboard from 'expo-clipboard';
import { StyleSheet, ToastAndroid, View } from 'react-native';
import { compileForumContent } from '@/domain/forum/topicContentSplit';
import { TopicContentBlock } from '@/features/topic/components/TopicContentBlock';
import { TopicTableScrollProvider } from '@/features/topic/rendering/topicTableRenderers';
import {
  TopicSplitDisclosureProvider,
  TopicSplitDisclosureScope,
  topicMaterializationRegionVisible,
  useTopicSplitDisclosureStore
} from '@/features/topic/rendering/TopicSplitDisclosure';
import { fireEvent, render } from '../render';

type MockGesture = {
  config: Record<string, unknown>;
  handlers: Record<string, (...args: any[]) => void>;
};

let mockPanGestures: MockGesture[] = [];
let mockNativeGestures: MockGesture[] = [];
let mockGestureBindings: { child: React.ReactElement<Record<string, unknown>>; gesture: MockGesture }[] = [];
let mockReactionRunners: (() => void)[] = [];

beforeEach(() => {
  mockPanGestures = [];
  mockNativeGestures = [];
  mockGestureBindings = [];
  mockReactionRunners = [];
});

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve()) }));

jest.mock('react-native-gesture-handler', () => {
  const ReactModule = require('react') as typeof React;
  const gesture = (target: MockGesture[]) => {
    const value: MockGesture & Record<string, any> = { config: {}, handlers: {} };
    for (const name of ['enabled', 'manualActivation', 'maxPointers']) {
      value[name] = (setting: unknown) => {
        value.config[name] = setting;
        return value;
      };
    }
    for (const name of ['onBegin', 'onEnd', 'onTouchesDown', 'onTouchesMove', 'onUpdate']) {
      value[name] = (handler: (...args: any[]) => void) => {
        value.handlers[name] = handler;
        return value;
      };
    }
    value.blocksExternalGesture = (...blocked: MockGesture[]) => {
      value.config.blocksExternalGesture = blocked;
      return value;
    };
    target.push(value);
    return value;
  };
  return {
    Gesture: { Native: () => gesture(mockNativeGestures), Pan: () => gesture(mockPanGestures) },
    GestureDetector: ({
      children,
      gesture: value
    }: {
      children: React.ReactElement<Record<string, unknown>>;
      gesture: MockGesture;
    }) => {
      mockGestureBindings.push({ child: children, gesture: value });
      return ReactModule.cloneElement(children, { ...value.handlers, gestureConfig: value.config });
    }
  };
});

jest.mock('react-native-reanimated', () => {
  const ReactModule = require('react') as typeof React;
  const Native = require('react-native') as typeof import('react-native');
  const actual = jest.requireActual('react-native-reanimated/mock') as Record<string, any>;
  const sharedValue = <Value,>(initialValue: Value) => {
    let value = initialValue;
    return {
      get value() {
        return value;
      },
      set value(next: Value) {
        value = next;
        mockReactionRunners.forEach((run) => run());
      },
      get: () => value,
      set(next: Value) {
        this.value = next;
      }
    };
  };
  const AnimatedScrollView = ReactModule.forwardRef(function AnimatedScrollView(
    props: React.ComponentProps<typeof Native.ScrollView>,
    ref: React.ForwardedRef<import('react-native').ScrollView>
  ) {
    return ReactModule.createElement(Native.ScrollView, { ...props, ref });
  });
  return {
    ...actual,
    default: { ...(actual.default || {}), ScrollView: AnimatedScrollView },
    cancelAnimation: jest.fn(),
    makeMutable: sharedValue,
    scrollTo: jest.fn(),
    useAnimatedReaction: (prepare: () => unknown, react: (value: unknown, previous: unknown) => void) => {
      const previous = ReactModule.useRef<unknown>(null);
      ReactModule.useEffect(() => {
        const run = () => {
          const value = prepare();
          react(value, previous.current);
          previous.current = value;
        };
        mockReactionRunners.push(run);
        run();
        return () => {
          mockReactionRunners = mockReactionRunners.filter((candidate) => candidate !== run);
        };
      }, [prepare, react]);
    },
    useAnimatedRef: () => ReactModule.useRef(null),
    useSharedValue: <Value,>(initialValue: Value) => ReactModule.useRef(sharedValue(initialValue)).current,
    withDecay: ({ clamp }: { clamp: [number, number] }) => clamp[0]
  };
});

jest.mock('react-native-render-html', () => ({
  RenderHTMLSource: () => null,
  useAmbientTRenderEngine: () => ({})
}));

function CompiledContentFixture({ html, source = 'nodeseek' }: { html: string; source?: 'linuxdo' | 'nodeseek' }) {
  const store = useTopicSplitDisclosureStore();
  const regions = compileForumContent({ html, role: 'opening', source }).regions;
  return (
    <TopicSplitDisclosureProvider value={store}>
      <TopicTableScrollProvider>
        <TopicSplitDisclosureScope scopeKey="opening">
          {regions
            .filter((region) => topicMaterializationRegionVisible(region, 'opening', store))
            .filter(
              (region) =>
                region.kind !== 'island' || (region.segment.type !== 'poll' && region.segment.type !== 'quote')
            )
            .map((region) => (
              <TopicContentBlock key={region.keySuffix} contentWidth={320} region={region} />
            ))}
        </TopicSplitDisclosureScope>
      </TopicTableScrollProvider>
    </TopicSplitDisclosureProvider>
  );
}

describe('native topic structured rendering', () => {
  it('[REG-TOPIC-090][REG-A11Y-001] renders tabs and copies the complete styled terminal owner', async () => {
    const copy = jest.mocked(Clipboard.setStringAsync);
    copy.mockClear();
    const toast = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => undefined);
    const html =
      '<forum-terminal-report>' +
      '<forum-terminal-tab title="Overview"><div class="forum-terminal-code">overview</div></forum-terminal-tab>' +
      '<forum-terminal-tab title="Benchmark"><div class="forum-terminal-code"><span style="color: #22c55e; background-color: #111827">benchmark result</span><br>complete line</div></forum-terminal-tab>' +
      '</forum-terminal-report>';
    const screen = await render(<CompiledContentFixture html={html} />);

    expect(screen.getByText('overview')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Benchmark' }));
    expect(StyleSheet.flatten(screen.getByText('benchmark result').props.style)).toMatchObject({
      backgroundColor: '#111827',
      color: '#22c55e'
    });
    await fireEvent.press(screen.getByRole('button', { name: '复制完整代码' }));
    expect(copy).toHaveBeenCalledWith('benchmark result\ncomplete line');
    expect(toast).toHaveBeenCalledWith('代码已复制', ToastAndroid.SHORT);
    toast.mockRestore();
  });

  it('[REG-TOPIC-089][REG-TOPIC-090][REG-TOPIC-093] reports complete-code copy failure', async () => {
    const copy = jest.mocked(Clipboard.setStringAsync);
    copy.mockRejectedValueOnce(new Error('clipboard unavailable'));
    const toast = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => undefined);
    const sourceText = Array.from({ length: 180 }, (_, index) => `line-${index + 1}:${'x'.repeat(80)}`).join('\n');
    const screen = await render(<CompiledContentFixture html={`<pre>${sourceText}</pre>`} source="linuxdo" />);

    await fireEvent.press(screen.getByRole('button', { name: '复制完整代码' }));
    expect(copy).toHaveBeenCalledWith(sourceText);
    expect(toast).toHaveBeenCalledWith('复制失败', ToastAndroid.SHORT);
    toast.mockRestore();
  });

  it('[REG-TOPIC-086/088/093/094/097/098] renders one 240-line code owner with the shared pan policy', async () => {
    const lines = Array.from({ length: 240 }, (_, index) => `line-${index + 1}:${'x'.repeat(90)}\n`);
    const codeRegion = compileForumContent({
      html: `<pre>${lines.join('')}</pre>`,
      role: 'reply',
      source: 'linuxdo'
    }).regions[0];
    if (!codeRegion || codeRegion.kind !== 'island' || codeRegion.segment.type !== 'codeBlock') {
      throw new Error('Expected one code island.');
    }
    const screen = await render(
      <TopicTableScrollProvider>
        <TopicSplitDisclosureScope scopeKey="reply:9:body">
          <TopicContentBlock contentWidth={320} region={codeRegion} />
        </TopicSplitDisclosureScope>
      </TopicTableScrollProvider>
    );

    const codeScroll = screen.getByTestId('topic-code-scroll');
    expect(codeScroll.props.gestureConfig).toMatchObject({ enabled: true, manualActivation: true, maxPointers: 1 });
    expect(mockPanGestures[0]?.config.blocksExternalGesture).toEqual([mockNativeGestures[0]]);
    const nativeBinding = mockGestureBindings.find(({ gesture }) => gesture === mockNativeGestures[0]);
    expect(nativeBinding?.child.type).toBe(View);
    expect(nativeBinding?.child.props.collapsable).toBe(false);
    await fireEvent(codeScroll, 'contentSizeChange', 960, 21);
    const stateManager = { activate: jest.fn(), fail: jest.fn() };
    codeScroll.props.onTouchesDown?.(
      { allTouches: [{ absoluteX: 100, absoluteY: 200 }], numberOfTouches: 1 },
      stateManager
    );
    codeScroll.props.onTouchesMove?.(
      { allTouches: [{ absoluteX: 105, absoluteY: 201 }], numberOfTouches: 1 },
      stateManager
    );
    expect(stateManager.activate).toHaveBeenCalledTimes(1);
    expect(codeRegion.segment.copyText).toBe(lines.join(''));
    expect(JSON.stringify(screen.toJSON())).toContain('line-240:');
  });

  it('[REG-TOPIC-088] keeps the LinuxDo 52-line decorated pre in one code frame', async () => {
    const html = `<pre>${Array.from(
      { length: 52 },
      (_, index) => `<span data-line="${index + 1}">line-${String(index + 1).padStart(2, '0')}</span>\n`
    ).join('')}</pre>`;
    const codeRegion = compileForumContent({ html, role: 'reply', source: 'linuxdo' }).regions[0];
    if (!codeRegion || codeRegion.kind !== 'island' || codeRegion.segment.type !== 'codeBlock') {
      throw new Error('Expected one semantic code block.');
    }

    const screen = await render(
      <TopicTableScrollProvider>
        <TopicSplitDisclosureScope scopeKey="reply:9:body">
          <TopicContentBlock contentWidth={320} query="line-52" region={codeRegion} />
        </TopicSplitDisclosureScope>
      </TopicTableScrollProvider>
    );
    expect(screen.getAllByTestId('topic-code-frame')).toHaveLength(1);
    expect(StyleSheet.flatten(screen.getByText('line-52').props.style)?.backgroundColor).toBeTruthy();
  });
});
