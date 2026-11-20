export type TopicComposerPanel =
  'sites' | 'more' | 'options' | 'categories' | 'tags' | 'attachments' | 'images' | 'latest' | null;
export type TopicPanelRequest =
  Readonly<{ kind: 'open'; target: TopicComposerPanel }> | Readonly<{ kind: 'pick' | 'insert' | 'rebase' }>;
type Work = { kind: 'idle' } | { kind: 'waiting'; request: TopicPanelRequest };

export function createTopicComposerPanels() {
  let presentation: Readonly<{ panel: TopicComposerPanel }> = { panel: null };
  let work: Work = { kind: 'idle' };
  const owns = (request: TopicPanelRequest) => work.kind === 'waiting' && work.request === request;
  return {
    owns,
    get presentation() {
      return presentation;
    },
    opening(target: TopicComposerPanel) {
      if (work.kind === 'waiting') return null;
      const request = { kind: 'open' as const, target };
      work = { kind: 'waiting', request };
      return request;
    },
    working(kind: 'pick' | 'insert' | 'rebase') {
      if (work.kind === 'waiting') return null;
      const request = { kind };
      work = { kind: 'waiting', request };
      return request;
    },
    opened(request: Extract<TopicPanelRequest, { kind: 'open' }>) {
      if (!owns(request)) return false;
      presentation = { panel: request.target };
      work = { kind: 'idle' };
      return true;
    },
    closed(request: TopicPanelRequest) {
      if (!owns(request)) return false;
      presentation = { panel: null };
      work = { kind: 'idle' };
      return true;
    },
    finished(request: TopicPanelRequest) {
      if (work.kind === 'waiting' && work.request === request) work = { kind: 'idle' };
    },
    show(next: TopicComposerPanel) {
      work = { kind: 'idle' };
      presentation = { panel: next };
    },
    cancel() {
      work = { kind: 'idle' };
    },
    uploadStarted() {
      if (presentation.panel === 'images' || presentation.panel === 'attachments') {
        work = { kind: 'idle' };
        presentation = { panel: null };
      }
    }
  };
}
