import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import type { CompatibleSvgArtifact } from '@/platform/media/compatibleImageSources';
import { escapeHtmlAttribute } from '@/domain/forum/html';

type CompatibleSvgDocumentViewProps = Readonly<{
  artifact: CompatibleSvgArtifact;
  style?: StyleProp<ViewStyle>;
  onLoad?: () => void;
  onError?: () => void;
  onRenderProcessGone?: () => void;
}>;

type CompatibleSvgDocumentFrameProps = Readonly<{
  documentDataUri: string;
  onLoad?: () => void;
  onError?: () => void;
  onRenderProcessGone?: () => void;
}>;

type CompatibleSvgNavigationRequest = Readonly<{
  isTopFrame?: boolean;
  url: string;
}>;

type CompatibleSvgMessageEvent = Readonly<{
  nativeEvent: Readonly<{ data?: string }>;
}>;

const EMPTY_SVG_DATA_URI = 'data:image/svg+xml;base64,PHN2Zy8+';
const GUARDED_DOCUMENT_ORIGINS = ['*'];
const SVG_READY_MESSAGE = 'wz-svg-ready';
const SVG_ERROR_MESSAGE = 'wz-svg-error';

let nextDocumentInstanceId = 0;

export function CompatibleSvgDocumentView({
  artifact,
  style,
  onLoad,
  onError,
  onRenderProcessGone
}: CompatibleSvgDocumentViewProps) {
  const identity = `${artifact.requestIdentity}\u0000${artifact.documentDataUri}`;
  return (
    <View testID="compatible-svg-document-container" pointerEvents="none" style={[componentStyles.container, style]}>
      <CompatibleSvgDocumentFrame
        key={identity}
        documentDataUri={artifact.documentDataUri}
        onError={onError}
        onLoad={onLoad}
        onRenderProcessGone={onRenderProcessGone}
      />
    </View>
  );
}

function CompatibleSvgDocumentFrame({
  documentDataUri,
  onLoad,
  onError,
  onRenderProcessGone
}: CompatibleSvgDocumentFrameProps) {
  const [instanceId] = useState(() => {
    nextDocumentInstanceId += 1;
    return String(nextDocumentInstanceId);
  });
  const [rendererExited, setRendererExited] = useState(false);
  const activeRef = useRef(true);
  const initialSettlementRef = useRef<'pending' | 'load' | 'error'>('pending');
  const rendererExitedRef = useRef(false);
  const readyMessage = `${SVG_READY_MESSAGE}:${instanceId}`;
  const errorMessage = `${SVG_ERROR_MESSAGE}:${instanceId}`;

  const validDocumentDataUri = isSvgDocumentDataUri(documentDataUri);
  const source = useMemo(
    () => ({
      baseUrl: 'about:blank',
      html: compatibleSvgDocumentHtml(
        validDocumentDataUri ? documentDataUri : EMPTY_SVG_DATA_URI,
        readyMessage,
        errorMessage
      )
    }),
    [documentDataUri, errorMessage, readyMessage, validDocumentDataUri]
  );

  const settle = useCallback(
    (outcome: 'error' | 'load') => {
      if (!activeRef.current || rendererExitedRef.current || initialSettlementRef.current !== 'pending') {
        return;
      }
      initialSettlementRef.current = outcome;
      if (outcome === 'load') {
        onLoad?.();
      } else {
        onError?.();
      }
    },
    [onError, onLoad]
  );

  useLayoutEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    if (!validDocumentDataUri) {
      settle('error');
    }
  }, [settle, validDocumentDataUri]);

  const handleNavigation = useCallback(
    (request: CompatibleSvgNavigationRequest) =>
      request.isTopFrame !== false && isLocalBootstrapDocumentUrl(request.url),
    []
  );
  const handleMessage = useCallback(
    (event: CompatibleSvgMessageEvent) => {
      if (event.nativeEvent.data === readyMessage) {
        settle('load');
      } else if (event.nativeEvent.data === errorMessage) {
        settle('error');
      }
    },
    [errorMessage, readyMessage, settle]
  );
  const handleError = useCallback(() => settle('error'), [settle]);
  const handleRenderProcessGone = useCallback(() => {
    if (!activeRef.current || rendererExitedRef.current) {
      return;
    }
    rendererExitedRef.current = true;
    setRendererExited(true);
    if (initialSettlementRef.current === 'error') return;
    if (initialSettlementRef.current === 'pending') initialSettlementRef.current = 'error';
    (onRenderProcessGone ?? onError)?.();
  }, [onError, onRenderProcessGone]);

  if (rendererExited) {
    return null;
  }

  return (
    <WebView
      testID="compatible-svg-document-view"
      source={source}
      containerStyle={componentStyles.webView}
      style={componentStyles.webView}
      pointerEvents="none"
      originWhitelist={GUARDED_DOCUMENT_ORIGINS}
      onShouldStartLoadWithRequest={handleNavigation}
      onMessage={handleMessage}
      onError={handleError}
      onHttpError={handleError}
      onRenderProcessGone={handleRenderProcessGone}
      onContentProcessDidTerminate={handleRenderProcessGone}
      javaScriptEnabled
      javaScriptCanOpenWindowsAutomatically={false}
      domStorageEnabled={false}
      geolocationEnabled={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      setSupportMultipleWindows={false}
      mixedContentMode="never"
      cacheEnabled={false}
      incognito={false}
      scrollEnabled={false}
      bounces={false}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
    />
  );
}

function compatibleSvgDocumentHtml(documentDataUri: string, readyMessage: string, errorMessage: string) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; connect-src 'none'; font-src 'none'; form-action 'none'; frame-src 'none'; media-src 'none'; object-src 'none'; script-src 'nonce-wz-svg-ready'; worker-src 'none'">
<style>
html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }
body { display: flex; align-items: center; justify-content: center; }
img { display: block; width: 100%; height: 100%; object-fit: contain; background: transparent; }
</style>
</head>
<body>
<img alt="" src="${escapeHtmlAttribute(documentDataUri)}">
<script nonce="wz-svg-ready">
(() => {
  const image = document.querySelector('img');
  /** @type {'available' | 'consumed'} */
  let delivery = 'available';
  const post = (message) => {
    if (delivery === 'consumed') return;
    delivery = 'consumed';
    window.ReactNativeWebView.postMessage(message);
  };
  const ready = () => requestAnimationFrame(() => requestAnimationFrame(() => post('${readyMessage}')));
  if (image.complete) {
    image.naturalWidth > 0 ? ready() : post('${errorMessage}');
  } else {
    image.addEventListener('load', ready, { once: true });
    image.addEventListener('error', () => post('${errorMessage}'), { once: true });
  }
})();
</script>
</body>
</html>`;
}

function isSvgDocumentDataUri(value: string) {
  return /^data:image\/svg\+xml;base64,[a-z0-9+/]+={0,2}$/i.test(value);
}

function isLocalBootstrapDocumentUrl(value: string) {
  const url = String(value || '').trim();
  return /^about:blank$/i.test(url);
}

const componentStyles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden'
  },
  webView: {
    backgroundColor: 'transparent',
    flex: 1
  }
});
