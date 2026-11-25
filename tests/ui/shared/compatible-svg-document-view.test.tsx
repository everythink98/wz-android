import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';
import { runInNewContext } from 'node:vm';
import { CompatibleSvgDocumentView } from '@/ui/content/CompatibleSvgDocumentView';

let mockWebViewNextToken = 0;

jest.mock('react-native-webview', () => {
  const ReactModule = require('react') as typeof React;
  const { View } = require('react-native') as typeof import('react-native');
  const WebViewMock = View as React.ComponentType<Record<string, unknown>>;
  return {
    WebView: (props: Record<string, unknown>) => {
      const token = ReactModule.useRef(0);
      if (token.current === 0) {
        token.current = ++mockWebViewNextToken;
      }
      return ReactModule.createElement(WebViewMock, { ...props, mockWebViewToken: token.current });
    }
  };
});

function artifact(documentDataUri = 'data:image/svg+xml;base64,PHN2Zy8+', requestIdentity?: string) {
  return { documentDataUri, ...(requestIdentity === undefined ? {} : { requestIdentity }) } as never;
}

function postedMessagesFromHtml(html: string) {
  const ready = /ready\s*=\s*\(\)\s*=>[\s\S]*?post\('([^']+)'\)/.exec(html)?.[1];
  const error = /addEventListener\('error',\s*\(\)\s*=>\s*post\('([^']+)'\)/.exec(html)?.[1];
  if (!ready || !error) {
    throw new Error('Missing SVG readiness bridge messages');
  }
  return { error, ready };
}

function navigation(url: string) {
  return { isTopFrame: true, url };
}

describe('CompatibleSvgDocumentView', () => {
  beforeEach(() => {
    mockWebViewNextToken = 0;
  });

  it('consumes document delivery before reentrant bridge access and a thrown post', async () => {
    const view = await render(<CompatibleSvgDocumentView artifact={artifact()} />);
    const html = String(view.getByTestId('compatible-svg-document-view').props.source.html);
    const messages = postedMessagesFromHtml(html);
    const script = /<script nonce="wz-svg-ready">([\s\S]*?)<\/script>/.exec(html)?.[1];
    if (!script) throw new Error('Missing SVG bootstrap script');
    const listeners = new Map<string, () => void>();
    const frames: (() => void)[] = [];
    const calls: string[] = [];
    const failure = new Error('bridge unavailable');
    const reenter = () => listeners.get('error')?.();
    runInNewContext(script, {
      document: {
        querySelector: () => ({
          complete: false,
          addEventListener: (name: string, listener: () => void) => listeners.set(name, listener)
        })
      },
      requestAnimationFrame: (callback: () => void) => frames.push(callback),
      window: {
        get ReactNativeWebView() {
          calls.push('bridge');
          reenter();
          return {
            get postMessage() {
              calls.push('method');
              reenter();
              return (message: string) => {
                calls.push(message);
                reenter();
                throw failure;
              };
            }
          };
        }
      }
    });
    const load = listeners.get('load');
    const error = listeners.get('error');
    if (!load || !error) throw new Error('Missing image listeners');
    load();
    expect(frames).toHaveLength(1);
    let thrown: unknown;
    try {
      error();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(failure);
    frames.shift()?.();
    expect(frames).toHaveLength(1);
    frames.shift()?.();
    error();
    expect(frames).toHaveLength(0);
    expect(calls).toEqual(['bridge', 'method', messages.error]);
  });

  it('renders one isolated local document with only a nonce-bound readiness bridge', async () => {
    const containerStyle = { bottom: 0, left: 0, position: 'absolute' as const, right: 0, top: 0 };
    const view = await render(<CompatibleSvgDocumentView artifact={artifact()} style={containerStyle} />);
    const container = view.getByTestId('compatible-svg-document-container');
    const webViews = view.getAllByTestId('compatible-svg-document-view');

    expect(webViews).toHaveLength(1);
    const props = webViews[0].props as Record<string, unknown>;
    const source = props.source as { baseUrl?: string; html?: string };
    const html = source.html || '';
    const messages = postedMessagesFromHtml(html);

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
    expect(messages.ready).toMatch(/^wz-svg-ready:\d+$/);
    expect(messages.error).toMatch(/^wz-svg-error:\d+$/);
    expect(html).toContain(`post('${messages.ready}')`);
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
    expect(StyleSheet.flatten(container.props.style)).toMatchObject(containerStyle);
    expect(StyleSheet.flatten(props.containerStyle as never)).toEqual({ backgroundColor: 'transparent', flex: 1 });
    expect(StyleSheet.flatten(props.style as never)).toEqual({ backgroundColor: 'transparent', flex: 1 });
    expect(props.originWhitelist).toEqual(['*']);
    expect(props.injectedJavaScript).toBeUndefined();
    expect(props.injectedJavaScriptBeforeContentLoaded).toBeUndefined();
    expect(props.onMessage).toEqual(expect.any(Function));
  });

  it('permits only the local bootstrap document and rejects every external navigation scheme', async () => {
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

  it('fails closed before a forged artifact can become a remote image request', async () => {
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

  it('settles exactly once for one artifact and ignores stale events after replacement', async () => {
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
    const firstMessages = postedMessagesFromHtml(String(firstView.props.source.html));
    const staleLoad = firstView.props.onMessage as (event: { nativeEvent: { data: string } }) => void;
    const staleError = firstView.props.onError as () => void;

    await fireEvent(firstView, 'message', { nativeEvent: { data: firstMessages.ready } });
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
    staleLoad({ nativeEvent: { data: firstMessages.ready } });
    staleError();
    expect(firstLoad).toHaveBeenCalledTimes(1);
    expect(firstError).not.toHaveBeenCalled();
    expect(nextLoad).not.toHaveBeenCalled();
    expect(nextError).not.toHaveBeenCalled();

    const nextView = view.getByTestId('compatible-svg-document-view');
    const nextMessages = postedMessagesFromHtml(String(nextView.props.source.html));
    await fireEvent(nextView, 'error');
    await fireEvent(nextView, 'message', { nativeEvent: { data: nextMessages.ready } });
    expect(nextError).toHaveBeenCalledTimes(1);
    expect(nextLoad).not.toHaveBeenCalled();
  });

  it('remounts the inner WebView across A -> B -> A and blocks stale messages delivered to the current callback', async () => {
    const artifactA = artifact('data:image/svg+xml;base64,QQ==', 'svg-a');
    const artifactB = artifact('data:image/svg+xml;base64,Qg==', 'svg-b');
    const firstALoad = jest.fn();
    const firstAError = jest.fn();
    const bLoad = jest.fn();
    const bError = jest.fn();
    const secondALoad = jest.fn();
    const secondAError = jest.fn();

    const view = await render(
      <CompatibleSvgDocumentView artifact={artifactA} onError={firstAError} onLoad={firstALoad} />
    );
    const firstAView = view.getByTestId('compatible-svg-document-view');
    const firstAToken = firstAView.props.mockWebViewToken;
    const firstAMessages = postedMessagesFromHtml(String(firstAView.props.source.html));
    const staleFirstAMessage = firstAView.props.onMessage as (event: { nativeEvent: { data: string } }) => void;
    const staleFirstAError = firstAView.props.onError as () => void;

    await view.rerender(<CompatibleSvgDocumentView artifact={artifactB} onError={bError} onLoad={bLoad} />);
    const bView = view.getByTestId('compatible-svg-document-view');
    const bToken = bView.props.mockWebViewToken;
    const bMessages = postedMessagesFromHtml(String(bView.props.source.html));

    await view.rerender(<CompatibleSvgDocumentView artifact={artifactA} onError={secondAError} onLoad={secondALoad} />);
    const secondAView = view.getByTestId('compatible-svg-document-view');
    const secondAToken = secondAView.props.mockWebViewToken;
    const secondAMessages = postedMessagesFromHtml(String(secondAView.props.source.html));

    await fireEvent(secondAView, 'message', { nativeEvent: { data: firstAMessages.ready } });
    await fireEvent(secondAView, 'message', { nativeEvent: { data: firstAMessages.error } });
    await fireEvent(secondAView, 'message', { nativeEvent: { data: bMessages.ready } });
    await fireEvent(secondAView, 'message', { nativeEvent: { data: 'wz-svg-ready' } });
    staleFirstAMessage({ nativeEvent: { data: firstAMessages.ready } });
    staleFirstAError();

    expect(secondALoad).not.toHaveBeenCalled();
    expect(secondAError).not.toHaveBeenCalled();
    expect(firstALoad).not.toHaveBeenCalled();
    expect(firstAError).not.toHaveBeenCalled();
    expect(bLoad).not.toHaveBeenCalled();
    expect(bError).not.toHaveBeenCalled();
    expect(bToken).not.toBe(firstAToken);
    expect(secondAToken).not.toBe(firstAToken);
    expect(secondAToken).not.toBe(bToken);

    await fireEvent(secondAView, 'message', { nativeEvent: { data: secondAMessages.ready } });
    await fireEvent(secondAView, 'message', { nativeEvent: { data: secondAMessages.ready } });
    await fireEvent(secondAView, 'error');

    expect(secondALoad).toHaveBeenCalledTimes(1);
    expect(secondAError).not.toHaveBeenCalled();
  });

  it('owns layout and opacity on the outer container without remounting the inner WebView on style updates', async () => {
    const svg = artifact('data:image/svg+xml;base64,QQ==', 'svg-layout');
    const view = await render(
      <CompatibleSvgDocumentView artifact={svg} style={[StyleSheet.absoluteFill, { opacity: 0 }]} />
    );
    const container = view.getByTestId('compatible-svg-document-container');
    const webView = view.getByTestId('compatible-svg-document-view');
    const initialToken = webView.props.mockWebViewToken;

    expect(webView.parent).toBe(container);
    expect(container.props.pointerEvents).toBe('none');
    expect(StyleSheet.flatten(container.props.style)).toMatchObject({
      ...StyleSheet.absoluteFill,
      opacity: 0
    });
    expect(StyleSheet.flatten(webView.props.containerStyle)).toEqual({ backgroundColor: 'transparent', flex: 1 });
    expect(StyleSheet.flatten(webView.props.style)).toEqual({ backgroundColor: 'transparent', flex: 1 });

    await view.rerender(<CompatibleSvgDocumentView artifact={svg} style={[StyleSheet.absoluteFill, { opacity: 1 }]} />);

    expect(view.getByTestId('compatible-svg-document-view').props.mockWebViewToken).toBe(initialToken);
    expect(StyleSheet.flatten(view.getByTestId('compatible-svg-document-container').props.style)).toMatchObject({
      ...StyleSheet.absoluteFill,
      opacity: 1
    });
  });

  it('reports post-ready renderer exits separately from initial load settlement and unmounts the dead WebView', async () => {
    const onLoad = jest.fn();
    const onError = jest.fn();
    const onRenderProcessGone = jest.fn();
    const view = await render(
      <CompatibleSvgDocumentView
        artifact={artifact('data:image/svg+xml;base64,QQ==', 'svg-post-ready-exit')}
        onError={onError}
        onLoad={onLoad}
        onRenderProcessGone={onRenderProcessGone}
      />
    );
    const webView = view.getByTestId('compatible-svg-document-view');
    const messages = postedMessagesFromHtml(String(webView.props.source.html));
    const staleRenderProcessGone = webView.props.onRenderProcessGone as (event: {
      nativeEvent: { didCrash: boolean };
    }) => void;
    const staleMessage = webView.props.onMessage as (event: { nativeEvent: { data: string } }) => void;
    const staleError = webView.props.onError as () => void;

    await fireEvent(webView, 'message', { nativeEvent: { data: messages.ready } });
    await fireEvent(webView, 'error');
    await fireEvent(webView, 'httpError');
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(onRenderProcessGone).not.toHaveBeenCalled();

    await fireEvent(webView, 'renderProcessGone', { nativeEvent: { didCrash: true } });
    expect(onRenderProcessGone).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(view.queryByTestId('compatible-svg-document-view')).toBeNull();

    staleRenderProcessGone({ nativeEvent: { didCrash: true } });
    staleMessage({ nativeEvent: { data: messages.ready } });
    staleError();
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(onRenderProcessGone).toHaveBeenCalledTimes(1);

    const fallbackLoad = jest.fn();
    const fallbackError = jest.fn();
    const fallbackView = await render(
      <CompatibleSvgDocumentView
        artifact={artifact('data:image/svg+xml;base64,Qg==', 'svg-post-ready-fallback')}
        onError={fallbackError}
        onLoad={fallbackLoad}
      />
    );
    const fallbackWebView = fallbackView.getByTestId('compatible-svg-document-view');
    const fallbackMessages = postedMessagesFromHtml(String(fallbackWebView.props.source.html));
    await fireEvent(fallbackWebView, 'message', { nativeEvent: { data: fallbackMessages.ready } });
    await fireEvent(fallbackWebView, 'contentProcessDidTerminate');
    expect(fallbackLoad).toHaveBeenCalledTimes(1);
    expect(fallbackError).toHaveBeenCalledTimes(1);
    expect(fallbackView.queryByTestId('compatible-svg-document-view')).toBeNull();
  });

  it('isolates stale renderer exits across A -> B -> A and supports repeated exits on remounted instances', async () => {
    const artifactA = artifact('data:image/svg+xml;base64,QQ==', 'svg-exit-a');
    const artifactB = artifact('data:image/svg+xml;base64,Qg==', 'svg-exit-b');
    const firstALoad = jest.fn();
    const firstAExit = jest.fn();
    const bLoad = jest.fn();
    const bExit = jest.fn();
    const secondALoad = jest.fn();
    const secondAExit = jest.fn();

    const view = await render(
      <CompatibleSvgDocumentView artifact={artifactA} onLoad={firstALoad} onRenderProcessGone={firstAExit} />
    );
    const firstAView = view.getByTestId('compatible-svg-document-view');
    const firstAToken = firstAView.props.mockWebViewToken;
    const firstAMessages = postedMessagesFromHtml(String(firstAView.props.source.html));
    const staleFirstAExit = firstAView.props.onRenderProcessGone as (event: {
      nativeEvent: { didCrash: boolean };
    }) => void;
    const staleFirstAMessage = firstAView.props.onMessage as (event: { nativeEvent: { data: string } }) => void;

    await fireEvent(firstAView, 'message', { nativeEvent: { data: firstAMessages.ready } });
    expect(firstALoad).toHaveBeenCalledTimes(1);

    await view.rerender(<CompatibleSvgDocumentView artifact={artifactB} onLoad={bLoad} onRenderProcessGone={bExit} />);
    const bView = view.getByTestId('compatible-svg-document-view');
    const staleBExit = bView.props.onRenderProcessGone as (event: { nativeEvent: { didCrash: boolean } }) => void;

    await view.rerender(
      <CompatibleSvgDocumentView artifact={artifactA} onLoad={secondALoad} onRenderProcessGone={secondAExit} />
    );
    const secondAView = view.getByTestId('compatible-svg-document-view');
    const secondAToken = secondAView.props.mockWebViewToken;
    const secondAMessages = postedMessagesFromHtml(String(secondAView.props.source.html));

    staleFirstAExit({ nativeEvent: { didCrash: true } });
    staleBExit({ nativeEvent: { didCrash: true } });
    staleFirstAMessage({ nativeEvent: { data: firstAMessages.ready } });
    await fireEvent(secondAView, 'message', { nativeEvent: { data: firstAMessages.ready } });

    expect(secondAToken).not.toBe(firstAToken);
    expect(firstAExit).not.toHaveBeenCalled();
    expect(bExit).not.toHaveBeenCalled();
    expect(secondALoad).not.toHaveBeenCalled();
    expect(secondAExit).not.toHaveBeenCalled();
    expect(view.getByTestId('compatible-svg-document-view').props.mockWebViewToken).toBe(secondAToken);

    await fireEvent(secondAView, 'message', { nativeEvent: { data: secondAMessages.ready } });
    expect(secondALoad).toHaveBeenCalledTimes(1);

    staleFirstAExit({ nativeEvent: { didCrash: true } });
    staleBExit({ nativeEvent: { didCrash: true } });
    expect(secondAExit).not.toHaveBeenCalled();
    expect(view.getByTestId('compatible-svg-document-view').props.mockWebViewToken).toBe(secondAToken);

    await fireEvent(secondAView, 'renderProcessGone', { nativeEvent: { didCrash: true } });
    expect(secondAExit).toHaveBeenCalledTimes(1);
    expect(view.queryByTestId('compatible-svg-document-view')).toBeNull();

    const thirdALoad = jest.fn();
    const thirdAExit = jest.fn();
    await view.rerender(
      <CompatibleSvgDocumentView
        key="retry-instance"
        artifact={artifactA}
        onLoad={thirdALoad}
        onRenderProcessGone={thirdAExit}
      />
    );
    const thirdAView = view.getByTestId('compatible-svg-document-view');
    const thirdAToken = thirdAView.props.mockWebViewToken;
    const thirdAMessages = postedMessagesFromHtml(String(thirdAView.props.source.html));
    expect(thirdAToken).not.toBe(secondAToken);

    await fireEvent(thirdAView, 'message', { nativeEvent: { data: thirdAMessages.ready } });
    expect(thirdALoad).toHaveBeenCalledTimes(1);
    await fireEvent(thirdAView, 'renderProcessGone', { nativeEvent: { didCrash: true } });
    expect(thirdAExit).toHaveBeenCalledTimes(1);
    expect(view.queryByTestId('compatible-svg-document-view')).toBeNull();
  });
});

const EMPTY_SVG_DATA_URI_FOR_TEST = 'data:image/svg+xml;base64,PHN2Zy8+';
