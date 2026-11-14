export type TopicComposerPanel =
  'sites' | 'more' | 'options' | 'categories' | 'tags' | 'attachments' | 'images' | 'latest' | null;
type Context = Readonly<{ from: TopicComposerPanel; draftId: string | undefined }>;
export type TopicPanelRequest =
  | Readonly<Context & { kind: 'open'; target: TopicComposerPanel }>
  | Readonly<Context & { kind: 'pick' | 'insert' | 'rebase' }>;
type Work = { kind: 'idle' } | { kind: 'waiting'; request: TopicPanelRequest };

export function createTopicComposerPanels() {
  let panel: TopicComposerPanel = null;
  let work: Work = { kind: 'idle' };
  const owns = (request: TopicPanelRequest) =>
    work.kind === 'waiting' && work.request === request && panel === request.from;
  return {
    owns,
    get panel() {
      return panel;
    },
    opening(from: TopicComposerPanel, draftId: string | undefined, target: TopicComposerPanel) {
      if (work.kind === 'waiting') return null;
      const request = { kind: 'open' as const, from, draftId, target };
      work = { kind: 'waiting', request };
      return request;
    },
    working(kind: 'pick' | 'insert' | 'rebase', from: TopicComposerPanel, draftId: string | undefined) {
      if (work.kind === 'waiting') return null;
      const request = { kind, from, draftId };
      work = { kind: 'waiting', request };
      return request;
    },
    opened(request: Extract<TopicPanelRequest, { kind: 'open' }>) {
      if (!owns(request)) return false;
      panel = request.target;
      work = { kind: 'idle' };
      return true;
    },
    closed(request: TopicPanelRequest) {
      if (!owns(request)) return false;
      panel = null;
      work = { kind: 'idle' };
      return true;
    },
    finished(request: TopicPanelRequest) {
      if (work.kind === 'waiting' && work.request === request) work = { kind: 'idle' };
    },
    show(next: TopicComposerPanel) {
      work = { kind: 'idle' };
      panel = next;
    },
    cancel() {
      work = { kind: 'idle' };
    },
    uploadStarted() {
      if (panel === 'images' || panel === 'attachments') {
        work = { kind: 'idle' };
        panel = null;
      }
    }
  };
}
