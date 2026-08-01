import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { CompatibleSvgDocumentView } from '@/ui/content/CompatibleSvgDocumentView';

jest.mock('react-native-webview', () => {
  const ReactModule = require('react') as typeof React;
  const { View } = require('react-native') as typeof import('react-native');
  return {
    WebView: (props: Record<string, unknown>) => ReactModule.createElement(View, props)
  };
});

function artifact(documentDataUri = 'data:image/svg+xml;base64,PHN2Zy8+') {
  return { documentDataUri } as never;
}

function navigation(url: string) {
  return { isTopFrame: true, url };
}

describe('CompatibleSvgDocumentView', () => {
  it('[REG-TOPIC-038] renders one isolated local document with only a nonce-bound readiness bridge', async () => {
    const containerStyle = { bottom: 0, left: 0, position: 'absolute' as const, right: 0, top: 0 };
    const view = await render(<CompatibleSvgDocumentView artifact={artifact()} style={containerStyle} />);
    const webViews = view.getAllByTestId('compatible-svg-document-view');

    expect(webViews).toHaveLength(1);
    const props = webViews[0].props as Record<string, unknown>;
    const source = props.source as { baseUrl?: string; html?: string };
    const html = source.html || '';

    expect(source.baseUrl).toBe('about:blank');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('img-src data:');
    expect(html).toContain("script-src 'nonce-wz-svg-ready'");
    expect(html).toContain("style-src 'unsafe-inline'");
    expect(html).toContain('object-fit: contain');
    expect(html).toContain('background: transparent');
    expect(html).toContain('<img');
    expect(html).toContain('src="data:image/svg+xml;base64,PHN2Zy8+"');
    expect(html).toContain('<script nonce="wz-svg-ready">');
    expect(html).toContain('ReactNativeWebView.postMessage(message)');
    expect(html).toContain("post('wz-svg-ready')");
    expect(html).not.toMatch(/\b(?:eval|fetch|XMLHttpRequest)\s*\(/i);
    expect(html).not.toMatch(/https?:\/\//i);

    expect(props.androidLayerType).toBeUndefined();
    expect(props).toEqual(
      expect.objectContaining({
        allowFileAccess: false,
        allowFileAccessFromFileURLs: false,
        allowUniversalAccessFromFileURLs: false,
        cacheEnabled: false,
        domStorageEnabled: false,
        geolocationEnabled: false,
        incognito: false,
        javaScriptCanOpenWindowsAutomatically: false,
        javaScriptEnabled: true,
        mixedContentMode: 'never',
        pointerEvents: 'none',
        setSupportMultipleWindows: false,
        sharedCookiesEnabled: false,
        thirdPartyCookiesEnabled: false
      })
    );
    expect(props.containerStyle).toBe(containerStyle);
    expect(props.originWhitelist).toEqual(['*']);
    expect(props.injectedJavaScript).toBeUndefined();
    expect(props.injectedJavaScriptBeforeContentLoaded).toBeUndefined();
    expect(props.onMessage).toEqual(expect.any(Function));
  });

  it('[REG-TOPIC-038] permits only the local bootstrap document and rejects every external navigation scheme', async () => {
    const view = await render(<CompatibleSvgDocumentView artifact={artifact()} />);
    const guard = view.getByTestId('compatible-svg-document-view').props.onShouldStartLoadWithRequest as (request: {
      isTopFrame: boolean;
      url: string;
    }) => boolean;

    expect(guard(navigation('about:blank'))).toBe(true);
    expect(guard(navigation('data:text/html;charset=utf-8,%3Chtml%3E'))).toBe(false);
    expect(guard(navigation('data:image/svg+xml;base64,PHN2Zy8+'))).toBe(false);
    expect(guard(navigation('https://example.com/tracker'))).toBe(false);
    expect(guard(navigation('http://example.com/tracker'))).toBe(false);
    expect(guard(navigation('file:///sdcard/private.txt'))).toBe(false);
    expect(guard(navigation('content://media/external/images/1'))).toBe(false);
    expect(guard(navigation('javascript:alert(1)'))).toBe(false);
    expect(guard({ isTopFrame: false, url: 'about:blank' })).toBe(false);
  });

  it('[REG-TOPIC-038] fails closed before a forged artifact can become a remote image request', async () => {
    const onError = jest.fn();
    const view = await render(
      <React.StrictMode>
        <CompatibleSvgDocumentView artifact={artifact('https://example.com/not-an-artifact.svg')} onError={onError} />
      </React.StrictMode>
    );
    const source = view.getByTestId('compatible-svg-document-view').props.source as { html: string };

    expect(source.html).not.toContain('https://example.com/not-an-artifact.svg');
    expect(source.html).toContain(EMPTY_SVG_DATA_URI_FOR_TEST);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('[REG-TOPIC-038] settles exactly once for one artifact and ignores stale events after replacement', async () => {
    const firstLoad = jest.fn();
    const firstError = jest.fn();
    const nextLoad = jest.fn();
    const nextError = jest.fn();
    const view = await render(
      <CompatibleSvgDocumentView
        artifact={artifact('data:image/svg+xml;base64,Zmlyc3Q=')}
        onError={firstError}
        onLoad={firstLoad}
      />
    );
    const firstView = view.getByTestId('compatible-svg-document-view');
    const staleLoad = firstView.props.onMessage as (event: { nativeEvent: { data: string } }) => void;
    const staleError = firstView.props.onError as () => void;

    await fireEvent(firstView, 'message', { nativeEvent: { data: 'wz-svg-ready' } });
    await fireEvent(firstView, 'error');
    await fireEvent(firstView, 'httpError');
    expect(firstLoad).toHaveBeenCalledTimes(1);
    expect(firstError).not.toHaveBeenCalled();

    await view.rerender(
      <CompatibleSvgDocumentView
        artifact={artifact('data:image/svg+xml;base64,c2Vjb25k')}
        onError={nextError}
        onLoad={nextLoad}
      />
    );
    staleLoad({ nativeEvent: { data: 'wz-svg-ready' } });
    staleError();
    expect(firstLoad).toHaveBeenCalledTimes(1);
    expect(firstError).not.toHaveBeenCalled();
    expect(nextLoad).not.toHaveBeenCalled();
    expect(nextError).not.toHaveBeenCalled();

    const nextView = view.getByTestId('compatible-svg-document-view');
    await fireEvent(nextView, 'error');
    await fireEvent(nextView, 'message', { nativeEvent: { data: 'wz-svg-ready' } });
    expect(nextError).toHaveBeenCalledTimes(1);
    expect(nextLoad).not.toHaveBeenCalled();
  });
});

const EMPTY_SVG_DATA_URI_FOR_TEST = 'data:image/svg+xml;base64,PHN2Zy8+';
