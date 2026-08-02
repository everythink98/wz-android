import { useCallback, useEffect, useState, type RefObject } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { shouldHandleBrowserHttpError } from './browserFetchQueue';
import { LINUXDO_BROWSER_FETCH_SCRIPT, NODESEEK_BROWSER_FETCH_SCRIPT } from './useHiddenBrowserFetchController';
import type { LinuxDoBrowserFetchRequest, NodeSeekBrowserFetchRequest } from './useSessionController';

import { isLinuxDoBrowserNavigationUrl, isLinuxDoBrowserResultUrl } from '@/sources/linuxdo/browserFallback';
import { isNodeSeekBrowserNavigationUrl, isNodeSeekBrowserResultUrl } from '@/sources/nodeseek/browserFallback';
import { isGoogleSiteSearchAccessTroubleUrl } from '@/sources/searchFallback';
import type { AccountHostStyles } from './accountHostStyles';

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
  failLinuxDoBrowserFetchById: (requestId: number, message: string, options?: { skipStopLoading?: boolean }) => void;
  failNodeSeekBrowserFetchById: (requestId: number, message: string, options?: { skipStopLoading?: boolean }) => void;
  handleLinuxDoBrowserFetchMessage: (event: WebViewMessageEvent) => void;
  handleNodeSeekBrowserFetchMessage: (event: WebViewMessageEvent) => void;
  linuxDoBrowserWebViewRef: RefObject<WebView | null>;
  nodeSeekBrowserWebViewRef: RefObject<WebView | null>;
  onLinuxDoHttpErrorStatus: (requestId: number, statusCode?: number) => void;
  onNodeSeekHttpErrorStatus: (requestId: number, statusCode: number) => void;
  state: HiddenBrowserState;
  styles: AccountHostStyles;
}) {
  const linuxDoBrowserFetchRequest = state.linuxDo.request;
  const nodeSeekBrowserFetchRequest = state.nodeSeek.request;
  const nodeSeekBrowserFetchScript = nodeSeekBrowserFetchRequest
    ? NODESEEK_BROWSER_FETCH_SCRIPT.replace(
        '__NODESEEK_BROWSER_FETCH_ID__',
        String(nodeSeekBrowserFetchRequest.id)
      ).replace('__NODESEEK_BROWSER_FETCH_OWNER__', JSON.stringify(nodeSeekBrowserFetchRequest.owner ?? null))
    : '';
  const [linuxDoWebViewGeneration, setLinuxDoWebViewGeneration] = useState(0);
  const [nodeSeekWebViewGeneration, setNodeSeekWebViewGeneration] = useState(0);
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
  }, [
    blockedMessage,
    failLinuxDoBrowserFetchById,
    failNodeSeekBrowserFetchById,
    linuxDoBrowserFetchRequest,
    nodeSeekBrowserFetchRequest
  ]);
  const handleNodeSeekBrowserNavigation = useCallback(
    (request: { url?: string }) => {
      const url = request.url || '';
      if (
        !url ||
        (nodeSeekBrowserFetchRequest && isNodeSeekBrowserNavigationUrl(url, nodeSeekBrowserFetchRequest.url))
      ) {
        return true;
      }
      if (nodeSeekBrowserFetchRequest) {
        failNodeSeekBrowserFetchById(
          nodeSeekBrowserFetchRequest.id,
          isGoogleSiteSearchAccessTroubleUrl(url, 'nodeseek.com', nodeSeekBrowserFetchRequest.url)
            ? 'Google 搜索环境验证暂时未通过，请稍后重试'
            : 'NodeSeek 页面跳转到外部地址，已停止读取'
        );
      }
      return false;
    },
    [failNodeSeekBrowserFetchById, nodeSeekBrowserFetchRequest]
  );
  const handleLinuxDoBrowserNavigation = useCallback(
    (request: { url?: string }) => {
      const url = request.url || '';
      if (!url || (linuxDoBrowserFetchRequest && isLinuxDoBrowserNavigationUrl(url, linuxDoBrowserFetchRequest.url))) {
        return true;
      }
      if (linuxDoBrowserFetchRequest) {
        failLinuxDoBrowserFetchById(
          linuxDoBrowserFetchRequest.id,
          isGoogleSiteSearchAccessTroubleUrl(url, 'linux.do', linuxDoBrowserFetchRequest.url)
            ? 'Google 搜索环境验证暂时未通过，请稍后重试'
            : 'linux.do 页面跳转到外部地址，已停止读取'
        );
      }
      return false;
    },
    [failLinuxDoBrowserFetchById, linuxDoBrowserFetchRequest]
  );
  const handleNodeSeekBrowserRenderProcessGone = useCallback(() => {
    setNodeSeekWebViewGeneration((current) => current + 1);
    if (!nodeSeekBrowserFetchRequest) {
      return;
    }
    failNodeSeekBrowserFetchById(nodeSeekBrowserFetchRequest.id, 'NodeSeek 页面读取进程已停止', {
      skipStopLoading: true
    });
  }, [failNodeSeekBrowserFetchById, nodeSeekBrowserFetchRequest]);
  const handleLinuxDoBrowserRenderProcessGone = useCallback(() => {
    setLinuxDoWebViewGeneration((current) => current + 1);
    if (linuxDoBrowserFetchRequest) {
      failLinuxDoBrowserFetchById(linuxDoBrowserFetchRequest.id, 'linux.do 页面读取进程已停止', {
        skipStopLoading: true
      });
    }
  }, [failLinuxDoBrowserFetchById, linuxDoBrowserFetchRequest]);

  return (
    <>
      {!blockedMessage && nodeSeekBrowserFetchRequest ? (
        <View pointerEvents="none" style={styles.hiddenBrowserWebViewHost}>
          <WebView
            key={`nodeseek-browser-fetch-${nodeSeekWebViewGeneration}-${nodeSeekBrowserFetchRequest.id}`}
            ref={nodeSeekBrowserWebViewRef}
            source={{ uri: nodeSeekBrowserFetchRequest.url }}
            javaScriptEnabled
            javaScriptCanOpenWindowsAutomatically={false}
            sharedCookiesEnabled
            setSupportMultipleWindows={false}
            thirdPartyCookiesEnabled
            userAgent={nodeSeekBrowserFetchRequest.userAgent || state.nodeSeek.userAgent}
            onShouldStartLoadWithRequest={handleNodeSeekBrowserNavigation}
            injectedJavaScriptBeforeContentLoaded={
              nodeSeekBrowserFetchRequest.owner === 'account' ? nodeSeekBrowserFetchScript : undefined
            }
            containerStyle={styles.hiddenBrowserWebView}
            style={styles.hiddenBrowserWebView}
            onLoadEnd={() => {
              nodeSeekBrowserWebViewRef.current?.injectJavaScript(nodeSeekBrowserFetchScript);
            }}
            onMessage={handleNodeSeekBrowserFetchMessage}
            onError={(event) => {
              failNodeSeekBrowserFetchById(
                nodeSeekBrowserFetchRequest.id,
                event.nativeEvent.description || 'NodeSeek 页面加载失败'
              );
            }}
            onHttpError={(event) => {
              if (
                !shouldHandleBrowserHttpError(nodeSeekBrowserFetchRequest.url, event.nativeEvent.url, (url) =>
                  isNodeSeekBrowserResultUrl(url, nodeSeekBrowserFetchRequest.url)
                )
              ) {
                return;
              }
              if (event.nativeEvent.statusCode === 403 || event.nativeEvent.statusCode === 404) {
                onNodeSeekHttpErrorStatus(nodeSeekBrowserFetchRequest.id, event.nativeEvent.statusCode);
                return;
              }
              failNodeSeekBrowserFetchById(
                nodeSeekBrowserFetchRequest.id,
                `NodeSeek 页面返回错误 ${event.nativeEvent.statusCode}`
              );
            }}
            onRenderProcessGone={handleNodeSeekBrowserRenderProcessGone}
            renderError={() => <View style={styles.hiddenBrowserWebView} />}
          />
        </View>
      ) : null}
      {!blockedMessage && linuxDoBrowserFetchRequest ? (
        <View pointerEvents="none" style={styles.hiddenBrowserWebViewHost}>
          <WebView
            key={`linuxdo-browser-fetch-${linuxDoWebViewGeneration}-${linuxDoBrowserFetchRequest.id}`}
            ref={linuxDoBrowserWebViewRef}
            source={{ uri: linuxDoBrowserFetchRequest.url }}
            javaScriptEnabled
            javaScriptCanOpenWindowsAutomatically={false}
            sharedCookiesEnabled
            setSupportMultipleWindows={false}
            thirdPartyCookiesEnabled
            userAgent={linuxDoBrowserFetchRequest.userAgent || state.linuxDo.userAgent}
            onShouldStartLoadWithRequest={handleLinuxDoBrowserNavigation}
            containerStyle={styles.hiddenBrowserWebView}
            style={styles.hiddenBrowserWebView}
            onLoadStart={() => {
              onLinuxDoHttpErrorStatus(linuxDoBrowserFetchRequest.id, undefined);
            }}
            onLoadEnd={() => {
              linuxDoBrowserWebViewRef.current?.injectJavaScript(
                LINUXDO_BROWSER_FETCH_SCRIPT.replace(
                  '__LINUXDO_BROWSER_FETCH_ID__',
                  String(linuxDoBrowserFetchRequest.id)
                )
              );
            }}
            onMessage={handleLinuxDoBrowserFetchMessage}
            onError={(event) => {
              failLinuxDoBrowserFetchById(
                linuxDoBrowserFetchRequest.id,
                event.nativeEvent.description || 'linux.do 页面加载失败'
              );
            }}
            onHttpError={(event) => {
              if (
                !shouldHandleBrowserHttpError(linuxDoBrowserFetchRequest.url, event.nativeEvent.url, (url) =>
                  isLinuxDoBrowserResultUrl(url, linuxDoBrowserFetchRequest.url)
                )
              ) {
                return;
              }
              onLinuxDoHttpErrorStatus(linuxDoBrowserFetchRequest.id, event.nativeEvent.statusCode);
            }}
            onRenderProcessGone={handleLinuxDoBrowserRenderProcessGone}
            renderError={() => <View style={styles.hiddenBrowserWebView} />}
          />
        </View>
      ) : null}
    </>
  );
}
