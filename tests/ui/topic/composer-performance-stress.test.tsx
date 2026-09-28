import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor } from '../render';
import { QueryTestWrapper } from '../QueryTestWrapper';
import { createComposerTransport, TopicSubmissionFixture, type ComposerTransport } from '../composerSubmissionFixture';
import type { ComposerHostMessage } from '@/ui/composer/structuredComposerBridge';

// Native sheet geometry and WebView DOM rendering remain device evidence.
jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated'),
  __esModule: true,
  useAnimatedKeyboard: () =>
    (require('react') as typeof React).useRef({ height: { value: 0 }, state: { value: 4 } }).current,
  useAnimatedReaction: () => {}
}));
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
      return ReactModule.createElement(View, {}, props.children);
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
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual<typeof import('react-native-safe-area-context')>('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
  useSafeAreaFrame: () => ({ x: 0, y: 0, width: 360, height: 800 })
}));

type Rendered = Awaited<ReturnType<typeof render>>;
function messages(view: Rendered): ComposerHostMessage[] {
  return view
    .getByTestId('structured-composer-webview', { includeHiddenElements: true })
    .props.postMessageMock.mock.calls.map(([raw]: [string]) => JSON.parse(raw));
}
function state(view: Rendered) {
  return JSON.parse(view.getByTestId('composer-proof-state').props.children);
}

describe('large composer documents under repeated interaction', () => {
  const transports: ComposerTransport[] = [];
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });
  afterEach(async () => {
    await act(async () => transports.splice(0).forEach((transport) => transport.dispose()));
  });

  it.each(['nodeseek', 'linuxdo'] as const)(
    '%s keeps 128 KiB drafts intact and sends once during 100 presses across three reopen cycles',
    async (source) => {
      const transport = createComposerTransport('success', true);
      transports.push(transport);
      const view = await render(<TopicSubmissionFixture source={source} transport={transport} />, {
        wrapper: QueryTestWrapper
      });
      let snapshotRequests = 0;
      for (let round = 0; round < 3; round++) {
        transport.hold = true;
        await fireEvent.press(view.getByText('填入测试草稿'));
        await fireEvent.press(view.getByText('打开测试回复'));
        if (round === 0)
          await fireEvent(view.getByTestId('structured-composer-webview', { includeHiddenElements: true }), 'loadEnd');
        const init = messages(view).findLast((message) => message.type === 'INIT');
        expect(init).toBeDefined();
        const documentEpoch = init!.payload.documentEpoch;
        const send = (type: string, payload: object) =>
          view.getByTestId('structured-composer-webview', { includeHiddenElements: true }).props.onMessage({
            nativeEvent: { data: JSON.stringify({ type, payload: { documentEpoch, ...payload } }) }
          });
        await act(async () => send('READY', { revision: 0 }));
        const start = messages(view).length;
        for (let press = 0; press < 100; press++) await fireEvent.press(view.getByLabelText('发送回复'));
        const requests = messages(view)
          .slice(start)
          .filter((message) => message.type === 'REQUEST_SNAPSHOT');
        snapshotRequests += requests.length;
        expect(requests).toHaveLength(1);
        const markdown = `round-${round}\n${'Pressure test document\n'.repeat(6500)}`.slice(0, 128 * 1024);
        const snapshot = {
          revision: 1,
          markdown,
          mode: 'rich',
          isEmpty: false,
          validationIssues: [],
          pendingNodeSeekPolls: []
        };
        await act(async () => {
          for (const request of requests) send('SNAPSHOT', { requestId: request.payload.requestId, snapshot });
        });
        await waitFor(() => expect(transport.requests).toHaveLength(round + 1));
        expect(state(view)).toEqual({ visible: true, content: markdown, busy: true });
        const body = transport.requests[round]!.body;
        expect(source === 'nodeseek' ? JSON.parse(body).content : new URLSearchParams(body).get('raw')).toBe(markdown);
        await act(async () => transport.release());
        await waitFor(() => expect(state(view)).toEqual({ visible: false, content: '', busy: false }));
        await act(async () => {
          for (let late = 0; late < 100; late++) send('SNAPSHOT', { snapshot: { ...snapshot, revision: late + 2 } });
        });
        expect(state(view).content).toBe('');
        expect(transport.confirmations).toBe(round + 1);
      }
      console.info(
        JSON.stringify({
          workload: 'composer-stress',
          source,
          draftCharacters: 128 * 1024,
          presses: 300,
          snapshotRequests,
          posts: transport.requests.length
        })
      );
    },
    30_000
  );
});
