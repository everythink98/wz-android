import { useCallback, useEffect, type RefObject } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { shouldHandleBrowserHttpError } from './sessionControllerHelpers';
import { LINUXDO_BROWSER_FETCH_SCRIPT, NODESEEK_BROWSER_FETCH_SCRIPT } from './useHiddenBrowserFetchController';
import type { LinuxDoBrowserFetchRequest, NodeSeekBrowserFetchRequest } from './useSessionController';
import type { createStyles } from '../theme';
import { isLinuxDoBrowserFetchUrl } from '../linuxdoFetchFallback';
import { isNodeSeekBrowserFetchUrl } from '../nodeseekFetchFallback';

type HiddenBrowserState = {
  linuxDo: {
    request: LinuxDoBrowserFetchRequest | null;
    userAgent: string;
  };
  nodeSeek: {
    request: NodeSeekBrowserFetchRequest | null;
    userAgent: string;
  };
};

export function HiddenBrowserHost({
  blockedMessage,
  failLinuxDoBrowserFetchById,
  failNodeSeekBrowserFetchById,
  handleLinuxDoBrowserFetchMessage,
  handleNodeSeekBrowserFetchMessage,
  linuxDoBrowserWebViewRef,
  nodeSeekBrowserWebViewRef,
  onLinuxDoHttpErrorStatus,
  onNodeSeekHttpErrorStatus,
  state,
  styles
}: {
  blockedMessage: string;
  failLinuxDoBrowserFetchById: (requestId: number, message: string) => void;
  failNodeSeekBrowserFetchById: (requestId: number, message: string, options?: { skipStopLoading?: boolean }) => void;
  handleLinuxDoBrowserFetchMessage: (event: WebViewMessageEvent) => void;
  handleNodeSeekBrowserFetchMessage: (event: WebViewMessageEvent) => void;
  linuxDoBrowserWebViewRef: RefObject<WebView | null>;
  nodeSeekBrowserWebViewRef: RefObject<WebView | null>;
  onLinuxDoHttpErrorStatus: (requestId: number, statusCode: number) => void;
  onNodeSeekHttpErrorStatus: (requestId: number, statusCode: number) => void;
  state: HiddenBrowserState;
  styles: ReturnType<typeof createStyles>;
}) {
  const linuxDoBrowserFetchRequest = state.linuxDo.request;
  const nodeSeekBrowserFetchRequest = state.nodeSeek.request;
  useEffect(() => {
    if (!blockedMessage) {
      return;
    }
    if (nodeSeekBrowserFetchRequest) {
      failNodeSeekBrowserFetchById(nodeSeekBrowserFetchRequest.id, blockedMessage);
    }
    if (linuxDoBrowserFetchRequest) {
      failLinuxDoBrowserFetchById(linuxDoBrowserFetchRequest.id, blockedMessage);
    }
  }, [blockedMessage, failLinuxDoBrowserFetchById, failNodeSeekBrowserFetchById, linuxDoBrowserFetchRequest, nodeSeekBrowserFetchRequest]);
  const handleNodeSeekBrowserNavigation = useCallback((request: { url?: string }) => {
    const url = request.url || '';
    if (!url || isNodeSeekBrowserFetchUrl(url)) {
      return true;
    }
    if (nodeSeekBrowserFetchRequest) {
      failNodeSeekBrowserFetchById(nodeSeekBrowserFetchRequest.id, 'NodeSeek 页面跳转到外部地址，已停止读取');
    }
    return false;
  }, [failNodeSeekBrowserFetchById, nodeSeekBrowserFetchRequest]);
  const handleLinuxDoBrowserNavigation = useCallback((request: { url?: string }) => {
    const url = request.url || '';
    if (!url || isLinuxDoBrowserFetchUrl(url)) {
      return true;
    }
    if (linuxDoBrowserFetchRequest) {
      failLinuxDoBrowserFetchById(linuxDoBrowserFetchRequest.id, 'linux.do 页面跳转到外部地址，已停止读取');
    }
    return false;
  }, [failLinuxDoBrowserFetchById, linuxDoBrowserFetchRequest]);

  return (
    <>
      {!blockedMessage && nodeSeekBrowserFetchRequest ? (
        <View pointerEvents="none" style={styles.hiddenBrowserWebViewHost}>
          <WebView
            key={`nodeseek-browser-fetch-${nodeSeekBrowserFetchRequest.id}`}
            ref={nodeSeekBrowserWebViewRef}
            source={{
              uri: nodeSeekBrowserFetchRequest.url,
              headers: nodeSeekBrowserFetchRequest.cookie ? { Cookie: nodeSeekBrowserFetchRequest.cookie } : undefined
            }}
            javaScriptEnabled
            javaScriptCanOpenWindowsAutomatically={false}
            sharedCookiesEnabled
            setSupportMultipleWindows={false}
            thirdPartyCookiesEnabled
            userAgent={nodeSeekBrowserFetchRequest.userAgent || state.nodeSeek.userAgent}
            onShouldStartLoadWithRequest={handleNodeSeekBrowserNavigation}
            containerStyle={styles.hiddenBrowserWebView}
            style={styles.hiddenBrowserWebView}
            onLoadEnd={() => {
              nodeSeekBrowserWebViewRef.current?.injectJavaScript(
                NODESEEK_BROWSER_FETCH_SCRIPT.replace('__NODESEEK_BROWSER_FETCH_ID__', String(nodeSeekBrowserFetchRequest.id))
              );
            }}
            onMessage={handleNodeSeekBrowserFetchMessage}
            onError={(event) => {
              failNodeSeekBrowserFetchById(nodeSeekBrowserFetchRequest.id, event.nativeEvent.description || 'NodeSeek 页面加载失败');
            }}
            onHttpError={(event) => {
              if (!shouldHandleBrowserHttpError(
                nodeSeekBrowserFetchRequest.url,
                event.nativeEvent.url,
                isNodeSeekBrowserFetchUrl
              )) {
                return;
              }
              if (event.nativeEvent.statusCode === 403 || event.nativeEvent.statusCode === 404) {
                onNodeSeekHttpErrorStatus(nodeSeekBrowserFetchRequest.id, event.nativeEvent.statusCode);
                return;
              }
              failNodeSeekBrowserFetchById(nodeSeekBrowserFetchRequest.id, `NodeSeek 页面返回错误 ${event.nativeEvent.statusCode}`);
            }}
            onRenderProcessGone={() => {
              failNodeSeekBrowserFetchById(nodeSeekBrowserFetchRequest.id, 'NodeSeek 页面读取进程已停止', { skipStopLoading: true });
            }}
            renderError={() => <View style={styles.hiddenBrowserWebView} />}
          />
        </View>
      ) : null}
      {!blockedMessage && linuxDoBrowserFetchRequest ? (
        <View pointerEvents="none" style={styles.hiddenBrowserWebViewHost}>
          <WebView
            key={`linuxdo-browser-fetch-${linuxDoBrowserFetchRequest.id}`}
            ref={linuxDoBrowserWebViewRef}
            source={{
              uri: linuxDoBrowserFetchRequest.url,
              headers: linuxDoBrowserFetchRequest.cookie ? { Cookie: linuxDoBrowserFetchRequest.cookie } : undefined
            }}
            javaScriptEnabled
            javaScriptCanOpenWindowsAutomatically={false}
            sharedCookiesEnabled
            setSupportMultipleWindows={false}
            thirdPartyCookiesEnabled
            userAgent={linuxDoBrowserFetchRequest.userAgent || state.linuxDo.userAgent}
            onShouldStartLoadWithRequest={handleLinuxDoBrowserNavigation}
            containerStyle={styles.hiddenBrowserWebView}
            style={styles.hiddenBrowserWebView}
            onLoadEnd={() => {
              linuxDoBrowserWebViewRef.current?.injectJavaScript(
                LINUXDO_BROWSER_FETCH_SCRIPT.replace('__LINUXDO_BROWSER_FETCH_ID__', String(linuxDoBrowserFetchRequest.id))
              );
            }}
            onMessage={handleLinuxDoBrowserFetchMessage}
            onError={(event) => {
              failLinuxDoBrowserFetchById(linuxDoBrowserFetchRequest.id, event.nativeEvent.description || 'linux.do 页面加载失败');
            }}
            onHttpError={(event) => {
              if (!shouldHandleBrowserHttpError(
                linuxDoBrowserFetchRequest.url,
                event.nativeEvent.url,
                isLinuxDoBrowserFetchUrl
              )) {
                return;
              }
              if (event.nativeEvent.statusCode === 403) {
                onLinuxDoHttpErrorStatus(linuxDoBrowserFetchRequest.id, event.nativeEvent.statusCode);
                return;
              }
              failLinuxDoBrowserFetchById(linuxDoBrowserFetchRequest.id, `linux.do 页面返回错误 ${event.nativeEvent.statusCode}`);
            }}
            onRenderProcessGone={() => {
              failLinuxDoBrowserFetchById(linuxDoBrowserFetchRequest.id, 'linux.do 页面读取进程已停止');
            }}
            renderError={() => <View style={styles.hiddenBrowserWebView} />}
          />
        </View>
      ) : null}
    </>
  );
}
