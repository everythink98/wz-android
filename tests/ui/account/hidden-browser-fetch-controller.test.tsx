import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type { WebViewMessageEvent } from 'react-native-webview';
import { useHiddenBrowserFetchController } from '@/features/account/useHiddenBrowserFetchController';

function browserMessage(sourceUrl: string, data: Record<string, unknown>) {
  return {
    nativeEvent: {
      canGoBack: false,
      canGoForward: false,
      data: JSON.stringify(data),
      loading: false,
      target: 1,
      title: '',
      url: sourceUrl
    }
  } as unknown as WebViewMessageEvent;
}

describe('hidden browser fetch controller', () => {
  it.each([
    {
      type: 'nodeseek-browser-fetch',
      payloadUrl: 'https://www.nodeseek.com/post-1-1',
      selectHandler: (controller: ReturnType<typeof useHiddenBrowserFetchController>) =>
        controller.handleNodeSeekBrowserFetchMessage,
      selectCompletion: (_linuxDo: jest.Mock, nodeSeek: jest.Mock) => nodeSeek
    },
    {
      type: 'linuxdo-browser-fetch',
      payloadUrl: 'https://linux.do/latest.json',
      selectHandler: (controller: ReturnType<typeof useHiddenBrowserFetchController>) =>
        controller.handleLinuxDoBrowserFetchMessage,
      selectCompletion: (linuxDo: jest.Mock, _nodeSeek: jest.Mock) => linuxDo
    }
  ])(
    'rejects a $type message forged by a different document origin',
    async ({ payloadUrl, selectCompletion, selectHandler, type }) => {
      const completeLinuxDoBrowserFetch = jest.fn();
      const completeNodeSeekBrowserFetch = jest.fn();
      const hook = await renderHook(() =>
        useHiddenBrowserFetchController({
          completeLinuxDoBrowserFetch,
          completeNodeSeekBrowserFetch
        })
      );

      await act(async () => {
        selectHandler(hook.result.current)(
          browserMessage('https://evil.example/frame', {
            type,
            id: 1,
            url: payloadUrl
          })
        );
        await Promise.resolve();
      });

      expect(selectCompletion(completeLinuxDoBrowserFetch, completeNodeSeekBrowserFetch)).not.toHaveBeenCalled();

      await act(async () => {
        selectHandler(hook.result.current)(
          browserMessage(new URL(payloadUrl).origin, {
            type,
            id: 1,
            url: payloadUrl
          })
        );
        await Promise.resolve();
      });

      expect(selectCompletion(completeLinuxDoBrowserFetch, completeNodeSeekBrowserFetch)).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, type, url: payloadUrl })
      );
    }
  );
});
