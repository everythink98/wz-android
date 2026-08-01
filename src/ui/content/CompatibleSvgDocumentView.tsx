import React, { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import type { CompatibleSvgArtifact } from '@/platform/media/compatibleImageSources';

type CompatibleSvgDocumentViewProps = Readonly<{
  artifact: CompatibleSvgArtifact;
  style?: StyleProp<ViewStyle>;
  onLoad?: () => void;
  onError?: () => void;
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

export function CompatibleSvgDocumentView({ artifact, style, onLoad, onError }: CompatibleSvgDocumentViewProps) {
  const identity = `${artifact.requestIdentity}\u0000${artifact.documentDataUri}`;
  const settledIdentityRef = useRef(identity);
  const settlementOutcomeRef = useRef<'error' | 'load' | null>(null);

  const validDocumentDataUri = isSvgDocumentDataUri(artifact.documentDataUri);
  const source = useMemo(
    () => ({
      baseUrl: 'about:blank',
      html: compatibleSvgDocumentHtml(validDocumentDataUri ? artifact.documentDataUri : EMPTY_SVG_DATA_URI)
    }),
    [artifact.documentDataUri, validDocumentDataUri]
  );

  const settle = useCallback(
    (outcome: 'error' | 'load') => {
      if (settledIdentityRef.current !== identity || settlementOutcomeRef.current) {
        return;
      }
      settlementOutcomeRef.current = outcome;
      if (outcome === 'load') {
        onLoad?.();
      } else {
        onError?.();
      }
    },
    [identity, onError, onLoad]
  );

  useLayoutEffect(() => {
    if (settledIdentityRef.current === identity) {
      return;
    }
    settledIdentityRef.current = identity;
    settlementOutcomeRef.current = null;
  }, [identity]);

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
      if (event.nativeEvent.data === SVG_READY_MESSAGE) {
        settle('load');
      } else if (event.nativeEvent.data === SVG_ERROR_MESSAGE) {
        settle('error');
      }
    },
    [settle]
  );
  const handleError = useCallback(() => settle('error'), [settle]);

  return (
    <WebView
      testID="compatible-svg-document-view"
      source={source}
      containerStyle={style}
      style={[componentStyles.webView, style]}
      pointerEvents="none"
      originWhitelist={GUARDED_DOCUMENT_ORIGINS}
      onShouldStartLoadWithRequest={handleNavigation}
      onMessage={handleMessage}
      onError={handleError}
      onHttpError={handleError}
      onRenderProcessGone={handleError}
      onContentProcessDidTerminate={handleError}
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

function compatibleSvgDocumentHtml(documentDataUri: string) {
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
  let settled = false;
  const post = (message) => {
    if (settled) return;
    settled = true;
    window.ReactNativeWebView.postMessage(message);
  };
  const ready = () => requestAnimationFrame(() => requestAnimationFrame(() => post('${SVG_READY_MESSAGE}')));
  if (image.complete) {
    image.naturalWidth > 0 ? ready() : post('${SVG_ERROR_MESSAGE}');
  } else {
    image.addEventListener('load', ready, { once: true });
    image.addEventListener('error', () => post('${SVG_ERROR_MESSAGE}'), { once: true });
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

function escapeHtmlAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const componentStyles = StyleSheet.create({
  webView: {
    backgroundColor: 'transparent',
    flex: 1
  }
});
