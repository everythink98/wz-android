import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';
import { shouldHandleBrowserHttpError } from './browserFetchQueue';
import { LINUXDO_BROWSER_FETCH_SCRIPT, NODESEEK_BROWSER_FETCH_SCRIPT } from './useHiddenBrowserFetchController';
import type { LinuxDoBrowserFetchRequest, NodeSeekBrowserFetchRequest } from './useSessionController';

import { isLinuxDoBrowserRequestPair } from '@/sources/linuxdo/browserFallback';
import { isNodeSeekBrowserRequestPair } from '@/sources/nodeseek/browserFallback';
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

type HiddenBrowserDocumentProps = Pick<
  WebViewProps,
  | 'source'
  | 'userAgent'
  | 'injectedJavaScriptBeforeContentLoaded'
  | 'onShouldStartLoadWithRequest'
  | 'onMessage'
  | 'onError'
  | 'onHttpError'
  | 'onRenderProcessGone'
> & {
  browserRef: RefObject<WebView | null>;
  script: string;
  styles: AccountHostStyles;
  clearHttpError: () => void;
};

function HiddenBrowserDocument(props: HiddenBrowserDocumentProps) {
  const { browserRef, script, styles } = props;
  const documentRef = useRef<WebView | null>(null);
  const frame = useRef<{
    url?: string;
    errorUrl?: string;
    nextError?: Parameters<NonNullable<WebViewProps['onHttpError']>>[0];
  }>({});
  const bindDocument = useCallback(
    (view: WebView | null) => {
      documentRef.current = view;
      browserRef.current = view;
    },
    [browserRef]
  );
  return (
    <WebView
      ref={bindDocument}
      source={props.source}
      javaScriptEnabled
      javaScriptCanOpenWindowsAutomatically={false}
      sharedCookiesEnabled
      setSupportMultipleWindows={false}
      thirdPartyCookiesEnabled
      userAgent={props.userAgent}
      onShouldStartLoadWithRequest={props.onShouldStartLoadWithRequest}
      injectedJavaScriptBeforeContentLoaded={props.injectedJavaScriptBeforeContentLoaded}
      containerStyle={styles.hiddenBrowserWebView}
      style={styles.hiddenBrowserWebView}
      onMainFrameLoadStart={({ nativeEvent }) => {
        if (!documentRef.current) return;
        const url = nativeEvent.url.split('#', 1)[0];
        const previous = frame.current;
        const earlyError = previous.nextError;
        const firstCommitOfFailedDocument = previous.url === undefined && previous.errorUrl === url;
        frame.current = { url, errorUrl: firstCommitOfFailedDocument ? url : undefined };
        if (!firstCommitOfFailedDocument && previous.errorUrl !== undefined) props.clearHttpError();
        if (earlyError?.nativeEvent.url?.split('#', 1)[0] === url) {
          frame.current.errorUrl = url;
          props.onHttpError?.(earlyError);
        }
      }}
      onLoadEnd={() => documentRef.current?.injectJavaScript(script)}
      onMessage={props.onMessage}
      onError={props.onError}
      onHttpError={(event) => {
        if (!documentRef.current) return;
        const url = event.nativeEvent.url?.split('#', 1)[0];
        if (url && frame.current.url !== undefined && frame.current.url !== url) {
          frame.current.nextError = event;
          return;
        }
        frame.current.errorUrl = url ?? '';
        props.onHttpError?.(event);
      }}
      onRenderProcessGone={props.onRenderProcessGone}
      renderError={() => <View style={styles.hiddenBrowserWebView} />}
    />
  );
}

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
  onNodeSeekHttpErrorStatus: (requestId: number, statusCode?: number) => void;
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
      if (!url || (nodeSeekBrowserFetchRequest && isNodeSeekBrowserRequestPair(url, nodeSeekBrowserFetchRequest.url))) {
        return true;
      }
      if (nodeSeekBrowserFetchRequest) {
        failNodeSeekBrowserFetchById(nodeSeekBrowserFetchRequest.id, 'NodeSeek 页面跳转到外部地址，已停止读取');
      }
      return false;
    },
    [failNodeSeekBrowserFetchById, nodeSeekBrowserFetchRequest]
  );
  const handleLinuxDoBrowserNavigation = useCallback(
    (request: { url?: string }) => {
      const url = request.url || '';
      if (!url || (linuxDoBrowserFetchRequest && isLinuxDoBrowserRequestPair(url, linuxDoBrowserFetchRequest.url))) {
        return true;
      }
      if (linuxDoBrowserFetchRequest) {
        failLinuxDoBrowserFetchById(linuxDoBrowserFetchRequest.id, 'linux.do 页面跳转到外部地址，已停止读取');
      }
      return false;
    },
    [failLinuxDoBrowserFetchById, linuxDoBrowserFetchRequest]
  );
  const handleNodeSeekBrowserRenderProcessGone = useCallback(() => {
    if (!nodeSeekBrowserFetchRequest) {
      return;
    }
    failNodeSeekBrowserFetchById(nodeSeekBrowserFetchRequest.id, 'NodeSeek 页面读取进程已停止', {
      skipStopLoading: true
    });
  }, [failNodeSeekBrowserFetchById, nodeSeekBrowserFetchRequest]);
  const handleLinuxDoBrowserRenderProcessGone = useCallback(() => {
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
          <HiddenBrowserDocument
            key={nodeSeekBrowserFetchRequest.id}
            browserRef={nodeSeekBrowserWebViewRef}
            script={nodeSeekBrowserFetchScript}
            styles={styles}
            source={{ uri: nodeSeekBrowserFetchRequest.url }}
            userAgent={nodeSeekBrowserFetchRequest.userAgent || state.nodeSeek.userAgent}
            onShouldStartLoadWithRequest={handleNodeSeekBrowserNavigation}
            injectedJavaScriptBeforeContentLoaded={nodeSeekBrowserFetchScript}
            clearHttpError={() => onNodeSeekHttpErrorStatus(nodeSeekBrowserFetchRequest.id, undefined)}
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
                  isNodeSeekBrowserRequestPair(url, nodeSeekBrowserFetchRequest.url)
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
          />
        </View>
      ) : null}
      {!blockedMessage && linuxDoBrowserFetchRequest ? (
        <View pointerEvents="none" style={styles.hiddenBrowserWebViewHost}>
          <HiddenBrowserDocument
            key={linuxDoBrowserFetchRequest.id}
            browserRef={linuxDoBrowserWebViewRef}
            script={LINUXDO_BROWSER_FETCH_SCRIPT.replace(
              '__LINUXDO_BROWSER_FETCH_ID__',
              String(linuxDoBrowserFetchRequest.id)
            )}
            styles={styles}
            source={{ uri: linuxDoBrowserFetchRequest.url }}
            userAgent={linuxDoBrowserFetchRequest.userAgent || state.linuxDo.userAgent}
            onShouldStartLoadWithRequest={handleLinuxDoBrowserNavigation}
            clearHttpError={() => onLinuxDoHttpErrorStatus(linuxDoBrowserFetchRequest.id, undefined)}
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
                  isLinuxDoBrowserRequestPair(url, linuxDoBrowserFetchRequest.url)
                )
              ) {
                return;
              }
              onLinuxDoHttpErrorStatus(linuxDoBrowserFetchRequest.id, event.nativeEvent.statusCode);
            }}
            onRenderProcessGone={handleLinuxDoBrowserRenderProcessGone}
          />
        </View>
      ) : null}
    </>
  );
}
