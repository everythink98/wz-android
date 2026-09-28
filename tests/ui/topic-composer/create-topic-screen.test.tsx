import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createRef, useRef, useState, type ComponentProps, type Ref } from 'react';
import { Dimensions, StatusBar as NativeStatusBar, StyleSheet, Text } from 'react-native';
import * as ReactNative from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardState } from 'react-native-reanimated';
import { TopicComposerScreen } from '@/features/topic-composer/TopicComposerScreen';
import {
  emptyTopicDraft,
  type TopicCreationContext,
  type TopicCreationSource,
  type TopicDraft,
  type TopicTagSearchResult
} from '@/domain/forum/topicComposer';
import { createSiteSessionViewModel, type SiteSessionViewModels } from '@/domain/session/siteSessionState';
import type { StructuredReplyComposer, StructuredReplyComposerHandle } from '@/ui/composer/StructuredReplyComposer';
import type { ComposerSnapshot } from '@/domain/forum/structuredComposer';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';
import { createTheme } from '@/ui/theme/tokens';
import { act, fireEvent, render, waitFor, within } from '../render';

type Controller = ComponentProps<typeof TopicComposerScreen>['controller'];
let mockStructuredProps: ComponentProps<typeof StructuredReplyComposer>;
let mockUseRealEditor = false;
const mockKeyboardStreams = new Set<{ height: { value: number }; state: { value: number } }>();
const mockKeyboardFrames = new Set<() => void>();
const mockKeyboardStyles = new Map<object, () => { paddingBottom?: number; maxHeight?: number | string }>();
let mockQueuedJS: (() => void)[] | null = null;
jest.mock('@/ui/composer/StructuredReplyComposer', () => ({
  StructuredReplyComposer: require('react').forwardRef(
    (props: ComponentProps<typeof StructuredReplyComposer>, ref: Ref<StructuredReplyComposerHandle>) => {
      mockStructuredProps = props;
      if (mockUseRealEditor)
        return require('react').createElement(
          jest.requireActual<typeof import('@/ui/composer/StructuredReplyComposer')>(
            '@/ui/composer/StructuredReplyComposer'
          ).StructuredReplyComposer,
          { ...props, ref }
        );
      return require('react').createElement(
        require('react-native').View,
        { testID: 'topic-rich-editor' },
        props.footerActions
      );
    }
  )
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  ...jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated'),
  default: {
    ...jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated').default,
    View: require('react-native').View
  },
  useAnimatedKeyboard: () => {
    const ReactModule = require('react') as typeof import('react');
    const keyboard = ReactModule.useRef({ height: { value: 0 }, state: { value: 0 } }).current;
    ReactModule.useEffect(() => {
      mockKeyboardStreams.add(keyboard);
      return () => {
        mockKeyboardStreams.delete(keyboard);
      };
    }, [keyboard]);
    return keyboard;
  },
  useSharedValue: (value: number) =>
    (require('react') as typeof import('react')).useRef({
      value,
      set(next: number) {
        this.value = next;
      }
    }).current,
  useAnimatedStyle: (factory: () => { paddingBottom?: number; maxHeight?: number | string }) => {
    const style = factory();
    mockKeyboardStyles.set(style, factory);
    return style;
  },
  runOnUI: (callback: (...args: unknown[]) => unknown) => callback,
  runOnJS:
    <T extends unknown[]>(callback: (...args: T) => unknown) =>
    (...args: T) => {
      if (mockQueuedJS) mockQueuedJS.push(() => callback(...args));
      else callback(...args);
    },
  useAnimatedReaction: <T,>(prepare: () => T, react: (value: T, previous: T | null) => void) => {
    const ReactModule = require('react') as typeof import('react');
    const previous = ReactModule.useRef<T | null>(null);
    ReactModule.useEffect(() => {
      const frame = () => {
        const value = prepare();
        react(value, previous.current);
        previous.current = value;
      };
      mockKeyboardFrames.add(frame);
      frame();
      return () => {
        mockKeyboardFrames.delete(frame);
      };
    }, [prepare, react]);
  }
}));

async function press(...args: Parameters<typeof fireEvent.press>) {
  await act(async () => {
    await fireEvent.press(...args);
    // Programmatic keyboard handoff settles on the following UI frame.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

async function openTopicMore(view: Awaited<ReturnType<typeof render>>) {
  await press(view.getByLabelText('附件与草稿'));
  await waitFor(() => expect(view.getByLabelText('关闭发帖选项')).toBeTruthy());
}

function session(source: TopicCreationSource) {
  return createSiteSessionViewModel({
    site: source,
    status: 'logged-in',
    cookieSummary: [],
    isVerifying: false,
    currentUser: { source, id: '7', username: `${source}-writer`, url: `https://example.com/${source}` }
  });
}
const sessions: SiteSessionViewModels = {
  linuxdo: session('linuxdo'),
  nodeseek: session('nodeseek'),
  yaohuo: session('yaohuo')
};
const categories = [{ id: '1', name: '日常交流' }];
const linuxdoContext: TopicCreationContext = {
  source: 'linuxdo',
  categories,
  maxTags: 3,
  canCreateTag: true,
  postVotingEnabled: true,
  allowedExtensions: ['png', 'pdf'],
  maxImageBytes: 1000000,
  maxAttachmentBytes: 1000000,
  canUploadAttachments: true,
  pollCapabilities: { groups: [], canUseStaffResults: false }
};
function contextFor(source: TopicCreationSource): TopicCreationContext {
  if (source === 'linuxdo') return linuxdoContext;
  if (source === 'nodeseek') return { source, categories, ranks: [0, 1, 255], insideFee: 5 };
  return {
    source,
    categories,
    kinds: ['normal', 'gift', 'poll', 'files', 'resources'],
    allowedFileExtensions: ['txt', 'png']
  };
}
function draftFor(source: TopicCreationSource) {
  return { ...emptyTopicDraft(source, `${source}:7`), title: '草稿标题', body: '正文', categoryId: '1' };
}
function controllerFor(draft: TopicDraft, overrides: Partial<Controller> = {}): Controller {
  return {
    editing: false,
    editContext: null,
    hasChanges: false,
    reviewLatest: async () => undefined,
    rebaseEdit: async () => undefined,
    source: draft.source,
    draft,
    context: contextFor(draft.source),
    loading: false,
    contextLoading: false,
    busy: false,
    uploading: false,
    error: '',
    contextError: '',
    contextNeedsVerification: false,
    errors: {},
    saveStatus: '已保存',
    attempt: null,
    draftSites: {},
    emojiUrls: {},
    editorRef: { current: null },
    enabled: true,
    session: sessions[draft.source],
    change: jest.fn(),
    acceptSnapshot: jest.fn(),
    flush: async () => draft,
    switchSource: jest.fn(async () => undefined),
    leave: async () => true,
    submit: jest.fn(async () => undefined),
    discard: jest.fn(async () => undefined),
    acknowledgeUnknown: jest.fn(async () => undefined),
    searchTags: jest.fn(async () => ({ tags: [] })),
    pickAttachments: jest.fn(async () => undefined),
    uploadFiles: jest.fn(async () => undefined),
    removeAttachment: jest.fn(async () => undefined),
    insertMarkup: jest.fn(async () => undefined),
    editorServices: {
      loadTemplates: async () => [],
      resolveUpload: async () => '',
      useTemplate: async () => undefined
    },
    reloadContext: jest.fn(),
    retryDraft: jest.fn(),
    changeCategory: jest.fn(async () => undefined),
    ...overrides
  };
}
function Harness({
  active = true,
  editorEnabled = true,
  initialDraft = draftFor('yaohuo'),
  overrides = {},
  sessionModels = sessions,
  topInset = 24,
  onOpenAccount = jest.fn()
}: {
  active?: boolean;
  editorEnabled?: boolean;
  initialDraft?: TopicDraft;
  overrides?: Partial<Controller>;
  sessionModels?: SiteSessionViewModels;
  topInset?: number;
  onOpenAccount?: (source: TopicCreationSource) => void;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const stable = useRef(controllerFor(initialDraft));
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 400, height: 800 },
        insets: { top: topInset, left: 0, right: 0, bottom: 24 }
      }}
    >
      <Text testID="draft-state">{JSON.stringify(draft)}</Text>
      <TopicComposerScreen
        active={active}
        editorEnabled={editorEnabled}
        controller={{ ...stable.current, draft, change: setDraft, ...overrides }}
        sessions={sessionModels}
        enabledSources={['linuxdo', 'nodeseek', 'yaohuo']}
        onBack={jest.fn()}
        onOpenAccount={onOpenAccount}
        onManageSources={jest.fn()}
      />
    </SafeAreaProvider>
  );
}

describe('Create topic screen', () => {
  it('locks the site and respects independent title, body and tag permissions while editing', async () => {
    const draft = draftFor('linuxdo');
    draft.edit = {
      topicId: '123',
      postId: 789,
      original: { title: draft.title, body: draft.body, categoryId: draft.categoryId, tags: [] }
    };
    const editContext = {
      ...draft.edit,
      source: draft.source,
      identityKey: draft.identityKey,
      rules: contextFor('linuxdo'),
      permissions: { title: false, body: false, categoryId: false, tags: true, rank: false, additionalReward: false }
    };
    const view = await render(
      <Harness initialDraft={draft} overrides={{ editing: true, editContext, hasChanges: false }} />
    );
    expect(view.getByRole('button', { name: '编辑帖子' })).toBeDisabled();
    expect(view.queryByLabelText('切换发帖网站')).toBeNull();
    expect(view.getByLabelText('帖子标题').props.editable).toBe(false);
    expect(mockStructuredProps.readOnly).toBe(true);
    expect(mockStructuredProps.intent).toMatchObject({ kind: 'edit-topic', topicId: '123' });
    expect(view.getByRole('button', { name: '保存修改' })).toBeDisabled();
    expect(view.getByRole('button', { name: '选择标签' })).not.toBeDisabled();
    await openTopicMore(view);
    expect(view.queryByLabelText('帖子设置')).toBeNull();
  });

  it('offers only additional reward for Yaohuo edits and no new post type controls', async () => {
    const draft = draftFor('yaohuo');
    draft.edit = { topicId: '123', original: { title: draft.title, body: draft.body, categoryId: draft.categoryId } };
    const editContext = {
      ...draft.edit,
      source: draft.source,
      identityKey: draft.identityKey,
      rules: contextFor('yaohuo'),
      permissions: { title: true, body: true, categoryId: false, tags: false, rank: false, additionalReward: true }
    };
    const view = await render(
      <Harness initialDraft={draft} overrides={{ editing: true, editContext, hasChanges: true }} />
    );
    await press(view.getByLabelText('帖子设置'));
    expect(view.getByLabelText('追加悬赏妖晶（选填）')).toBeTruthy();
    expect(view.queryByRole('radio', { name: '派币' })).toBeNull();
    expect(view.queryByLabelText('悬赏妖晶（选填，至少 1000）')).toBeNull();
  });
  it('shows an in-flight publication as progress and offers reconciliation only after the request ends', async () => {
    const draft = draftFor('linuxdo');
    const attempt = {
      id: 'sending',
      source: draft.source,
      identityKey: draft.identityKey,
      draftId: draft.id,
      revision: draft.revision,
      startedAt: 1,
      status: 'sending' as const
    };
    const view = await render(<Harness initialDraft={draft} overrides={{ busy: true, attempt }} />);
    expect(view.getByRole('button', { name: '发布' })).toBeDisabled();
    expect(view.queryByText('上次发布结果尚未确认，请先到原站核对。')).toBeNull();
    expect(view.queryByText('已核对，未发布')).toBeNull();
    await view.rerender(<Harness initialDraft={draft} overrides={{ busy: false, attempt }} />);
    expect(view.getByText('已核对，未发布')).toBeTruthy();
  });

  it('shows attachment operation errors inside the open panel', async () => {
    const draft = draftFor('linuxdo');
    const view = await render(<Harness initialDraft={draft} />);
    await openTopicMore(view);
    await press(view.getByLabelText('附件'));
    await view.rerender(<Harness initialDraft={draft} overrides={{ error: '文件不可读取，请重新选择' }} />);
    let panel = view.getByLabelText('关闭发帖选项').parent;
    while (panel && panel.type !== 'Modal') panel = panel.parent;
    expect(panel).not.toBeNull();
    expect(within(panel!).getByText('文件不可读取，请重新选择')).toBeTruthy();
  });

  it('shows the topic fields before mounting the editor and preserves early title input', async () => {
    const draft = draftFor('linuxdo');
    const view = await render(<Harness initialDraft={draft} editorEnabled={false} />);
    expect(view.getByLabelText('切换发帖网站')).toBeTruthy();
    expect(view.getByLabelText('帖子标题')).toBeTruthy();
    expect(view.queryByTestId('topic-rich-editor')).toBeNull();
    expect(view.getByText('正在准备正文…')).toBeTruthy();
    await fireEvent.changeText(view.getByLabelText('帖子标题'), '页面进入后立即输入');
    await view.rerender(<Harness initialDraft={draft} editorEnabled />);
    expect(view.getByTestId('topic-rich-editor')).toBeTruthy();
    expect(view.getByLabelText('帖子标题').props.value).toBe('页面进入后立即输入');
  });

  beforeEach(() => {
    mockUseRealEditor = false;
    mockKeyboardStyles.clear();
    mockQueuedJS = null;
  });
  it('places posting options before the title and body', async () => {
    const view = await render(<Harness initialDraft={draftFor('yaohuo')} />);
    const fields = view.getAllByLabelText(/^(日常交流|帖子标题|帖子正文)$/);
    const labels = fields.map((node) => node.props.accessibilityLabel);
    expect(labels.indexOf('日常交流')).toBeLessThan(labels.indexOf('帖子标题'));
    expect(labels.indexOf('帖子标题')).toBeLessThan(labels.indexOf('帖子正文'));
  });
  it.each([
    ['nodeseek', '公开', '阅读权限'],
    ['linuxdo', '普通主题', '问答／帖子投票主题'],
    ['yaohuo', '普通帖', '悬赏妖晶（选填，至少 1000）']
  ] satisfies [TopicCreationSource, string, string][])(
    'opens %s settings directly from the page with the current value visible',
    async (source, value, field) => {
      const view = await render(<Harness initialDraft={draftFor(source)} />);
      const settings = view.getByRole('button', { name: '帖子设置' });
      expect(within(settings).getByText(value)).toBeTruthy();
      await press(settings);
      expect(source === 'nodeseek' ? view.getByText(field) : view.getByLabelText(field)).toBeTruthy();
      await press(view.getByLabelText('关闭发帖选项'));
      expect(view.getByLabelText('帖子标题').props.value).toBe('草稿标题');
    }
  );
  it('releases the page keyboard viewport while a modal or another activity owns input', async () => {
    mockUseRealEditor = true;
    const view = await render(<Harness initialDraft={draftFor('nodeseek')} />);
    const webView = view.getByTestId('structured-composer-webview');
    await fireEvent(webView, 'loadEnd');
    await fireEvent(webView, 'message', {
      nativeEvent: { data: JSON.stringify({ type: 'READY', payload: { documentEpoch: 0, revision: 0 } }) }
    });
    const messages = () => webView.props.postMessageMock.mock.calls.map(([raw]: [string]) => JSON.parse(raw));
    const padding = () => {
      const styles = [view.getByTestId('create-topic-keyboard-viewport').props.style].flat(Infinity);
      const read = styles.map((style) => mockKeyboardStyles.get(style)).find(Boolean)!;
      return read().paddingBottom;
    };
    const keyboardFrame = async (height: number) =>
      act(() => {
        mockKeyboardStreams.forEach((keyboard) => {
          keyboard.height.value = height;
          keyboard.state.value = height > 0 ? KeyboardState.OPEN : KeyboardState.CLOSED;
        });
        mockKeyboardFrames.forEach((frame) => frame());
      });
    expect(mockKeyboardStreams.size).toBe(1);
    await keyboardFrame(336);
    expect(padding()).toBeGreaterThan(300);
    // Keep this window and its observer until the native hide has completed.
    await act(() => {
      void fireEvent.press(view.getByLabelText('附件与草稿'));
    });
    expect(mockKeyboardStreams.size).toBe(1);
    expect(view.queryByLabelText('关闭发帖选项')).toBeNull();
    expect(messages()).not.toContainEqual({ type: 'COMMAND', payload: { name: 'blur' } });
    await keyboardFrame(0);
    await waitFor(() => expect(view.getByLabelText('关闭发帖选项')).toBeTruthy());
    expect(messages()).toContainEqual({ type: 'COMMAND', payload: { name: 'blur' } });
    expect(mockKeyboardStreams.size).toBe(0);
    expect(padding()).toBe(0);
    webView.props.postMessageMock.mockClear();
    await press(view.getByLabelText('关闭发帖选项'));
    expect(view.getByTestId('structured-composer-webview')).toBe(webView);
    expect(messages()).not.toContainEqual({ type: 'COMMAND', payload: { name: 'focus' } });
    expect(mockKeyboardStreams.size).toBe(1);
    expect(padding()).toBe(0);
    await keyboardFrame(336);
    await view.rerender(<Harness active={false} initialDraft={draftFor('nodeseek')} />);
    expect(mockKeyboardStreams.size).toBe(0);
    expect(padding()).toBe(0);
    await view.rerender(<Harness initialDraft={draftFor('nodeseek')} />);
    expect(mockKeyboardStreams.size).toBe(1);
    expect(padding()).toBe(0);
  });
  it('closes Yaohuo body tools when opening page settings and keeps the draft on return', async () => {
    const view = await render(<Harness initialDraft={draftFor('yaohuo')} />);
    expect(view.queryByLabelText('更多编辑工具')).toBeNull();
    await press(view.getByLabelText('文字格式'));
    expect(view.getByLabelText('粗体')).toBeTruthy();
    await press(view.getByRole('button', { name: '帖子设置' }));
    expect(view.getByLabelText('悬赏妖晶（选填，至少 1000）')).toBeTruthy();
    await press(view.getByLabelText('关闭发帖选项'));
    expect(view.queryByLabelText('粗体')).toBeNull();
    expect(view.getByLabelText('帖子正文').props.value).toBe('正文');
    expect(view.getByLabelText('帖子标题').props.value).toBe('草稿标题');
  });
  it('waits for the embedded viewport native hide completion before dispatching an image picker', async () => {
    const frames: FrameRequestCallback[] = [];
    const frame = jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    try {
      const view = await render(<Harness initialDraft={draftFor('nodeseek')} />);
      const keyboardFrame = async (height: number, state: number) =>
        act(() => {
          mockKeyboardStreams.forEach((keyboard) => {
            keyboard.height.value = height;
            keyboard.state.value = state;
          });
          mockKeyboardFrames.forEach((callback) => callback());
          frames.splice(0).forEach((callback) => callback(0));
        });
      await keyboardFrame(336, KeyboardState.CLOSING);
      const opened = jest.fn();
      const waiting = mockStructuredProps.awaitKeyboardSettled!().then(opened);
      await keyboardFrame(0, KeyboardState.CLOSING);
      expect(opened).not.toHaveBeenCalled();
      await keyboardFrame(0, KeyboardState.CLOSED);
      expect(opened).not.toHaveBeenCalled();
      await keyboardFrame(0, KeyboardState.CLOSED);
      await waiting;
      expect(opened).toHaveBeenCalledTimes(1);
      expect(mockKeyboardStreams.size).toBe(1);
      await view.unmount();
    } finally {
      frame.mockRestore();
    }
  });
  it('keeps title metadata and its summary exclusive across keyboard frames and title editing', async () => {
    const original = Dimensions.get('window');
    Dimensions.set({ window: { width: 343, height: 609, scale: 2.625, fontScale: 1.4 } });
    try {
      const view = await render(<Harness initialDraft={draftFor('linuxdo')} />);
      const metadata = () => {
        let node = view.getByLabelText('帖子标题', { includeHiddenElements: true }).parent;
        while (node && node.props.accessibilityElementsHidden === undefined) node = node.parent;
        return node!;
      };
      const expectMetadata = (collapsed: boolean) => {
        const animatedHeight = [...mockKeyboardStyles.values()]
          .map((style) => style())
          .findLast((style) => 'maxHeight' in style)?.maxHeight;
        expect(animatedHeight ?? StyleSheet.flatten(metadata().props.style).maxHeight).toBe(collapsed ? 0 : '42%');
        expect(metadata().props.accessibilityElementsHidden).toBe(collapsed);
        expect(Boolean(view.queryByLabelText('查看标题与标签'))).toBe(collapsed);
        expect(view.getAllByRole('button', { name: '帖子设置' })).toHaveLength(1);
        expect(view.getAllByRole('button', { name: '附件与草稿' })).toHaveLength(1);
      };
      await act(() => {
        mockKeyboardStreams.forEach((keyboard) => {
          keyboard.height.value = 283;
        });
        mockKeyboardFrames.forEach((frame) => frame());
      });
      expectMetadata(true);
      const title = view.getByLabelText('帖子标题', { includeHiddenElements: true });
      await fireEvent(title, 'focus');
      expectMetadata(false);
      await fireEvent.changeText(title, '仍然可以修改的标题');
      expect(title.props.value).toBe('仍然可以修改的标题');
      await fireEvent(title, 'blur');
      expectMetadata(true);
      // Native insets reach zero before the queued React keyboard update commits.
      mockQueuedJS = [];
      await act(() => {
        mockKeyboardStreams.forEach((keyboard) => {
          keyboard.height.value = 0;
        });
        mockKeyboardFrames.forEach((frame) => frame());
      });
      expectMetadata(true);
      await act(() => {
        const queued = mockQueuedJS!;
        mockQueuedJS = null;
        queued.forEach((callback) => callback());
      });
      expectMetadata(false);
    } finally {
      await act(() => Dimensions.set({ window: original }));
    }
  });
  it('keeps metadata compact while a tools-to-body return waits for its first native keyboard frame', async () => {
    mockUseRealEditor = true;
    const view = await render(<Harness initialDraft={draftFor('linuxdo')} />);
    const webView = view.getByTestId('structured-composer-webview');
    const source = webView.props.source;
    const send = async (type: string, payload: object) => {
      await fireEvent(webView, 'message', { nativeEvent: { data: JSON.stringify({ type, payload }) } });
    };
    const keyboardFrame = async (height: number) =>
      act(() => {
        mockKeyboardStreams.forEach((keyboard) => {
          keyboard.height.value = height;
          keyboard.state.value = height > 0 ? KeyboardState.OPEN : KeyboardState.CLOSED;
        });
        mockKeyboardFrames.forEach((frame) => frame());
      });
    await send('READY', { documentEpoch: 0, revision: 0 });
    await send('PANEL_CHANGED', { documentEpoch: 0, open: true });
    expect(view.getByLabelText('查看标题与标签')).toBeTruthy();
    await send('RETURN_TO_EDITOR', { documentEpoch: 0 });
    await send('PANEL_CHANGED', { documentEpoch: 0, open: false });
    expect(view.queryByLabelText('帖子标题')).toBeNull();
    expect(view.getByLabelText('查看标题与标签')).toBeTruthy();
    expect(webView.props.requestFocusMock).toHaveBeenCalledTimes(1);
    await keyboardFrame(283);
    expect(view.getByLabelText('查看标题与标签')).toBeTruthy();
    await keyboardFrame(0);
    expect(view.getByLabelText('帖子标题').props.value).toBe('草稿标题');
    expect(view.queryByLabelText('查看标题与标签')).toBeNull();
    await send('PANEL_CHANGED', { documentEpoch: 0, open: true });
    await send('PANEL_CHANGED', { documentEpoch: 0, open: false });
    expect(view.getByLabelText('帖子标题')).toBeTruthy();
    expect(view.getByTestId('structured-composer-webview')).toBe(webView);
    expect(webView.props.source).toBe(source);
    expect(JSON.parse(view.getByTestId('draft-state').props.children).body).toBe('正文');
  });
  it('does not retain a handoff when the body already owns an open keyboard without a tools panel', async () => {
    mockUseRealEditor = true;
    const view = await render(<Harness initialDraft={draftFor('linuxdo')} />);
    const editor = view.getByTestId('structured-composer-webview');
    const send = async (type: string, payload: object) => {
      await fireEvent(editor, 'message', { nativeEvent: { data: JSON.stringify({ type, payload }) } });
    };
    const keyboardFrame = async (height: number, state: KeyboardState) =>
      act(() => {
        mockKeyboardStreams.forEach((keyboard) => {
          keyboard.height.value = height;
          keyboard.state.value = state;
        });
        mockKeyboardFrames.forEach((frame) => frame());
      });
    await send('READY', { documentEpoch: 0, revision: 0 });
    await keyboardFrame(283, KeyboardState.OPEN);
    await send('RETURN_TO_EDITOR', { documentEpoch: 0 });
    await keyboardFrame(120, KeyboardState.CLOSING);
    await keyboardFrame(0, KeyboardState.CLOSED);
    expect(view.getByLabelText('帖子标题').props.value).toBe('草稿标题');
    expect(view.queryByLabelText('查看标题与标签')).toBeNull();
    expect(view.getByTestId('structured-composer-webview')).toBe(editor);
  });
  it.each([
    { label: '文字格式', item: '粗体' },
    { label: '表情', item: '淡定' }
  ])('keeps topic metadata compact between native hide and Yaohuo $label readiness', async ({ label, item }) => {
    const view = await render(<Harness initialDraft={draftFor('yaohuo')} />);
    const keyboardFrame = async (height: number, state: KeyboardState) =>
      act(() => {
        mockKeyboardStreams.forEach((keyboard) => {
          keyboard.height.value = height;
          keyboard.state.value = state;
        });
        mockKeyboardFrames.forEach((frame) => frame());
      });
    await keyboardFrame(283, KeyboardState.OPEN);
    const queuedFrames: FrameRequestCallback[] = [];
    const frame = jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      queuedFrames.push(callback);
      return queuedFrames.length;
    });
    try {
      await fireEvent.press(view.getByLabelText(label));
      expect(view.queryByLabelText(item)).toBeNull();
      await keyboardFrame(0, KeyboardState.CLOSED);
      // Native IME is already gone, but the handoff still owes its two UI-frame checks.
      expect(view.queryByLabelText(item)).toBeNull();
      expect(view.queryByLabelText('帖子标题')).toBeNull();
      expect(view.getByLabelText('查看标题与标签')).toBeTruthy();
      for (let index = 0; index < 2; index += 1) {
        await act(() => queuedFrames.splice(0).forEach((callback) => callback(index)));
      }
      expect(view.getByLabelText(item)).toBeTruthy();
      expect(view.queryByLabelText('帖子标题')).toBeNull();
      expect(view.getByLabelText('查看标题与标签')).toBeTruthy();
      expect(view.getByLabelText('帖子正文').props.value).toBe('正文');
    } finally {
      frame.mockRestore();
      await view.unmount();
    }
  });
  it.each([
    { source: 'linuxdo', finishesHide: true },
    { source: 'linuxdo', finishesHide: false },
    { source: 'yaohuo', finishesHide: true },
    { source: 'yaohuo', finishesHide: false }
  ] as const)(
    'keeps the $source return pending through an older keyboard hide (finishesHide=$finishesHide)',
    async ({ source, finishesHide }) => {
      mockUseRealEditor = true;
      const view = await render(<Harness initialDraft={draftFor(source)} />);
      const editor =
        source === 'yaohuo' ? view.getByLabelText('帖子正文') : view.getByTestId('structured-composer-webview');
      const send = async (type: string, payload: object) => {
        await fireEvent(editor, 'message', { nativeEvent: { data: JSON.stringify({ type, payload }) } });
      };
      const keyboardFrame = async (height: number, state: KeyboardState) =>
        act(() => {
          mockKeyboardStreams.forEach((keyboard) => {
            keyboard.height.value = height;
            keyboard.state.value = state;
          });
          mockKeyboardFrames.forEach((frame) => frame());
        });
      if (source !== 'yaohuo') await send('READY', { documentEpoch: 0, revision: 0 });
      await keyboardFrame(283, KeyboardState.OPEN);
      if (source === 'yaohuo') {
        await press(view.getByLabelText('文字格式'));
        expect(view.queryByLabelText('粗体')).toBeNull();
        // The native tool now opens only after the controlled hide has settled.
        // Exercise return from an open panel, not cancellation of its pending entry.
        await keyboardFrame(0, KeyboardState.CLOSED);
        await waitFor(() => expect(view.getByLabelText('粗体')).toBeTruthy());
      } else await send('PANEL_CHANGED', { documentEpoch: 0, open: true });
      // A return intent can reach JS before the old hide has reached zero.
      await keyboardFrame(240, KeyboardState.CLOSING);
      if (source === 'yaohuo') {
        await press(view.getByLabelText('输入正文'));
        await fireEvent(editor, 'focus');
      } else {
        await send('RETURN_TO_EDITOR', { documentEpoch: 0 });
        await send('PANEL_CHANGED', { documentEpoch: 0, open: false });
        await send('RETURN_TO_EDITOR', { documentEpoch: 0 });
      }
      expect(view.getByLabelText('查看标题与标签')).toBeTruthy();
      if (finishesHide) {
        await keyboardFrame(0, KeyboardState.CLOSED);
        expect(view.queryByLabelText('帖子标题')).toBeNull();
        expect(view.getByLabelText('查看标题与标签')).toBeTruthy();
      }
      // Both a completed hide and a reversal at nonzero height are valid inputs.
      await keyboardFrame(120, KeyboardState.OPENING);
      await keyboardFrame(283, KeyboardState.OPEN);
      expect(view.getByLabelText('查看标题与标签')).toBeTruthy();
      // Once the new keyboard owns focus, a later ordinary hide must expand metadata.
      await keyboardFrame(120, KeyboardState.CLOSING);
      await keyboardFrame(0, KeyboardState.CLOSED);
      expect(view.getByLabelText('帖子标题').props.value).toBe('草稿标题');
      expect(view.queryByLabelText('查看标题与标签')).toBeNull();
      expect(
        source === 'yaohuo' ? view.getByLabelText('帖子正文') : view.getByTestId('structured-composer-webview')
      ).toBe(editor);
      expect(JSON.parse(view.getByTestId('draft-state').props.children).body).toBe('正文');
    }
  );
  it('keeps metadata compact when a Yaohuo tool returns focus before the first keyboard frame', async () => {
    const view = await render(<Harness initialDraft={draftFor('yaohuo')} />);
    await press(view.getByLabelText('文字格式'));
    expect(view.getByLabelText('查看标题与标签')).toBeTruthy();
    await press(view.getByLabelText('输入正文'));
    await fireEvent(view.getByLabelText('帖子正文'), 'focus');
    expect(view.queryByLabelText('帖子标题')).toBeNull();
    expect(view.getByLabelText('查看标题与标签')).toBeTruthy();
    for (const height of [283, 0]) {
      await act(() => {
        mockKeyboardStreams.forEach((keyboard) => {
          keyboard.height.value = height;
          keyboard.state.value = height > 0 ? KeyboardState.OPEN : KeyboardState.CLOSED;
        });
        mockKeyboardFrames.forEach((frame) => frame());
      });
    }
    expect(view.getByLabelText('帖子标题').props.value).toBe('草稿标题');
    expect(view.queryByLabelText('查看标题与标签')).toBeNull();
    expect(view.getByLabelText('帖子正文').props.value).toBe('正文');
  });
  it.each(['title', 'inactive', 'read-only', 'new-draft', 'panel', 'preview'] as const)(
    'cancels an unstarted body keyboard handoff when the %s takes ownership',
    async (owner) => {
      mockUseRealEditor = true;
      const draft = draftFor('linuxdo');
      const view = await render(<Harness initialDraft={draft} />);
      const webView = view.getByTestId('structured-composer-webview');
      const send = async (type: string, payload: object) => {
        await fireEvent(webView, 'message', { nativeEvent: { data: JSON.stringify({ type, payload }) } });
      };
      await send('READY', { documentEpoch: 0, revision: 0 });
      await send('PANEL_CHANGED', { documentEpoch: 0, open: true });
      await send('RETURN_TO_EDITOR', { documentEpoch: 0 });
      await send('PANEL_CHANGED', { documentEpoch: 0, open: false });
      expect(view.getByLabelText('查看标题与标签')).toBeTruthy();
      if (owner === 'title') {
        const title = view.getByLabelText('帖子标题', { includeHiddenElements: true });
        await fireEvent(title, 'focus');
        await fireEvent(title, 'blur');
      } else if (owner === 'inactive') {
        await view.rerender(<Harness initialDraft={draft} active={false} />);
        await view.rerender(<Harness initialDraft={draft} />);
      } else if (owner === 'read-only') {
        await view.rerender(<Harness initialDraft={draft} overrides={{ busy: true }} />);
        await view.rerender(<Harness initialDraft={draft} />);
      } else if (owner === 'new-draft') {
        await view.rerender(<Harness initialDraft={draft} overrides={{ draft: { ...draft, id: 'replacement' } }} />);
      } else if (owner === 'panel') {
        await send('PANEL_CHANGED', { documentEpoch: 0, open: true });
        await send('PANEL_CHANGED', { documentEpoch: 0, open: false });
      } else {
        await send('REQUEST_HOST_ACTION', { requestId: 'preview', action: 'preview-topic' });
        await send('REQUEST_HOST_ACTION', { requestId: 'edit', action: 'preview-topic' });
      }
      expect(view.getByLabelText('帖子标题').props.value).toBe('草稿标题');
      expect(view.queryByLabelText('查看标题与标签')).toBeNull();
      expect(JSON.parse(view.getByTestId('draft-state').props.children).body).toBe('正文');
    }
  );
  it.each([
    { nativeBarHeight: 52, topInset: 24, expectedTop: 52 },
    { nativeBarHeight: 24, topInset: 60, expectedTop: 60 }
  ])(
    'keeps the header below the larger top obstruction without double padding ($expectedTop dp)',
    async ({ nativeBarHeight, topInset, expectedTop }) => {
      const nativeBar = jest.replaceProperty(NativeStatusBar, 'currentHeight', nativeBarHeight);
      try {
        const view = await render(<Harness topInset={topInset} />);
        const safeArea = view.getByTestId('create-topic-safe-area');
        expect(StyleSheet.flatten(safeArea.props.style).paddingTop).toBe(expectedTop);
        expect(safeArea.props.edges).toMatchObject({ top: 'off', bottom: 'additive' });
      } finally {
        nativeBar.restore();
      }
    }
  );
  it('keeps the account and one editor action bar visible while moving draft deletion into more', async () => {
    mockUseRealEditor = true;
    const discard = jest.fn<Controller['discard']>(async () => undefined);
    const view = await render(<Harness initialDraft={draftFor('nodeseek')} overrides={{ discard }} />);
    expect(view.getByLabelText('切换发帖网站').props.accessibilityHint).toContain('nodeseek-writer');
    expect(view.queryByTestId('structured-composer-footer')).toBeNull();
    expect(view.queryByLabelText('附件')).toBeNull();
    expect(view.queryByLabelText('丢弃草稿')).toBeNull();
    await openTopicMore(view);
    expect(view.getAllByRole('button', { name: '帖子设置' })).toHaveLength(1);
    await press(view.getByLabelText('丢弃草稿'));
    expect(discard).toHaveBeenCalledTimes(1);
  });

  it.each(['nodeseek', 'linuxdo', 'yaohuo'] as const)(
    'starts %s image insertion from the editor and keeps recovery records separate from files',
    async (source) => {
      const pickAttachments = jest.fn<Controller['pickAttachments']>(async () => undefined);
      const context = source === 'linuxdo' ? { ...linuxdoContext, canUploadAttachments: false } : contextFor(source);
      const view = await render(<Harness initialDraft={draftFor(source)} overrides={{ context, pickAttachments }} />);
      if (source === 'linuxdo') {
        await openTopicMore(view);
        await press(view.getByLabelText('附件'));
        expect(view.queryByLabelText('选择附件')).toBeNull();
        expect(view.getByText('当前账号和站点规则不支持普通附件。')).toBeTruthy();
        await press(view.getByLabelText('关闭发帖选项'));
      }
      if (source === 'yaohuo') await press(view.getByLabelText('图片'));
      else
        await act(async () => {
          await mockStructuredProps.onUploadImage?.();
        });
      expect(pickAttachments).toHaveBeenCalledWith('image', true);
      await openTopicMore(view);
      await press(view.getByLabelText('图片上传记录'));
      expect(view.getByText('还没有图片上传记录')).toBeTruthy();
      expect(view.queryByLabelText('选择附件')).toBeNull();
      expect(view.queryByLabelText('选择本地文件')).toBeNull();
      expect(view.queryByLabelText('选择图片')).toBeNull();
    }
  );

  it('inserts a returned Yaohuo image between the surrounding text through its editor callback', async () => {
    const draft = { ...draftFor('yaohuo'), body: '前文后文' };
    const markup = '[img]https://example.com/photo.png[/img]';
    const pickAttachments = jest.fn<Controller['pickAttachments']>(async () => markup);
    const view = await render(<Harness initialDraft={draft} overrides={{ pickAttachments }} />);
    await fireEvent(view.getByLabelText('帖子正文'), 'selectionChange', {
      nativeEvent: { selection: { start: 2, end: 2 } }
    });
    await press(view.getByLabelText('图片'));
    await waitFor(() => expect(view.getByLabelText('帖子正文').props.value).toBe(`前文${markup}后文`));
    expect(pickAttachments).toHaveBeenCalledWith('image', true);
  });

  it('keeps uploaded images out of the LinuxDo file panel while retaining both records', async () => {
    const draft = draftFor('linuxdo');
    draft.attachments = [
      {
        id: 'photo',
        uri: 'file:///draft/photo.png',
        name: 'photo.png',
        size: 100,
        mimeType: 'image/png',
        kind: 'image',
        status: 'uploaded',
        description: '',
        markup: '![photo](upload://photo.png)'
      },
      {
        id: 'file',
        uri: 'file:///draft/a.txt',
        name: 'a.txt',
        size: 100,
        mimeType: 'text/plain',
        kind: 'attachment',
        status: 'uploaded',
        description: '',
        markup: '[a.txt|attachment](upload://a.txt)'
      }
    ];
    const view = await render(<Harness initialDraft={draft} />);
    await openTopicMore(view);
    await press(view.getByLabelText('附件 1'));
    expect(view.getByText('a.txt')).toBeTruthy();
    expect(view.queryByText('photo.png')).toBeNull();
    expect(view.queryByLabelText('选择图片')).toBeNull();
    await press(view.getByLabelText('关闭发帖选项'));
    await openTopicMore(view);
    await press(view.getByLabelText('图片上传记录'));
    expect(view.getByText('photo.png')).toBeTruthy();
    expect(view.queryByText('a.txt')).toBeNull();
    expect(view.getByLabelText('插入正文 photo.png')).toBeTruthy();
  });

  it.each(['image-only', 'image-mixed', 'file-mixed'] as const)(
    'locates %s rule failures in the affected media panel',
    async (kind) => {
      const draft = draftFor('linuxdo');
      draft.attachments = [
        {
          id: 'photo',
          uri: 'file:///photo.png',
          name: 'photo.png',
          size: 100,
          mimeType: 'image/png',
          kind: 'image',
          status: 'uploaded',
          description: '',
          markup: '![photo](upload://photo.png)'
        },
        ...(kind === 'image-only'
          ? []
          : [
              {
                id: 'document',
                uri: 'file:///a.pdf',
                name: 'a.pdf',
                size: 100,
                mimeType: 'application/pdf',
                kind: 'attachment' as const,
                status: 'uploaded' as const,
                description: '',
                markup: '[a.pdf|attachment](upload://a.pdf)'
              }
            ])
      ];
      const context = { ...linuxdoContext, allowedExtensions: kind === 'file-mixed' ? ['png'] : ['pdf'] };
      const errors = { attachments: '附件格式或大小不符合当前站点限制' };
      const view = await render(<Harness initialDraft={draft} overrides={{ context, errors }} />);
      expect(view.getByText(kind === 'file-mixed' ? 'a.pdf' : 'photo.png')).toBeTruthy();
      expect(view.queryByText(kind === 'file-mixed' ? 'photo.png' : 'a.pdf')).toBeNull();
      if (kind !== 'image-only') {
        await press(view.getByLabelText(kind === 'file-mixed' ? '查看图片记录' : '查看附件'));
        expect(view.getByText(kind === 'file-mixed' ? 'photo.png' : 'a.pdf')).toBeTruthy();
      }
    }
  );

  it('reveals the editor when an upload starts and lets the user reopen its progress panel', async () => {
    const draft = draftFor('linuxdo');
    const view = await render(<Harness initialDraft={draft} />);
    await openTopicMore(view);
    await press(view.getByLabelText('图片上传记录'));
    expect(view.getByText('还没有图片上传记录')).toBeTruthy();
    await view.rerender(<Harness initialDraft={draft} overrides={{ uploading: true }} />);
    expect(view.queryByText('还没有图片上传记录')).toBeNull();
    await openTopicMore(view);
    await press(view.getByLabelText('图片上传记录'));
    expect(view.getByText('还没有图片上传记录')).toBeTruthy();
  });

  it('does not reopen a media panel when a retry settles under an existing validation error', async () => {
    const draft = draftFor('linuxdo');
    draft.attachments = [
      {
        id: 'photo',
        uri: 'file:///photo.png',
        name: 'photo.png',
        size: 100,
        mimeType: 'image/png',
        kind: 'image',
        status: 'failed',
        description: ''
      }
    ];
    const errors = { attachments: '请先完成附件上传，或移除未完成的附件' };
    const view = await render(<Harness initialDraft={draft} overrides={{ errors }} />);
    expect(view.getByText('图片上传记录')).toBeTruthy();
    await view.rerender(<Harness initialDraft={draft} overrides={{ errors, uploading: true }} />);
    expect(view.queryByLabelText('关闭发帖选项')).toBeNull();
    await view.rerender(
      <Harness
        initialDraft={draft}
        overrides={{
          errors,
          uploading: false,
          draft: {
            ...draft,
            attachments: draft.attachments.map((file) => ({
              ...file,
              status: 'uploaded',
              markup: '![photo](upload://photo.png)'
            }))
          }
        }}
      />
    );
    expect(view.queryByLabelText('关闭发帖选项')).toBeNull();
  });

  it('shows local thumbnails and precise actions for queued, uploaded, failed and uncertain attachments', async () => {
    const draft = draftFor('linuxdo');
    draft.attachments = (['queued', 'uploaded', 'failed', 'unknown', 'uploading'] as const).map((status, index) => ({
      id: status,
      uri: `file:///draft/${status}.png`,
      name: `${status}.png`,
      size: 1200 + index,
      mimeType: 'image/png',
      kind: 'image',
      status,
      description: '',
      ...(status === 'uploaded' ? { markup: '![image](https://example.com/image.png)' } : {})
    }));
    const uploadFiles = jest.fn<Controller['uploadFiles']>(async () => undefined);
    const view = await render(<Harness initialDraft={draft} overrides={{ uploadFiles }} />);
    await openTopicMore(view);
    await press(view.getByLabelText('图片上传记录'));
    expect(view.getByLabelText('queued.png 缩略图').props.source).toEqual({ uri: 'file:///draft/queued.png' });
    expect(view.getByLabelText('插入正文 uploaded.png')).toBeTruthy();
    expect(view.queryByLabelText('上传并插入 uploaded.png')).toBeNull();
    expect(view.queryByLabelText('上传并插入 uploading.png')).toBeNull();
    expect(view.getByLabelText('重试上传 failed.png')).toBeTruthy();
    expect(view.getByText(/上传结果待核对/)).toBeTruthy();
    await press(view.getByLabelText('核对后重传 unknown.png'));
    expect(uploadFiles).toHaveBeenCalledWith([draft.attachments[3]]);
    await press(view.getByLabelText('上传并插入 queued.png'));
    expect(uploadFiles).toHaveBeenCalledWith([draft.attachments[0]]);
    expect(view.getByText('移出草稿不会删除已插入的正文链接，也不会删除网站上的文件。')).toBeTruthy();
    await fireEvent(view.getByLabelText('queued.png 缩略图'), 'error');
    expect(view.queryByLabelText('queued.png 缩略图')).toBeNull();
  });

  it('offers explicit login verification after a rules challenge while preserving the editable draft', async () => {
    const onOpenAccount = jest.fn();
    const reloadContext = jest.fn();
    const view = await render(
      <Harness
        initialDraft={draftFor('linuxdo')}
        onOpenAccount={onOpenAccount}
        overrides={{
          context: null,
          contextError: '请完成原站验证后重试',
          contextNeedsVerification: true,
          reloadContext
        }}
      />
    );
    expect(onOpenAccount).not.toHaveBeenCalled();
    expect(view.getByLabelText('帖子标题').props.value).toBe('草稿标题');
    await press(view.getByText('验证登录'));
    expect(onOpenAccount).toHaveBeenCalledWith('linuxdo');
    await press(view.getByText('重试加载规则'));
    expect(reloadContext).toHaveBeenCalledTimes(1);
    expect(mockStructuredProps.readOnly).toBe(false);
  });

  it.each(['linuxdo', 'nodeseek'] as const)(
    'keeps a pending %s WebView snapshot alive while concealing the old account draft during recovery',
    async (source) => {
      mockUseRealEditor = true;
      const draft = draftFor(source);
      const editorRef = createRef<StructuredReplyComposerHandle>();
      const view = await render(<Harness initialDraft={draft} overrides={{ editorRef }} />);
      const webView = view.getByTestId('structured-composer-webview');
      const postMessage = webView.props.postMessageMock;
      await fireEvent(webView, 'loadEnd');
      await fireEvent(webView, 'message', {
        nativeEvent: { data: JSON.stringify({ type: 'READY', payload: { revision: 0, documentEpoch: 0 } }) }
      });
      let pending: Promise<ComposerSnapshot>;
      await act(() => {
        pending = editorRef.current!.requestSnapshot();
      });
      const request = postMessage.mock.calls
        .map(([raw]: [string]) => JSON.parse(raw))
        .findLast((event: { type: string }) => event.type === 'REQUEST_SNAPSHOT');
      const nextSessions = {
        ...sessions,
        [source]: {
          ...sessions[source],
          currentUser: { ...sessions[source].currentUser!, id: '8', username: 'next-account' }
        }
      };
      await view.rerender(
        <Harness initialDraft={draft} sessionModels={nextSessions} overrides={{ loading: true, editorRef }} />
      );
      expect(view.queryByLabelText('帖子标题')).toBeNull();
      expect(view.getByTestId('draft-owner-overlay')).toBeTruthy();
      expect(
        view.getByTestId('structured-composer-webview', { includeHiddenElements: true }).props.postMessageMock
      ).toBe(postMessage);
      const latest = {
        revision: 1,
        markdown: '尚未自动保存的输入',
        mode: 'rich',
        isEmpty: false,
        validationIssues: [],
        pendingNodeSeekPolls: []
      };
      await fireEvent(webView, 'message', {
        nativeEvent: {
          data: JSON.stringify({
            type: 'SNAPSHOT',
            payload: { requestId: request.payload.requestId, documentEpoch: 0, snapshot: latest }
          })
        }
      });
      await expect(pending!).resolves.toEqual(latest);
      expect(
        postMessage.mock.calls
          .map(([raw]: [string]) => JSON.parse(raw))
          .filter((event: { type: string }) => event.type === 'INIT')
      ).toHaveLength(0);
    }
  );
  it.each(['account', 'source'] as const)(
    'offers recovery after a failed %s switch while keeping the old draft hidden',
    async (kind) => {
      const draft = draftFor('nodeseek');
      const retryDraft = jest.fn();
      const changedSessions = {
        ...sessions,
        nodeseek: { ...sessions.nodeseek, currentUser: { ...sessions.nodeseek.currentUser!, id: '8' } }
      };
      const view = await render(
        <Harness
          initialDraft={draft}
          sessionModels={kind === 'account' ? changedSessions : sessions}
          overrides={{
            source: kind === 'source' ? 'linuxdo' : 'nodeseek',
            loading: false,
            error: '草稿保存失败',
            retryDraft
          }}
        />
      );
      expect(view.getByTestId('draft-owner-overlay')).toBeTruthy();
      expect(view.queryByLabelText('帖子标题')).toBeNull();
      await press(view.getByLabelText('重试保存并恢复'));
      expect(retryDraft).toHaveBeenCalledTimes(1);
    }
  );
  it('shows revoked category and reading permissions before publication without changing the draft', async () => {
    const draft = draftFor('nodeseek');
    if (draft.source !== 'nodeseek') throw new Error('Unexpected fixture');
    draft.rank = 5;
    const view = await render(
      <Harness
        initialDraft={draft}
        overrides={{
          context: {
            source: 'nodeseek',
            categories: [{ id: '1', name: '日常交流', canCreate: false }],
            ranks: [0, 1],
            insideFee: 5
          }
        }}
      />
    );
    expect(view.getByText('请选择可发帖的版块')).toBeTruthy();
    expect(view.getByText('当前账号不能使用这个阅读权限')).toBeTruthy();
    expect(within(view.getByRole('button', { name: '帖子设置' })).getByText('Lv5')).toBeTruthy();
    await press(view.getByLabelText('日常交流'));
    expect(view.getByLabelText('选择版块 日常交流')).toBeDisabled();
    expect(JSON.parse(view.getByTestId('draft-state', { includeHiddenElements: true }).props.children).rank).toBe(5);
  });

  it('shows the current required tag group before publication', async () => {
    const context: TopicCreationContext = {
      ...linuxdoContext,
      categories: [
        { id: '1', name: '日常交流', requiredTagGroups: [{ name: '领域', minCount: 1, tagNames: ['技术'] }] }
      ]
    };
    const view = await render(
      <Harness
        initialDraft={draftFor('linuxdo')}
        overrides={{
          context,
          searchTags: async () => ({ tags: [{ id: 1, name: '技术' }], requiredGroup: { name: '领域', minCount: 1 } })
        }}
      />
    );
    expect(view.getByLabelText('选择标签').props.accessibilityHint).toBe('请从领域选择至少 1 个标签');
    expect(view.queryByText('请从领域选择至少 1 个标签')).toBeNull();
    await press(view.getByLabelText('选择标签'));
    await waitFor(() => expect(view.getByRole('checkbox', { name: '标签 技术' })).toBeTruthy());
    expect(view.getAllByText(/请从\s*领域\s*选择至少 1 个标签/)).toHaveLength(1);
    expect(view.getByText('请从领域选择至少 1 个标签')).toBeTruthy();
    expect(StyleSheet.flatten(view.getByText('请从领域选择至少 1 个标签').props.style).color).not.toBe(
      createTheme(createEmptyReaderData().settings).danger
    );
    await press(view.getByRole('checkbox', { name: '标签 技术' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(view.queryByText(/请从\s*领域\s*选择至少 1 个标签/)).toBeNull();
  });

  it('requires a category before searching tags and resumes after category selection', async () => {
    const draft = { ...draftFor('linuxdo'), categoryId: '' };
    const searchTags = jest.fn(async () => ({ tags: [{ id: 1, name: '技术' }] }));
    const changeCategory = jest.fn(async () => undefined);
    const view = await render(<Harness initialDraft={draft} overrides={{ searchTags, changeCategory }} />);

    await press(view.getByLabelText('选择标签'));
    expect(view.getByText('请先选择版块，再选择标签')).toBeTruthy();
    expect(view.queryByLabelText('搜索标签')).toBeNull();
    expect(view.queryByText('正在读取可用标签…')).toBeNull();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 350)));
    expect(searchTags).not.toHaveBeenCalled();
    expect(view.queryByText('标签读取失败，请重试')).toBeNull();

    await press(view.getByRole('button', { name: '先选择版块' }));
    await press(view.getByLabelText('选择版块 日常交流'));
    expect(changeCategory).toHaveBeenCalledWith('1');
    await view.rerender(
      <Harness initialDraft={draft} overrides={{ draft: { ...draft, categoryId: '1' }, searchTags }} />
    );
    await press(view.getByLabelText('选择标签'));
    await waitFor(() => expect(view.getByRole('checkbox', { name: '标签 技术' })).toBeTruthy());
    expect(searchTags).toHaveBeenCalledTimes(1);
  });

  it('searches categories by name or parent and clears the search without changing the draft', async () => {
    const changeCategory = jest.fn<Controller['changeCategory']>(async () => undefined);
    const view = await render(
      <Harness
        initialDraft={draftFor('linuxdo')}
        overrides={{
          changeCategory,
          context: {
            ...linuxdoContext,
            categories: [
              ...categories,
              { id: '2', name: '技术' },
              { id: '3', name: 'Dev', parentId: '2' },
              { id: '4', name: '受限', canCreate: false }
            ]
          }
        }}
      />
    );
    await press(view.getByLabelText('日常交流'));
    expect(view.getByRole('radio', { name: '选择版块 日常交流' })).toBeChecked();
    await fireEvent.changeText(view.getByLabelText('搜索版块'), '技术');
    expect(view.getByLabelText('选择版块 Dev')).toBeTruthy();
    expect(view.queryByLabelText('选择版块 日常交流')).toBeNull();
    await fireEvent.changeText(view.getByLabelText('搜索版块'), '不存在');
    expect(view.getByText('没有匹配的版块')).toBeTruthy();
    await press(view.getByLabelText('清空搜索'));
    expect(view.getByLabelText('搜索版块').props.value).toBe('');
    expect(view.getByLabelText('选择版块 受限')).toBeDisabled();
    await fireEvent.changeText(view.getByLabelText('搜索版块'), 'dev');
    await press(view.getByLabelText('选择版块 Dev'));
    expect(changeCategory).toHaveBeenCalledWith('3');
    expect(view.queryByLabelText('搜索版块')).toBeNull();
    expect(view.getByLabelText('帖子标题').props.value).toBe('草稿标题');
  });

  it('keeps selected tags removable at the limit and retains them when finishing the panel', async () => {
    const draft = draftFor('linuxdo');
    if (draft.source !== 'linuxdo') throw new Error('Unexpected fixture');
    draft.tags = [{ id: 1, name: '技术' }];
    const searchTags = jest.fn<Controller['searchTags']>(async () => ({
      tags: [
        { id: 1, name: '技术' },
        { id: 2, name: '交流' }
      ]
    }));
    const view = await render(
      <Harness initialDraft={draft} overrides={{ searchTags, context: { ...linuxdoContext, maxTags: 1 } }} />
    );
    await press(view.getByLabelText('标签 1'));
    await waitFor(() => expect(view.getByRole('checkbox', { name: '标签 技术' })).toBeChecked());
    expect(view.getByRole('checkbox', { name: '标签 交流' })).toBeDisabled();
    await press(view.getByLabelText('移除标签 技术'));
    await waitFor(() => expect(view.getByRole('checkbox', { name: '标签 交流' })).toBeEnabled());
    await press(view.getByRole('checkbox', { name: '标签 交流' }));
    expect(view.getByLabelText('移除标签 交流')).toBeTruthy();
    await press(view.getByRole('button', { name: '完成' }));
    expect(view.queryByLabelText('搜索标签')).toBeNull();
    expect(JSON.parse(view.getByTestId('draft-state', { includeHiddenElements: true }).props.children).tags).toEqual([
      { id: 2, name: '交流' }
    ]);
  });

  it('selects and removes tags locally without requesting or replacing candidates, including after reopen', async () => {
    const candidates = {
      tags: [
        { id: 1, name: '技术' },
        { id: 2, name: '交流' }
      ]
    };
    const searchTags = jest
      .fn<Controller['searchTags']>()
      .mockResolvedValueOnce(candidates)
      .mockResolvedValue({ tags: [] });
    const view = await render(<Harness initialDraft={draftFor('linuxdo')} overrides={{ searchTags }} />);
    await press(view.getByLabelText('选择标签'));
    expect(view.getByText('正在读取可用标签…')).toBeTruthy();
    await waitFor(() => expect(view.getByRole('checkbox', { name: '标签 技术' })).toBeTruthy());
    await press(view.getByRole('checkbox', { name: '标签 技术' }));
    expect(view.getByRole('checkbox', { name: '标签 技术' })).toBeChecked();
    expect(view.getByRole('checkbox', { name: '标签 交流' })).toBeEnabled();
    await press(view.getByRole('checkbox', { name: '标签 交流' }));
    expect(view.getByRole('checkbox', { name: '标签 交流' })).toBeChecked();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(searchTags).toHaveBeenCalledTimes(1);
    expect(view.getByRole('checkbox', { name: '标签 技术' })).toBeChecked();
    await press(view.getByLabelText('移除标签 技术'));
    expect(view.getByRole('checkbox', { name: '标签 技术' })).not.toBeChecked();
    await press(view.getByRole('button', { name: '完成' }));
    await press(view.getByLabelText('标签 1'));
    expect(view.getByRole('checkbox', { name: '标签 交流' })).toBeChecked();
    expect(view.queryByText('正在读取可用标签…')).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(searchTags).toHaveBeenCalledTimes(1);
  });

  it('shows loading at disabled category and tag controls, then enables them before optional emoji loading finishes', async () => {
    const draft = draftFor('linuxdo');
    const view = await render(<Harness initialDraft={draft} overrides={{ context: null, contextLoading: true }} />);
    expect(view.getByRole('button', { name: '正在加载版块' })).toBeDisabled();
    expect(view.getByRole('button', { name: '正在加载标签规则' })).toBeDisabled();
    expect(view.getByText('加载版块…')).toBeTruthy();
    expect(view.getByText('加载标签…')).toBeTruthy();
    expect(view.getByLabelText('帖子标题')).toBeEnabled();
    await view.rerender(<Harness initialDraft={draft} overrides={{ context: linuxdoContext, contextLoading: true }} />);
    expect(view.getByLabelText('日常交流')).toBeEnabled();
    expect(view.getByLabelText('选择标签')).toBeEnabled();
    expect(view.queryByText('正在读取原站发帖规则…')).toBeNull();
  });

  it('does not cancel or repeat an in-flight search when removing a selected tag', async () => {
    let resolveSearch!: (result: TopicTagSearchResult) => void;
    const draft = draftFor('linuxdo');
    if (draft.source !== 'linuxdo') throw new Error('Unexpected fixture');
    draft.tags = [{ id: 1, name: '技术' }];
    const searchTags = jest
      .fn<Controller['searchTags']>()
      .mockResolvedValueOnce({ tags: [{ id: 2, name: '交流' }] })
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSearch = resolve)));
    const view = await render(<Harness initialDraft={draft} overrides={{ searchTags }} />);
    await press(view.getByLabelText('标签 1'));
    await waitFor(() => expect(view.getByRole('checkbox', { name: '标签 交流' })).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('搜索标签'), '新标签');
    await waitFor(() => expect(searchTags).toHaveBeenCalledTimes(2));
    const signal = searchTags.mock.calls[1][1];
    await press(view.getByLabelText('移除标签 技术'));
    expect(signal?.aborted).toBe(false);
    await act(async () =>
      resolveSearch({ tags: [{ id: 3, name: '新候选' }], requiredGroup: { name: '旧规则', minCount: 1 } })
    );
    expect(view.getByRole('checkbox', { name: '标签 新候选' })).toBeTruthy();
    expect(view.queryByText(/旧规则/)).toBeNull();
    expect(view.queryByLabelText('创建标签“新标签”')).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(searchTags).toHaveBeenCalledTimes(2);
  });

  it.each(['closed', 'inactive'] as const)(
    'cancels a %s tag panel search and never reuses candidates across categories',
    async (hidden) => {
      let resolveOld!: (result: TopicTagSearchResult) => void;
      const searchTags = jest
        .fn<Controller['searchTags']>()
        .mockResolvedValueOnce({ tags: [{ name: '原版块候选' }] })
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveOld = resolve;
            })
        )
        .mockResolvedValue({ tags: [{ name: '新版块候选' }] });
      const initialDraft = draftFor('linuxdo');
      const view = await render(<Harness initialDraft={initialDraft} overrides={{ searchTags }} />);
      await press(view.getByLabelText('选择标签'));
      await waitFor(() => expect(view.getByLabelText('标签 原版块候选')).toBeTruthy());
      await view.rerender(
        <Harness initialDraft={initialDraft} overrides={{ searchTags, draft: { ...initialDraft, categoryId: '2' } }} />
      );
      expect(view.queryByLabelText('标签 原版块候选')).toBeNull();
      await waitFor(() => expect(searchTags).toHaveBeenCalledTimes(2));
      const signal = searchTags.mock.calls[1][1];
      if (hidden === 'closed') await press(view.getByRole('button', { name: '完成' }));
      else
        await view.rerender(
          <Harness
            active={false}
            initialDraft={initialDraft}
            overrides={{ searchTags, draft: { ...initialDraft, categoryId: '2' } }}
          />
        );
      expect(signal?.aborted).toBe(true);
      await act(async () => resolveOld({ tags: [{ name: '取消的候选' }] }));
      if (hidden === 'closed') await press(view.getByLabelText('选择标签'));
      else
        await view.rerender(
          <Harness
            initialDraft={initialDraft}
            overrides={{ searchTags, draft: { ...initialDraft, categoryId: '2' } }}
          />
        );
      expect(view.queryByLabelText('标签 取消的候选')).toBeNull();
      await waitFor(() => expect(view.getByLabelText('标签 新版块候选')).toBeTruthy());
    }
  );

  it('ignores late tag results after query changes and retries a failed search', async () => {
    let resolveOld: ((result: TopicTagSearchResult) => void) | undefined;
    const searchTags = jest.fn<Controller['searchTags']>(async (query) => {
      if (query === 'old')
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      throw new Error('标签连接暂时不可用');
    });
    const view = await render(<Harness initialDraft={draftFor('linuxdo')} overrides={{ searchTags }} />);
    await press(view.getByLabelText('选择标签'));
    await fireEvent.changeText(view.getByLabelText('搜索标签'), 'old');
    await waitFor(() => expect(resolveOld).toBeDefined());
    await fireEvent.changeText(view.getByLabelText('搜索标签'), 'new');
    await waitFor(() => expect(view.getByRole('button', { name: '重试读取标签' })).toBeTruthy());
    expect(view.getByText('标签连接暂时不可用')).toBeTruthy();
    await act(async () => resolveOld!({ tags: [{ name: '旧结果' }] }));
    expect(view.queryByLabelText('标签 旧结果')).toBeNull();
    searchTags.mockResolvedValue({ tags: [{ name: '新结果' }] });
    await press(view.getByRole('button', { name: '重试读取标签' }));
    await waitFor(() => expect(view.getByRole('checkbox', { name: '标签 新结果' })).toBeTruthy());
    expect(view.getByLabelText('搜索标签').props.value).toBe('new');
  });

  it('reserves missing-category errors for submission but reports revoked selections immediately', async () => {
    const draft = { ...draftFor('linuxdo'), categoryId: '' };
    const view = await render(<Harness initialDraft={draft} />);
    expect(view.getByLabelText('选择版块')).toBeTruthy();
    expect(view.queryByText('请选择可发帖的版块')).toBeNull();
    await view.rerender(<Harness initialDraft={draft} overrides={{ errors: { categoryId: '请选择可发帖的版块' } }} />);
    expect(view.getAllByText('请选择可发帖的版块').length).toBeGreaterThan(0);
    const selected = draftFor('linuxdo');
    await view.unmount();
    const revoked = await render(
      <Harness initialDraft={selected} overrides={{ context: { ...linuxdoContext, categories: [] } }} />
    );
    expect(revoked.getByText('请选择可发帖的版块')).toBeTruthy();
  });

  it('keeps local file descriptions editable and routes file selection to the original posting type', async () => {
    const draft = draftFor('yaohuo');
    if (draft.source !== 'yaohuo') throw new Error('Unexpected fixture');
    draft.kind = 'files';
    draft.attachments = [
      {
        id: 'local-file',
        uri: 'file:///draft/a.txt',
        name: 'a.txt',
        size: 90,
        mimeType: 'text/plain',
        kind: 'yaohuo-file',
        status: 'queued',
        description: ''
      }
    ];
    const pickAttachments = jest.fn<Controller['pickAttachments']>(async () => undefined);
    const view = await render(<Harness initialDraft={draft} overrides={{ pickAttachments }} />);
    await openTopicMore(view);
    await press(view.getByLabelText('文件 1'));
    expect(view.getByText(/^随帖文件 · .* · 发布时上传$/)).toBeTruthy();
    expect(view.queryByLabelText('a.txt 文件说明')).toBeNull();
    await press(view.getByLabelText('添加说明 a.txt'));
    await fireEvent.changeText(view.getByLabelText('a.txt 文件说明'), '本地文件介绍');
    await press(view.getByLabelText('收起说明 a.txt'));
    expect(view.queryByLabelText('a.txt 文件说明')).toBeNull();
    expect(view.getByText('本地文件介绍')).toBeTruthy();
    await press(view.getByLabelText('编辑说明 a.txt'));
    expect(view.getByLabelText('a.txt 文件说明').props.value).toBe('本地文件介绍');
    await press(view.getByLabelText('选择本地文件'));
    expect(pickAttachments).toHaveBeenCalledWith('yaohuo-file');
    expect(
      JSON.parse(view.getByTestId('draft-state', { includeHiddenElements: true }).props.children).attachments[0]
        .description
    ).toBe('本地文件介绍');
  });

  it('keeps routine saving feedback in the header and exposes save failures with retry', async () => {
    const draft = draftFor('nodeseek');
    const flush = jest.fn<Controller['flush']>(async () => draft);
    const view = await render(<Harness initialDraft={draft} overrides={{ flush }} />);
    expect(view.getByText(/已保存/)).toBeTruthy();
    expect(view.queryByText('已保存')).toBeNull();
    await view.rerender(<Harness initialDraft={draft} overrides={{ flush, saveStatus: '保存失败：磁盘不可写' }} />);
    await act(() => mockStructuredProps.onPanelChange?.(true));
    expect(view.queryByLabelText('帖子标题')).toBeNull();
    expect(view.getByLabelText('查看标题与标签')).toBeTruthy();
    expect(view.getByText('保存失败：磁盘不可写')).toBeTruthy();
    await press(view.getByLabelText('重试保存草稿'));
    expect(flush).toHaveBeenCalledTimes(1);
    expect(view.getByLabelText('帖子标题', { includeHiddenElements: true }).props.value).toBe('草稿标题');
  });
  it('edits each Yaohuo special type without losing the other type fields', async () => {
    const view = await render(<Harness />);
    await press(view.getByLabelText('帖子设置'));
    await fireEvent.changeText(view.getByLabelText('悬赏妖晶（选填，至少 1000）'), '1200');
    await press(view.getByRole('radio', { name: '派币' }));
    await fireEvent.changeText(view.getByLabelText('派币总额（至少 2000）'), '4000');
    await fireEvent.changeText(view.getByLabelText('每人妖晶（200–10000）'), '200');
    await press(view.getByRole('radio', { name: '投票' }));
    await fireEvent.changeText(view.getByLabelText('投票选项 1（最多 15 字）'), '选项甲');
    await fireEvent(view.getByLabelText('投票派币'), 'valueChange', true);
    await fireEvent.changeText(view.getByLabelText('投票派币总额（至少 2000）'), '6000');
    await fireEvent.changeText(view.getByLabelText('投票每人妖晶（200–10000）'), '300');
    await press(view.getByRole('radio', { name: '外站资源' }));
    for (const [label, value] of [
      ['名称', '资源一'],
      ['链接', 'https://example.com/a'],
      ['大小（选填）', '2MB'],
      ['后缀（选填）', 'zip'],
      ['说明（选填）', '说明']
    ]) {
      await fireEvent.changeText(view.getByLabelText(`资源 1 ${label}`), value);
    }
    const state = JSON.parse(view.getByTestId('draft-state', { includeHiddenElements: true }).props.children);
    expect(state).toMatchObject({
      reward: '1200',
      gift: { total: '4000', perPerson: '200' },
      poll: { options: ['选项甲', '', ''], giftEnabled: true, total: '6000', perPerson: '300' },
      resources: [{ title: '资源一', url: 'https://example.com/a', size: '2MB', extension: 'zip', description: '说明' }]
    });
    await press(view.getByLabelText('关闭发帖选项'));
    expect(within(view.getByRole('button', { name: '帖子设置' })).getByText('外站资源')).toBeTruthy();
  });

  it('locks title, body and special settings during publication', async () => {
    const initialDraft = draftFor('yaohuo');
    const view = await render(<Harness initialDraft={initialDraft} />);
    await press(view.getByLabelText('帖子设置'));
    await view.rerender(<Harness initialDraft={initialDraft} overrides={{ busy: true }} />);
    expect(view.getByLabelText('悬赏妖晶（选填，至少 1000）').props.editable).toBe(false);
    expect(view.getByRole('radio', { name: '派币' })).toBeDisabled();
    expect(view.getByLabelText('帖子标题', { includeHiddenElements: true }).props.editable).toBe(false);
    expect(view.getByLabelText('帖子正文', { includeHiddenElements: true }).props.editable).toBe(false);
    expect(view.getByLabelText('发布', { includeHiddenElements: true })).toBeDisabled();
  });

  it('keeps editing enabled during uploads, restores preview afterward and locks the editor during publication', async () => {
    const draft = draftFor('linuxdo');
    const view = await render(<Harness initialDraft={draft} overrides={{ uploading: true }} />);
    expect(view.getByLabelText('预览')).toBeDisabled();
    await press(view.getByLabelText('预览'));
    expect(mockStructuredProps.readOnly).toBe(false);
    await view.rerender(<Harness initialDraft={draft} />);
    expect(view.getByLabelText('预览')).toBeEnabled();
    expect(mockStructuredProps.readOnly).toBe(false);
    await press(view.getByLabelText('预览'));
    expect(mockStructuredProps.readOnly).toBe(true);
    expect(mockStructuredProps.initialMode).toBe(draft.mode);
    await press(view.getByLabelText('继续编辑'));
    expect(mockStructuredProps.readOnly).toBe(false);
    await view.rerender(<Harness initialDraft={draft} overrides={{ busy: true }} />);
    expect(mockStructuredProps.readOnly).toBe(true);
    expect(view.getByLabelText('预览')).toBeDisabled();
  });

  it('returns from preview to editing before the file picker can start', async () => {
    const pickAttachments = jest.fn<Controller['pickAttachments']>(async () => {
      expect(mockStructuredProps.readOnly).toBe(false);
    });
    const view = await render(<Harness initialDraft={draftFor('linuxdo')} overrides={{ pickAttachments }} />);
    await press(view.getByLabelText('预览'));
    expect(mockStructuredProps.readOnly).toBe(true);
    await openTopicMore(view);
    await press(view.getByLabelText('附件'));
    expect(mockStructuredProps.readOnly).toBe(false);
    expect(view.getByLabelText('选择附件')).toBeEnabled();
    await press(view.getByLabelText('选择附件'));
    expect(pickAttachments).toHaveBeenCalledWith('attachment');
  });

  it('waits for the attachment window native completion despite an earlier keyboardDidHide event', async () => {
    const platform = jest.replaceProperty(ReactNative.Platform, 'OS', 'android');
    const native = require('react-native') as typeof import('react-native');
    const handle = jest.spyOn(native, 'findNodeHandle').mockReturnValue(73);
    const command = jest
      .spyOn(ReactNative.UIManager, 'dispatchViewManagerCommand')
      .mockImplementation(() => undefined)
      .mockClear();
    const pickAttachments = jest.fn<Controller['pickAttachments']>(async () => undefined);
    try {
      const view = await render(<Harness initialDraft={draftFor('linuxdo')} overrides={{ pickAttachments }} />);
      const begin = async (label: string) => {
        const done = fireEvent.press(view.getByLabelText(label));
        // Let fireEvent's act finish, then supply the native completion before
        // awaiting the handler's pending handoff.
        await new Promise<void>((resolve) => setImmediate(resolve));
        return { done };
      };
      const more = await begin('附件与草稿');
      expect(command).toHaveBeenLastCalledWith(73, 'hideKeyboard', [1]);
      const complete = async (testID: string, requestId: number) => {
        await fireEvent(view.getByTestId(testID), 'keyboardHidden', { nativeEvent: { requestId, success: true } });
        await act(async () => {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        });
      };
      await complete('topic-keyboard-host', 1);
      await more.done;
      const attachments = await begin('附件');
      expect(command).toHaveBeenLastCalledWith(73, 'hideKeyboard', [1]);
      await complete('composer-modal-keyboard-host', 1);
      await attachments.done;
      const selection = await begin('选择附件');
      expect(command).toHaveBeenLastCalledWith(73, 'hideKeyboard', [2]);
      expect(pickAttachments).not.toHaveBeenCalled();
      const modalHost = view.getByTestId('composer-modal-keyboard-host');
      await act(() => ReactNative.DeviceEventEmitter.emit('keyboardDidHide', {}));
      expect(view.getByTestId('composer-modal-keyboard-host')).toBe(modalHost);
      expect(pickAttachments).not.toHaveBeenCalled();
      expect(command).not.toHaveBeenCalledWith(73, 'cancelHide', [2]);
      await complete('composer-modal-keyboard-host', 2);
      await selection.done;
      expect(pickAttachments).toHaveBeenCalledTimes(1);
      expect(pickAttachments).toHaveBeenCalledWith('attachment');
      await view.unmount();
    } finally {
      platform.restore();
      handle.mockRestore();
      command.mockRestore();
    }
  });

  it('does not open an old draft panel after its keyboard handoff completes', async () => {
    const original = draftFor('linuxdo');
    const replacement = { ...original, id: `${original.id}-replacement` };
    const view = await render(<Harness initialDraft={original} />);
    const frames: FrameRequestCallback[] = [];
    const frame = jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    try {
      let opening!: Promise<void>;
      await act(async () => {
        opening = fireEvent.press(view.getByLabelText('附件与草稿'));
      });
      expect(frames.length).toBeGreaterThan(0);
      await view.rerender(<Harness initialDraft={original} overrides={{ draft: replacement }} />);
      await act(async () => {
        frames.splice(0).forEach((callback) => callback(0));
        await opening;
      });
      expect(view.queryByLabelText('关闭发帖选项')).toBeNull();
      expect(view.queryByRole('alert')).toBeNull();
    } finally {
      frame.mockRestore();
      await view.unmount();
    }
  });

  it('waits for the current tag search and respects both forbidden fields', async () => {
    let resolveSearch: ((result: TopicTagSearchResult) => void) | undefined;
    const searchTags = jest.fn<Controller['searchTags']>(
      () =>
        new Promise((resolve) => {
          resolveSearch = resolve;
        })
    );
    const view = await render(<Harness initialDraft={draftFor('linuxdo')} overrides={{ searchTags }} />);
    await press(view.getByLabelText('选择标签'));
    await fireEvent.changeText(view.getByLabelText('搜索标签'), 'blocked');
    expect(view.queryByLabelText('创建标签“blocked”')).toBeNull();
    await waitFor(() => expect(searchTags).toHaveBeenCalledWith('blocked', expect.any(AbortSignal)));
    await act(async () => resolveSearch!({ tags: [], forbidden: 'blocked', forbiddenMessage: '原站禁止创建此标签' }));
    expect(view.getByText('原站禁止创建此标签')).toBeTruthy();
    expect(view.queryByLabelText('创建标签“blocked”')).toBeNull();
    await fireEvent.changeText(view.getByLabelText('搜索标签'), 'allowed');
    await waitFor(() => expect(searchTags).toHaveBeenCalledWith('allowed', expect.any(AbortSignal)));
    await act(async () => resolveSearch!({ tags: [] }));
    await press(view.getByLabelText('创建标签“allowed”'));
    expect(view.getByLabelText('移除标签 allowed')).toBeTruthy();
  });

  it('opens the failing field panel and retains its file on insertion failure', async () => {
    const initialDraft = draftFor('linuxdo');
    initialDraft.attachments = [
      {
        id: 'a',
        uri: 'file:///draft/a.pdf',
        name: 'a.pdf',
        size: 100,
        mimeType: 'application/pdf',
        kind: 'attachment',
        status: 'uploaded',
        description: '',
        markup: '[a](https://example.com/a)'
      }
    ];
    const removeAttachment = jest.fn<Controller['removeAttachment']>(async () => undefined);
    const insertMarkup = jest.fn<Controller['insertMarkup']>(async () => {
      throw new Error('编辑器尚未就绪');
    });
    const view = await render(
      <Harness
        initialDraft={initialDraft}
        overrides={{ errors: { attachments: '请核对附件' }, insertMarkup, removeAttachment }}
      />
    );
    expect(view.getByText('附件')).toBeTruthy();
    expect(view.getByText('请核对附件')).toBeTruthy();
    await press(view.getByLabelText('插入正文 a.pdf'));
    await waitFor(() => expect(view.getByText('编辑器尚未就绪')).toBeTruthy());
    expect(view.getByText('a.pdf')).toBeTruthy();
    await press(view.getByLabelText('移出草稿 a.pdf'));
    expect(removeAttachment).toHaveBeenCalledWith(initialDraft.attachments[0]);
  });

  it('shows source, account and draft state and leaves unavailable publishing disabled', async () => {
    const switchSource = jest.fn<Controller['switchSource']>(async () => undefined);
    const view = await render(
      <Harness
        initialDraft={draftFor('nodeseek')}
        overrides={{ context: null, draftSites: { yaohuo: true }, switchSource }}
      />
    );
    expect(view.getByText(/nodeseek-writer/)).toBeTruthy();
    expect(view.getByLabelText('发布')).toBeDisabled();
    await press(view.getByLabelText('切换发帖网站'));
    expect(view.getByText('妖火 · 有草稿')).toBeTruthy();
    await press(view.getByLabelText('选择 妖火'));
    expect(switchSource).toHaveBeenCalledWith('yaohuo');
  });

  it('allows switching away from a disabled source while its retained draft remains hidden', async () => {
    const switchSource = jest.fn<Controller['switchSource']>(async () => undefined);
    const view = await render(
      <Harness initialDraft={draftFor('nodeseek')} overrides={{ enabled: false, switchSource }} />
    );
    expect(view.queryByLabelText('帖子标题')).toBeNull();
    await press(view.getByLabelText('切换发帖网站'));
    await press(view.getByLabelText('选择 妖火'));
    expect(switchSource).toHaveBeenCalledWith('yaohuo');
  });

  it('keeps the metadata scrollable and field text scalable at large font sizes', async () => {
    const settings = { ...createEmptyReaderData().settings, fontScale: 1.5 };
    const view = await render(
      <ReaderStyleProvider value={{ settings, theme: createTheme(settings) }}>
        <Harness />
      </ReaderStyleProvider>
    );
    expect(StyleSheet.flatten(view.getByLabelText('帖子标题').props.style).fontSize).toBe(33);
    expect(view.queryByLabelText('预览')).toBeNull();
    await press(view.getByLabelText('帖子设置'));
    expect(StyleSheet.flatten(view.getByLabelText('悬赏妖晶（选填，至少 1000）').props.style).fontSize).toBe(21);
  });
});
