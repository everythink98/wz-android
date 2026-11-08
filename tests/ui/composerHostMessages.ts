import type { render } from './render';
import type { ComposerHostMessage } from '@/ui/composer/structuredComposerBridge';

type Rendered = Awaited<ReturnType<typeof render>>;

export function postedMessages(webView: ReturnType<Rendered['getByTestId']>) {
  return webView.props.postMessageMock.mock.calls.map(([raw]: [string]) => JSON.parse(raw));
}

export function composerHostMessages(view: Rendered): ComposerHostMessage[] {
  return postedMessages(view.getByTestId('structured-composer-webview', { includeHiddenElements: true }));
}
