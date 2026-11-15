import { Image, StyleSheet } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { composerHostMessages } from '../../../composerHostMessages';
import { fireEvent, render, waitFor } from '../../../render';
import { notificationVisualScenarios } from './manifest';

describe('notification visual scenarios', () => {
  it('uses window safe insets for the portalled message sheet instead of a fixed nested frame', async () => {
    const scenario = notificationVisualScenarios.find(({ id }) => id === 'notifications.detail.conversation');
    if (scenario?.kind !== 'rendered') throw new Error('The conversation visual scene is missing');
    const view = await render(
      <SafeAreaInsetsContext.Provider value={{ top: 48, right: 0, bottom: 34, left: 0 }}>
        {scenario.render()}
      </SafeAreaInsetsContext.Provider>
    );
    await fireEvent.press(view.getByLabelText('继续编辑私信草稿'));
    expect(StyleSheet.flatten(view.getByTestId('composer-bottom-sheet').props.style).paddingBottom).toBe(34);
  });

  it('edits and reopens a local long-conversation draft without reading or writing the network', async () => {
    const fetcher = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('The visual fixture must stay offline'));
    const imageProbe = jest.spyOn(Image, 'getSize');
    const scenario = notificationVisualScenarios.find(({ id }) => id === 'notifications.detail.conversation');
    if (scenario?.kind !== 'rendered') throw new Error('The conversation visual scene is missing');
    try {
      const view = await render(scenario.render());
      expect(view.getAllByTestId(/^notification-message-/)).toHaveLength(80);
      expect(view.getByText('本地会话消息 80：保留上下文，检查草稿编辑与返回。')).toBeTruthy();
      await fireEvent.press(view.getByLabelText('继续编辑私信草稿'));
      const webView = view.getByTestId('structured-composer-webview');
      await fireEvent(webView, 'loadEnd');
      await fireEvent(webView, 'message', {
        nativeEvent: { data: JSON.stringify({ type: 'READY', payload: { revision: 0 } }) }
      });
      const snapshot = {
        revision: 1,
        markdown: '本地编辑后保留的草稿',
        mode: 'rich',
        isEmpty: false,
        validationIssues: [],
        pendingNodeSeekPolls: []
      };
      await fireEvent(webView, 'message', {
        nativeEvent: { data: JSON.stringify({ type: 'SNAPSHOT', payload: { snapshot } }) }
      });
      await fireEvent.press(view.getByRole('button', { name: '取消' }));
      const request = composerHostMessages(view).findLast(({ type }) => type === 'REQUEST_SNAPSHOT');
      if (request?.type !== 'REQUEST_SNAPSHOT') throw new Error('The local composer did not request its closing draft');
      await fireEvent(webView, 'message', {
        nativeEvent: {
          data: JSON.stringify({ type: 'SNAPSHOT', payload: { requestId: request.payload.requestId, snapshot } })
        }
      });
      await waitFor(() => expect(view.queryByRole('button', { name: '取消' })).toBeNull());
      expect(view.getByText('本地编辑后保留的草稿')).toBeTruthy();
      await fireEvent.press(view.getByLabelText('继续编辑私信草稿'));
      await waitFor(() => expect(view.getByRole('button', { name: '取消' })).toBeTruthy());
      expect(view.getAllByTestId(/^notification-message-/)).toHaveLength(80);
      expect(view.getByText('本地会话消息 80：保留上下文，检查草稿编辑与返回。')).toBeTruthy();
      expect(view.getByText(`${snapshot.markdown.length} 字符`)).toBeTruthy();
      expect(fetcher).not.toHaveBeenCalled();
      expect(imageProbe).not.toHaveBeenCalled();
    } finally {
      fetcher.mockRestore();
      imageProbe.mockRestore();
    }
  });

  it('keeps real notification writes and system delivery outside rendered scenes', () => {
    expect(notificationVisualScenarios.find(({ id }) => id === 'notifications.detail.write-interactions')?.kind).toBe(
      'device-only'
    );
    expect(notificationVisualScenarios.find(({ id }) => id === 'notifications.system.delivery')?.kind).toBe(
      'device-only'
    );
  });
});
