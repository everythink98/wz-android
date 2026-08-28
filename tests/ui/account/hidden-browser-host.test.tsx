import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import React, { createRef } from 'react';
import type { WebView } from 'react-native-webview';
import { HiddenBrowserHost } from '@/features/account/HiddenBrowserHost';

const mockInjectJavaScript = jest.fn();
let mockWebViewProps: Record<string, any> = {};
const mockWebViewPropsByUrl = new Map<string, Record<string, any>>();

jest.mock('react-native-webview', () => {
  const ReactModule = require('react') as typeof React;
  const Native = require('react-native') as typeof import('react-native');
  return {
    WebView: ReactModule.forwardRef(function MockWebView(props: Record<string, any>, ref) {
      mockWebViewProps = props;
      mockWebViewPropsByUrl.set(props.source.uri, props);
      ReactModule.useImperativeHandle(ref, () => ({
        injectJavaScript: mockInjectJavaScript,
        stopLoading: jest.fn()
      }));
      return ReactModule.createElement(Native.View);
    })
  };
});

describe('HiddenBrowserHost linux.do transport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWebViewPropsByUrl.clear();
  });

  it('keeps shared site WebViews cookie-clean and unmounted while blocked', async () => {
    const failLinuxDoBrowserFetchById = jest.fn();
    const failNodeSeekBrowserFetchById = jest.fn();
    const props: React.ComponentProps<typeof HiddenBrowserHost> = {
      blockedMessage: '',
      failLinuxDoBrowserFetchById,
      failNodeSeekBrowserFetchById,
      handleLinuxDoBrowserFetchMessage: jest.fn(),
      handleNodeSeekBrowserFetchMessage: jest.fn(),
      linuxDoBrowserWebViewRef: createRef<WebView>(),
      nodeSeekBrowserWebViewRef: createRef<WebView>(),
      onLinuxDoHttpErrorStatus: jest.fn(),
      onNodeSeekHttpErrorStatus: jest.fn(),
      state: {
        linuxDo: { request: { id: 2, url: 'https://linux.do/latest.json' }, userAgent: 'LinuxDo Agent' },
        nodeSeek: { request: { id: 1, url: 'https://www.nodeseek.com/post-1-1' }, userAgent: 'NodeSeek Agent' }
      },
      styles: {} as never
    };
    const view = await render(<HiddenBrowserHost {...props} />);

    expect(mockWebViewPropsByUrl.get('https://www.nodeseek.com/post-1-1')?.source).toEqual({
      uri: 'https://www.nodeseek.com/post-1-1'
    });
    expect(
      mockWebViewPropsByUrl.get('https://www.nodeseek.com/post-1-1')?.injectedJavaScriptBeforeContentLoaded
    ).toBeUndefined();
    expect(mockWebViewPropsByUrl.get('https://linux.do/latest.json')?.source).toEqual({
      uri: 'https://linux.do/latest.json'
    });

    mockWebViewPropsByUrl.clear();
    await view.rerender(<HiddenBrowserHost {...props} blockedMessage="代理状态切换中" />);
    expect(failNodeSeekBrowserFetchById).toHaveBeenCalledWith(1, '代理状态切换中');
    expect(failLinuxDoBrowserFetchById).toHaveBeenCalledWith(2, '代理状态切换中');
    expect(mockWebViewPropsByUrl).toHaveProperty('size', 0);
  });

  it('passes the account owner into the NodeSeek identity probe script', async () => {
    const url = 'https://www.nodeseek.com/';
    await render(
      <HiddenBrowserHost
        blockedMessage=""
        failLinuxDoBrowserFetchById={jest.fn()}
        failNodeSeekBrowserFetchById={jest.fn()}
        handleLinuxDoBrowserFetchMessage={jest.fn()}
        handleNodeSeekBrowserFetchMessage={jest.fn()}
        linuxDoBrowserWebViewRef={createRef<WebView>()}
        nodeSeekBrowserWebViewRef={createRef<WebView>()}
        onLinuxDoHttpErrorStatus={jest.fn()}
        onNodeSeekHttpErrorStatus={jest.fn()}
        state={{
          linuxDo: { request: null, userAgent: 'LinuxDo Agent' },
          nodeSeek: {
            request: { id: 3, url, owner: 'account' },
            userAgent: 'NodeSeek Agent'
          }
        }}
        styles={{} as never}
      />
    );

    expect(mockWebViewPropsByUrl.get(url)?.injectedJavaScriptBeforeContentLoaded).toEqual(
      expect.stringContaining('const requestOwner = "account";')
    );
    mockWebViewPropsByUrl.get(url)?.onLoadEnd();

    expect(mockInjectJavaScript).toHaveBeenCalledWith(expect.stringContaining('const requestOwner = "account";'));
  });

  it('inspects a main-document 429 instead of failing before DOM classification', async () => {
    const failLinuxDoBrowserFetchById = jest.fn();
    const onLinuxDoHttpErrorStatus = jest.fn();
    const linuxDoBrowserWebViewRef = createRef<WebView>();
    await render(
      <HiddenBrowserHost
        blockedMessage=""
        failLinuxDoBrowserFetchById={failLinuxDoBrowserFetchById}
        failNodeSeekBrowserFetchById={jest.fn()}
        handleLinuxDoBrowserFetchMessage={jest.fn()}
        handleNodeSeekBrowserFetchMessage={jest.fn()}
        linuxDoBrowserWebViewRef={linuxDoBrowserWebViewRef}
        nodeSeekBrowserWebViewRef={createRef<WebView>()}
        onLinuxDoHttpErrorStatus={onLinuxDoHttpErrorStatus}
        onNodeSeekHttpErrorStatus={jest.fn()}
        state={{
          linuxDo: {
            request: { id: 7, url: 'https://linux.do/latest.json' },
            userAgent: 'LinuxDo Agent'
          },
          nodeSeek: { request: null, userAgent: 'NodeSeek Agent' }
        }}
        styles={{} as never}
      />
    );

    mockWebViewProps.onHttpError({
      nativeEvent: { statusCode: 429, url: mockWebViewProps.source.uri }
    });
    mockWebViewProps.onLoadEnd();

    expect(onLinuxDoHttpErrorStatus).toHaveBeenCalledWith(7, 429);
    expect(failLinuxDoBrowserFetchById).not.toHaveBeenCalled();
    expect(mockInjectJavaScript).toHaveBeenCalledWith(expect.stringContaining('linuxdo-browser-fetch'));
  });

  it('clears the previous main-document error when Cloudflare navigates to a new document', async () => {
    const onLinuxDoHttpErrorStatus = jest.fn();
    await render(
      <HiddenBrowserHost
        blockedMessage=""
        failLinuxDoBrowserFetchById={jest.fn()}
        failNodeSeekBrowserFetchById={jest.fn()}
        handleLinuxDoBrowserFetchMessage={jest.fn()}
        handleNodeSeekBrowserFetchMessage={jest.fn()}
        linuxDoBrowserWebViewRef={createRef<WebView>()}
        nodeSeekBrowserWebViewRef={createRef<WebView>()}
        onLinuxDoHttpErrorStatus={onLinuxDoHttpErrorStatus}
        onNodeSeekHttpErrorStatus={jest.fn()}
        state={{
          linuxDo: {
            request: { id: 8, url: 'https://linux.do/latest.json' },
            userAgent: 'LinuxDo Agent'
          },
          nodeSeek: { request: null, userAgent: 'NodeSeek Agent' }
        }}
        styles={{} as never}
      />
    );

    mockWebViewProps.onHttpError({
      nativeEvent: { statusCode: 429, url: mockWebViewProps.source.uri }
    });
    mockWebViewProps.onLoadStart();

    expect(onLinuxDoHttpErrorStatus).toHaveBeenNthCalledWith(1, 8, 429);
    expect(onLinuxDoHttpErrorStatus).toHaveBeenLastCalledWith(8, undefined);
  });

  it('keeps the unrelated hidden-browser request running when the other renderer exits', async () => {
    const failLinuxDoBrowserFetchById = jest.fn();
    const failNodeSeekBrowserFetchById = jest.fn();
    await render(
      <HiddenBrowserHost
        blockedMessage=""
        failLinuxDoBrowserFetchById={failLinuxDoBrowserFetchById}
        failNodeSeekBrowserFetchById={failNodeSeekBrowserFetchById}
        handleLinuxDoBrowserFetchMessage={jest.fn()}
        handleNodeSeekBrowserFetchMessage={jest.fn()}
        linuxDoBrowserWebViewRef={createRef<WebView>()}
        nodeSeekBrowserWebViewRef={createRef<WebView>()}
        onLinuxDoHttpErrorStatus={jest.fn()}
        onNodeSeekHttpErrorStatus={jest.fn()}
        state={{
          linuxDo: {
            request: { id: 12, url: 'https://linux.do/latest.json' },
            userAgent: 'LinuxDo Agent'
          },
          nodeSeek: {
            request: { id: 11, url: 'https://www.nodeseek.com/post-11-1' },
            userAgent: 'NodeSeek Agent'
          }
        }}
        styles={{} as never}
      />
    );
    const nodeSeekProps = mockWebViewPropsByUrl.get('https://www.nodeseek.com/post-11-1');
    const linuxDoKey = mockWebViewPropsByUrl.get('https://linux.do/latest.json')?.key;

    await act(async () => {
      nodeSeekProps?.onRenderProcessGone();
    });

    expect(failNodeSeekBrowserFetchById).toHaveBeenCalledWith(11, 'NodeSeek 页面读取进程已停止', {
      skipStopLoading: true
    });
    expect(failLinuxDoBrowserFetchById).not.toHaveBeenCalled();
    expect(mockWebViewPropsByUrl.get('https://linux.do/latest.json')?.key).toBe(linuxDoKey);
  });
});
