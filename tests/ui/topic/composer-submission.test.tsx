import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor } from '../render';
import { QueryTestWrapper } from '../QueryTestWrapper';
import { appQueryClient } from '@/platform/query/serverState';
import {
  COMPOSER_DRAFT,
  createComposerTransport,
  TopicSubmissionFixture,
  type ComposerTransport
} from '../composerSubmissionFixture';
import type { SessionSite } from '@/domain/session/siteSessionState';
import { MessageSubmissionFixture } from '../composerMessageFixture';

jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated'),
  useAnimatedKeyboard: () => ({ height: { value: 0 } }),
  useAnimatedReaction: () => {}
}));
// This owner tests the production submission wiring, not native sheet geometry.
jest.mock('@gorhom/bottom-sheet', () => {
  const ReactModule = require('react') as typeof React;
  const { View, TextInput } = require('react-native');
  return {
    __esModule: true,
    default: ReactModule.forwardRef(function Sheet(
      props: { children: React.ReactNode; index: number; onChange: (index: number) => void; onClose: () => void },
      ref
    ) {
      ReactModule.useImperativeHandle(ref, () => ({ close: props.onClose }));
      ReactModule.useEffect(() => {
        if (props.index === 0) props.onChange(0);
      }, [props.index, props.onChange]);
      return ReactModule.createElement(
        View,
        { testID: 'submission-sheet', accessibilityState: { expanded: props.index === 0 } },
        props.children
      );
    }),
    BottomSheetView: View,
    BottomSheetTextInput: TextInput,
    useBottomSheetInternal: () => ({
      animatedIndex: { get: () => -1 },
      animatedAnimationState: { get: () => ({ nextIndex: undefined }) },
      animatedLayoutState: { modify: () => {}, get: () => ({ rawContainerHeight: 800, containerHeight: 800 }) }
    })
  };
});
jest.mock('@/platform/network/managedCookies', () => ({
  readManagedCookieHeader: async () => ({ status: 'ok', header: 'sidyaohuo=synthetic' })
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual<typeof import('react-native-safe-area-context')>('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
  useSafeAreaFrame: () => ({ x: 0, y: 0, width: 360, height: 800 })
}));

type Rendered = Awaited<ReturnType<typeof render>>;
function messages(view: Rendered) {
  return view
    .getByTestId('structured-composer-webview')
    .props.postMessageMock.mock.calls.map(([raw]: [string]) => JSON.parse(raw));
}
async function bridge(view: Rendered, type: string, payload: unknown) {
  const documentEpoch = messages(view).findLast((message: { type: string }) => message.type === 'INIT')?.payload
    .documentEpoch;
  await fireEvent(view.getByTestId('structured-composer-webview'), 'message', {
    nativeEvent: { data: JSON.stringify({ type, payload: { documentEpoch, ...(payload as object) } }) }
  });
}
async function ready(view: Rendered) {
  await fireEvent(view.getByTestId('structured-composer-webview'), 'loadEnd');
  await waitFor(() => expect(messages(view).some((message: { type: string }) => message.type === 'INIT')).toBe(true));
  await bridge(view, 'READY', { revision: 0 });
}
async function submit(
  view: Rendered,
  markdown = COMPOSER_DRAFT,
  label = '发送回复',
  revision = 1,
  validationIssues: { code: string; message: string }[] = []
) {
  await fireEvent.press(view.getByLabelText(label));
  const request = messages(view).findLast((message: { type: string }) => message.type === 'REQUEST_SNAPSHOT');
  expect(request).toBeDefined();
  await bridge(view, 'SNAPSHOT', {
    requestId: request.payload.requestId,
    snapshot: {
      revision,
      markdown,
      mode: 'rich',
      isEmpty: !markdown.trim(),
      validationIssues,
      pendingNodeSeekPolls: []
    }
  });
}
function state(view: Rendered) {
  return JSON.parse(view.getByTestId('composer-proof-state').props.children);
}

describe('composer submission through the production controller and sheet', () => {
  const transports: ComposerTransport[] = [];
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });
  afterEach(async () => {
    await act(async () => transports.splice(0).forEach((transport) => transport.dispose()));
  });
  async function open(
    source: SessionSite = 'nodeseek',
    outcome: Parameters<typeof createComposerTransport>[0] = 'success',
    hold = false,
    entry: 'reply' | 'floor' | 'edit' = 'reply'
  ) {
    const transport = createComposerTransport(outcome, hold);
    transports.push(transport);
    const view = await render(<TopicSubmissionFixture source={source} entry={entry} transport={transport} />, {
      wrapper: QueryTestWrapper
    });
    await fireEvent.press(view.getByText('填入测试草稿'));
    await fireEvent.press(view.getByText('打开测试回复'));
    if (source !== 'yaohuo') await ready(view);
    return { view, transport };
  }
  it.each(['nodeseek', 'linuxdo'] as const)(
    '%s confirms through HTTP, clears the document and reopens empty',
    async (source) => {
      const { view, transport } = await open(source);
      await submit(view);
      await waitFor(() => expect(state(view)).toEqual({ visible: false, content: '', busy: false }));
      expect(transport.requests).toHaveLength(1);
      expect(transport.confirmations).toBe(1);
      await waitFor(() =>
        expect(messages(view).findLast((message: { type: string }) => message.type === 'INIT').payload.markdown).toBe(
          ''
        )
      );
      await fireEvent.press(view.getByText('打开测试回复'));
      expect(state(view).content).toBe('');
      expect(state(view).visible).toBe(true);
    }
  );
  it.each(['nodeseek', 'linuxdo'] as const)(
    '%s keeps a pending submission busy and sends only once on repeated presses',
    async (source) => {
      const { view, transport } = await open(source, 'success', true);
      await submit(view);
      await waitFor(() => expect(state(view).busy).toBe(true));
      await fireEvent.press(view.getByLabelText('发送回复'));
      expect(transport.requests).toHaveLength(1);
      expect(state(view).content).toBe(COMPOSER_DRAFT);
      await act(async () => transport.release());
      await waitFor(() => expect(state(view)).toEqual({ visible: false, content: '', busy: false }));
    }
  );
  it.each(
    (['nodeseek', 'linuxdo', 'yaohuo'] as const).flatMap((source) =>
      (['network-error', 'rejected', 'unconfirmed'] as const).map((outcome) => ({ source, outcome }))
    )
  )('$source retains the draft after $outcome and permits an explicit retry', async ({ source, outcome }) => {
    const { view, transport } = await open(source, outcome);
    if (source === 'yaohuo') await fireEvent.press(view.getByLabelText('发送回复'));
    else await submit(view);
    await waitFor(() => expect(view.getByTestId('composer-proof-notice').props.children).not.toBe(''));
    expect(state(view)).toEqual({ visible: true, content: COMPOSER_DRAFT, busy: false });
    expect(transport.requests).toHaveLength(1);
    transport.outcome = 'success';
    if (source === 'yaohuo') await fireEvent.press(view.getByLabelText('发送回复'));
    else await submit(view);
    await waitFor(() => expect(state(view).visible).toBe(false));
    expect(transport.requests).toHaveLength(2);
  });
  it('settles a confirmed reply even if the subsequent refresh fails', async () => {
    const { view, transport } = await open('nodeseek', 'refresh-error');
    await submit(view);
    await waitFor(() => expect(state(view)).toEqual({ visible: false, content: '', busy: false }));
    expect(view.getByTestId('composer-proof-notice').props.children).toContain('勿重复发送');
    expect(transport.requests).toHaveLength(1);
  });
  it.each(
    (['nodeseek', 'linuxdo'] as const).flatMap((source) =>
      (['floor', 'edit'] as const).map((entry) => ({ source, entry }))
    )
  )('settles the $source $entry entry through its real controller', async ({ source, entry }) => {
    const { view, transport } = await open(source, 'success', false, entry);
    await submit(view, COMPOSER_DRAFT, entry === 'edit' ? '保存编辑' : '发送回复');
    await waitFor(() => expect(state(view)).toEqual({ visible: false, content: '', busy: false }));
    expect(transport.requests).toHaveLength(1);
  });
  it('settles the native Yaohuo editor after the real HTML parser confirms the response', async () => {
    const { view, transport } = await open('yaohuo');
    await fireEvent.press(view.getByLabelText('发送回复'));
    await waitFor(() => expect(state(view)).toEqual({ visible: false, content: '', busy: false }));
    expect(transport.requests).toHaveLength(1);
  });
  it('does not restore a submitted draft from a late bridge snapshot', async () => {
    const { view, transport } = await open();
    const documentEpoch = messages(view).findLast((message: { type: string }) => message.type === 'INIT').payload
      .documentEpoch;
    await submit(view);
    await waitFor(() => expect(state(view).visible).toBe(false));
    await bridge(view, 'SNAPSHOT', {
      documentEpoch,
      snapshot: {
        revision: 2,
        markdown: COMPOSER_DRAFT,
        mode: 'rich',
        isEmpty: false,
        validationIssues: [],
        pendingNodeSeekPolls: []
      }
    });
    expect(state(view).content).toBe('');
    await bridge(view, 'READY', { revision: 0 });
    await fireEvent.press(view.getByText('打开测试回复'));
    await bridge(view, 'SNAPSHOT', {
      documentEpoch,
      snapshot: {
        revision: 3,
        markdown: COMPOSER_DRAFT,
        mode: 'rich',
        isEmpty: false,
        validationIssues: [],
        pendingNodeSeekPolls: []
      }
    });
    expect(state(view).content).toBe('');
    expect(transport.requests).toHaveLength(1);
  });
  it('rejects an expired snapshot without sending and accepts a fresh retry', async () => {
    const { view, transport } = await open();
    await bridge(view, 'STATE_CHANGED', { revision: 2, mode: 'rich', isEmpty: false, canUndo: true, canRedo: false });
    await submit(view);
    expect(view.getByText('编辑器返回了过期正文，请重试')).toBeTruthy();
    expect(transport.requests).toHaveLength(0);
    expect(state(view).content).toBe(COMPOSER_DRAFT);
    await submit(view, COMPOSER_DRAFT, '发送回复', 3);
    await waitFor(() => expect(state(view).visible).toBe(false));
    expect(transport.requests).toHaveLength(1);
  });
  it('preserves an unsent document across a manual close and reopen', async () => {
    const { view, transport } = await open();
    await submit(view, COMPOSER_DRAFT, '收起回复');
    await waitFor(() => expect(state(view).visible).toBe(false));
    expect(state(view).content).toBe(COMPOSER_DRAFT);
    await fireEvent.press(view.getByText('打开测试回复'));
    expect(state(view).content).toBe(COMPOSER_DRAFT);
    expect(transport.requests).toHaveLength(0);
  });
  it('hides the root-portal composer while its route is inactive and restores the same draft on return', async () => {
    const { view, transport } = await open();
    const webView = view.getByTestId('structured-composer-webview');
    await view.rerender(<TopicSubmissionFixture transport={transport} active={false} />);
    expect(view.getByTestId('submission-sheet').props.accessibilityState.expanded).toBe(false);
    expect(state(view)).toMatchObject({ visible: true, content: COMPOSER_DRAFT });
    const request = messages(view).findLast((message: { type: string }) => message.type === 'REQUEST_SNAPSHOT');
    await bridge(view, 'SNAPSHOT', {
      requestId: request.payload.requestId,
      snapshot: {
        revision: 2,
        markdown: 'draft before navigation',
        mode: 'rich',
        isEmpty: false,
        validationIssues: [],
        pendingNodeSeekPolls: []
      }
    });
    await view.rerender(<TopicSubmissionFixture transport={transport} />);
    expect(view.getByTestId('submission-sheet').props.accessibilityState.expanded).toBe(true);
    expect(view.getByTestId('structured-composer-webview')).toBe(webView);
    expect(state(view).content).toBe('draft before navigation');
    expect(transport.requests).toHaveLength(0);
  });
  it('does not send empty or invalid snapshots', async () => {
    const { view, transport } = await open();
    await submit(view, '');
    expect(transport.requests).toHaveLength(0);
    expect(state(view).visible).toBe(true);
    await bridge(view, 'READY', { revision: 0 });
    await bridge(view, 'SNAPSHOT', {
      snapshot: {
        revision: 1,
        markdown: COMPOSER_DRAFT,
        mode: 'rich',
        isEmpty: false,
        validationIssues: [],
        pendingNodeSeekPolls: []
      }
    });
    await submit(view, COMPOSER_DRAFT, '发送回复', 2, [{ code: 'markdown-invalid', message: 'Mock invalid document' }]);
    expect(view.getByText('Mock invalid document')).toBeTruthy();
    expect(transport.requests).toHaveLength(0);
  });
  it('ignores a confirmation after the account epoch changes', async () => {
    const { view, transport } = await open('nodeseek', 'success', true);
    await submit(view);
    await waitFor(() => expect(transport.requests).toHaveLength(1));
    await view.rerender(<TopicSubmissionFixture transport={transport} epoch={1} />);
    await act(async () => transport.release());
    await waitFor(() => expect(state(view).busy).toBe(false));
    expect(state(view)).toEqual({ visible: true, content: COMPOSER_DRAFT, busy: false });
  });
  it.each(['reply', 'edit'] as const)('does not settle a newer session after an old %s confirmation', async (entry) => {
    const { view, transport } = await open('nodeseek', 'success', true, entry);
    await submit(view, COMPOSER_DRAFT, entry === 'edit' ? '保存编辑' : '发送回复');
    await waitFor(() => expect(transport.requests).toHaveLength(1));
    await submit(view, COMPOSER_DRAFT, entry === 'edit' ? '取消编辑' : '收起回复', 2);
    await waitFor(() => expect(state(view).visible).toBe(false));
    await fireEvent.press(view.getByText('打开空白回复'));
    await ready(view);
    await bridge(view, 'SNAPSHOT', {
      snapshot: {
        revision: 3,
        markdown: 'new draft',
        mode: 'rich',
        isEmpty: false,
        validationIssues: [],
        pendingNodeSeekPolls: []
      }
    });
    await act(async () => transport.release());
    await waitFor(() => expect(state(view).busy).toBe(false));
    expect(state(view)).toEqual({ visible: true, content: 'new draft', busy: false });
    expect(transport.requests).toHaveLength(1);
  });
  it('settles the original draft after leaving its route without reopening the composer', async () => {
    const { view, transport } = await open('nodeseek', 'success', true);
    await submit(view);
    await waitFor(() => expect(transport.requests).toHaveLength(1));
    await view.rerender(<TopicSubmissionFixture transport={transport} active={false} />);
    await act(async () => transport.release());
    await waitFor(() => expect(state(view).busy).toBe(false));
    expect(state(view).content).toBe('');
    expect(state(view).visible).toBe(false);
  });
  it('keeps the same WebView and draft across presentation and mode changes', async () => {
    const { view } = await open();
    const postMessage = view.getByTestId('structured-composer-webview').props.postMessageMock;
    await fireEvent.press(view.getByLabelText('全屏'));
    await fireEvent.press(view.getByLabelText('源码'));
    await bridge(view, 'STATE_CHANGED', { revision: 1, mode: 'source', isEmpty: false, canUndo: true, canRedo: false });
    await fireEvent.press(view.getByLabelText('退出全屏'));
    expect(view.getByTestId('structured-composer-webview').props.postMessageMock).toBe(postMessage);
    expect(state(view).content).toBe(COMPOSER_DRAFT);
  });
  it.each(
    (['nodeseek', 'linuxdo', 'yaohuo'] as const).flatMap((source) =>
      (['success', 'refresh-error'] as const).map((outcome) => ({ source, outcome }))
    )
  )('$source private message settles once after confirmation with $outcome', async ({ source, outcome }) => {
    const transport = createComposerTransport(outcome, true);
    transports.push(transport);
    const view = await render(<MessageSubmissionFixture source={source} transport={transport} />, {
      wrapper: QueryTestWrapper
    });
    const launcher = source === 'nodeseek' ? '发私信' : '回复私信';
    await waitFor(() => expect(view.getByLabelText(launcher)).toBeTruthy());
    await fireEvent.press(view.getByLabelText(launcher));
    if (source === 'yaohuo') {
      await fireEvent.changeText(view.getByLabelText('私信回复内容'), COMPOSER_DRAFT);
      await fireEvent.press(view.getByLabelText('发送回复'));
    } else {
      await ready(view);
      await bridge(view, 'SNAPSHOT', {
        snapshot: {
          revision: 1,
          markdown: COMPOSER_DRAFT,
          mode: 'rich',
          isEmpty: false,
          validationIssues: [],
          pendingNodeSeekPolls: []
        }
      });
      await submit(view);
    }
    await waitFor(() => expect(transport.requests).toHaveLength(1));
    await fireEvent.press(view.getByLabelText(source === 'yaohuo' ? '发送中…' : '发送回复'));
    expect(transport.requests).toHaveLength(1);
    await act(async () => transport.release());
    await waitFor(() => expect(view.getByTestId('submission-sheet').props.accessibilityState.expanded).toBe(false));
    if (outcome === 'refresh-error')
      await waitFor(() =>
        expect(
          appQueryClient
            .getQueryCache()
            .getAll()
            .some((query) => query.state.error?.message === 'Mock refresh offline')
        ).toBe(true)
      );
    await fireEvent.press(view.getByLabelText(launcher));
    if (source === 'yaohuo') expect(view.getByLabelText('私信回复内容').props.value).toBe('');
    else
      expect(messages(view).findLast((message: { type: string }) => message.type === 'INIT').payload.markdown).toBe('');
  });
  it('retains the draft on snapshot timeout and ignores the late timed-out response', async () => {
    const { view, transport } = await open();
    await fireEvent.press(view.getByLabelText('发送回复'));
    const request = messages(view).findLast((message: { type: string }) => message.type === 'REQUEST_SNAPSHOT');
    await waitFor(() => expect(view.getByText('无法取得最新正文，草稿已保留')).toBeTruthy(), { timeout: 2500 });
    await bridge(view, 'SNAPSHOT', {
      requestId: request.payload.requestId,
      snapshot: {
        revision: 9,
        markdown: 'expired body',
        mode: 'rich',
        isEmpty: false,
        validationIssues: [],
        pendingNodeSeekPolls: []
      }
    });
    expect(transport.requests).toHaveLength(0);
    expect(state(view).content).toBe(COMPOSER_DRAFT);
    await submit(view);
    await waitFor(() => expect(state(view).visible).toBe(false));
  });
  it.each(
    (['nodeseek', 'linuxdo', 'yaohuo'] as const).flatMap((source) =>
      (['network-error', 'rejected', 'unconfirmed'] as const).map((outcome) => ({ source, outcome }))
    )
  )('$source private message preserves the draft after $outcome until explicit retry', async ({ source, outcome }) => {
    const transport = createComposerTransport(outcome);
    transports.push(transport);
    const view = await render(<MessageSubmissionFixture source={source} transport={transport} />, {
      wrapper: QueryTestWrapper
    });
    const launcher = source === 'nodeseek' ? '发私信' : '回复私信';
    await waitFor(() => expect(view.getByLabelText(launcher)).toBeTruthy());
    await fireEvent.press(view.getByLabelText(launcher));
    if (source === 'yaohuo') {
      await fireEvent.changeText(view.getByLabelText('私信回复内容'), COMPOSER_DRAFT);
      await fireEvent.press(view.getByLabelText('发送回复'));
    } else {
      await ready(view);
      await bridge(view, 'SNAPSHOT', {
        snapshot: {
          revision: 1,
          markdown: COMPOSER_DRAFT,
          mode: 'rich',
          isEmpty: false,
          validationIssues: [],
          pendingNodeSeekPolls: []
        }
      });
      await submit(view);
    }
    const error =
      outcome === 'network-error'
        ? 'Mock network offline'
        : outcome === 'rejected'
          ? 'Mock rejected'
          : 'Mock unconfirmed';
    await waitFor(() => expect(view.getByText(error)).toBeTruthy());
    expect(view.getByTestId('submission-sheet').props.accessibilityState.expanded).toBe(true);
    expect(transport.requests).toHaveLength(1);
    transport.outcome = 'success';
    if (source === 'yaohuo') {
      expect(view.getByLabelText('私信回复内容').props.value).toBe(COMPOSER_DRAFT);
      await fireEvent.press(view.getByLabelText('发送回复'));
    } else await submit(view);
    await waitFor(() => expect(view.getByTestId('submission-sheet').props.accessibilityState.expanded).toBe(false));
    expect(transport.requests.map((request) => request.body)).toEqual([COMPOSER_DRAFT, COMPOSER_DRAFT]);
    expect(transport.confirmations).toBe(1);
  });
  it('isolates a pending private message when its conversation changes', async () => {
    const transport = createComposerTransport('success', true);
    transports.push(transport);
    const view = await render(<MessageSubmissionFixture transport={transport} />, { wrapper: QueryTestWrapper });
    await waitFor(() => expect(view.getByLabelText('发私信')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('发私信'));
    await ready(view);
    await bridge(view, 'SNAPSHOT', {
      snapshot: {
        revision: 1,
        markdown: COMPOSER_DRAFT,
        mode: 'rich',
        isEmpty: false,
        validationIssues: [],
        pendingNodeSeekPolls: []
      }
    });
    await submit(view);
    await waitFor(() => expect(transport.requests).toHaveLength(1));
    await view.rerender(<MessageSubmissionFixture transport={transport} conversationId="10" />);
    await waitFor(() => expect(view.getByLabelText('发私信')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('发私信'));
    await ready(view);
    await bridge(view, 'SNAPSHOT', {
      snapshot: {
        revision: 1,
        markdown: 'new conversation',
        mode: 'rich',
        isEmpty: false,
        validationIssues: [],
        pendingNodeSeekPolls: []
      }
    });
    await act(async () => transport.release());
    expect(view.getByTestId('submission-sheet').props.accessibilityState.expanded).toBe(true);
    expect(transport.confirmations).toBe(0);
    expect(view.getByText('16 字符')).toBeTruthy();
  });
  it('blocks reopening a private-message editor while its original submission is pending', async () => {
    const transport = createComposerTransport('success', true);
    transports.push(transport);
    const view = await render(<MessageSubmissionFixture transport={transport} />, { wrapper: QueryTestWrapper });
    await waitFor(() => expect(view.getByLabelText('发私信')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('发私信'));
    await ready(view);
    await bridge(view, 'SNAPSHOT', {
      snapshot: {
        revision: 1,
        markdown: COMPOSER_DRAFT,
        mode: 'rich',
        isEmpty: false,
        validationIssues: [],
        pendingNodeSeekPolls: []
      }
    });
    await submit(view);
    await waitFor(() => expect(transport.requests).toHaveLength(1));
    await submit(view, COMPOSER_DRAFT, '取消', 2);
    await waitFor(() => expect(view.getByTestId('submission-sheet').props.accessibilityState.expanded).toBe(false));
    expect(view.getByLabelText('发私信').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(view.getByLabelText('发私信'));
    expect(view.getByTestId('submission-sheet').props.accessibilityState.expanded).toBe(false);
    await act(async () => transport.release());
    await waitFor(() => expect(transport.confirmations).toBe(1));
    await waitFor(() => expect(view.getByLabelText('发私信').props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(view.getByLabelText('发私信'));
    expect(view.getByTestId('submission-sheet').props.accessibilityState.expanded).toBe(true);
    expect(messages(view).findLast((message: { type: string }) => message.type === 'INIT').payload.markdown).toBe('');
  });
  it('does not close or clear a different topic after an old confirmation', async () => {
    const { view, transport } = await open('nodeseek', 'success', true);
    await submit(view);
    await waitFor(() => expect(transport.requests).toHaveLength(1));
    await view.rerender(<TopicSubmissionFixture transport={transport} topicId="43" />);
    await fireEvent.press(view.getByText('填入测试草稿'));
    await fireEvent.press(view.getByText('打开测试回复'));
    await act(async () => transport.release());
    await waitFor(() => expect(state(view).busy).toBe(false));
    expect(state(view).visible).toBe(true);
    expect(state(view).content).toBe(COMPOSER_DRAFT);
  });
});
