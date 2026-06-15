import type { RefObject } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { LINUXDO_BROWSER_FETCH_SCRIPT, NODESEEK_BROWSER_FETCH_SCRIPT } from './useHiddenBrowserFetchController';
import type { LinuxDoBrowserFetchRequest, NodeSeekBrowserFetchRequest } from './useSessionController';
import type { createStyles } from '../theme';

export function HiddenBrowserHost({
  failLinuxDoBrowserFetchById,
  failNodeSeekBrowserFetchById,
  handleLinuxDoBrowserFetchMessage,
  handleNodeSeekBrowserFetchMessage,
  linuxDoBrowserFetchRequest,
  linuxDoBrowserWebViewRef,
  linuxDoWebViewUserAgent,
  nodeSeekBrowserFetchRequest,
  nodeSeekBrowserWebViewRef,
  nodeSeekWebViewUserAgent,
  onLinuxDoHttpErrorStatus,
  onNodeSeekHttpErrorStatus,
  styles
}: {
  failLinuxDoBrowserFetchById: (requestId: number, message: string) => void;
  failNodeSeekBrowserFetchById: (requestId: number, message: string) => void;
  handleLinuxDoBrowserFetchMessage: (event: WebViewMessageEvent) => void;
  handleNodeSeekBrowserFetchMessage: (event: WebViewMessageEvent) => void;
  linuxDoBrowserFetchRequest: LinuxDoBrowserFetchRequest | null;
  linuxDoBrowserWebViewRef: RefObject<WebView | null>;
  linuxDoWebViewUserAgent: string;
  nodeSeekBrowserFetchRequest: NodeSeekBrowserFetchRequest | null;
  nodeSeekBrowserWebViewRef: RefObject<WebView | null>;
  nodeSeekWebViewUserAgent: string;
  onLinuxDoHttpErrorStatus: (requestId: number, statusCode: number) => void;
  onNodeSeekHttpErrorStatus: (requestId: number, statusCode: number) => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <>
      {nodeSeekBrowserFetchRequest ? (
        <View pointerEvents="none" style={styles.hiddenBrowserWebViewHost}>
          <WebView
            key={`nodeseek-browser-fetch-${nodeSeekBrowserFetchRequest.id}`}
            ref={nodeSeekBrowserWebViewRef}
            source={{
              uri: nodeSeekBrowserFetchRequest.url,
              headers: nodeSeekBrowserFetchRequest.cookie ? { Cookie: nodeSeekBrowserFetchRequest.cookie } : undefined
            }}
            javaScriptEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            userAgent={nodeSeekBrowserFetchRequest.userAgent || nodeSeekWebViewUserAgent}
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
              if (event.nativeEvent.url !== nodeSeekBrowserFetchRequest.url) {
                return;
              }
              if (event.nativeEvent.statusCode === 403 || event.nativeEvent.statusCode === 404) {
                onNodeSeekHttpErrorStatus(nodeSeekBrowserFetchRequest.id, event.nativeEvent.statusCode);
                return;
              }
              failNodeSeekBrowserFetchById(nodeSeekBrowserFetchRequest.id, `NodeSeek 页面返回错误 ${event.nativeEvent.statusCode}`);
            }}
            onRenderProcessGone={() => {
              failNodeSeekBrowserFetchById(nodeSeekBrowserFetchRequest.id, 'NodeSeek 页面读取进程已停止');
            }}
            renderError={() => <View style={styles.hiddenBrowserWebView} />}
          />
        </View>
      ) : null}
      {linuxDoBrowserFetchRequest ? (
        <View pointerEvents="none" style={styles.hiddenBrowserWebViewHost}>
          <WebView
            key={`linuxdo-browser-fetch-${linuxDoBrowserFetchRequest.id}`}
            ref={linuxDoBrowserWebViewRef}
            source={{
              uri: linuxDoBrowserFetchRequest.url,
              headers: linuxDoBrowserFetchRequest.cookie ? { Cookie: linuxDoBrowserFetchRequest.cookie } : undefined
            }}
            javaScriptEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            userAgent={linuxDoBrowserFetchRequest.userAgent || linuxDoWebViewUserAgent}
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
              if (event.nativeEvent.url !== linuxDoBrowserFetchRequest.url) {
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
