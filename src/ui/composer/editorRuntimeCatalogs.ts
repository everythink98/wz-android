import type { LinuxDoPollCapabilities } from '@/domain/forum/linuxDoPoll';

type Work = { kind: 'idle' } | { kind: 'pending'; request: Promise<unknown> } | { kind: 'retired' };
type PollResult =
  { kind: 'empty' } | { kind: 'loaded'; value: LinuxDoPollCapabilities } | { kind: 'failed'; error: string };
type PollSnapshot = Readonly<{ value: LinuxDoPollCapabilities | null; busy: boolean; error: string }>;

export function createEditorPollCapabilities() {
  let work: Work = { kind: 'idle' };
  let result: PollResult = { kind: 'empty' };
  let snapshot: PollSnapshot = { value: null, busy: false, error: '' };
  const owns = (request: Promise<unknown>) => work.kind === 'pending' && work.request === request;
  return {
    owns,
    get pending() {
      return work.kind === 'pending';
    },
    get value() {
      return result.kind === 'loaded' ? result.value : null;
    },
    get snapshot() {
      const value = result.kind === 'loaded' ? result.value : null;
      const error = result.kind === 'failed' ? result.error : '';
      const busy = work.kind !== 'idle';
      if (snapshot.value !== value || snapshot.error !== error || snapshot.busy !== busy)
        snapshot = { value, busy, error };
      return snapshot;
    },
    begin(request: Promise<unknown>) {
      work = { kind: 'pending', request };
      result = { kind: 'empty' };
    },
    received(request: Promise<unknown>, value: LinuxDoPollCapabilities) {
      if (!owns(request)) return false;
      result = { kind: 'loaded', value };
      return true;
    },
    failed(request: Promise<unknown>, error: string) {
      if (owns(request)) result = { kind: 'failed', error };
    },
    settled(request: Promise<unknown>) {
      if (owns(request)) work = { kind: 'idle' };
    },
    retire() {
      // Reconstructing the source view withdraws the observer, not its last published busy notice.
      if (work.kind === 'pending') work = { kind: 'retired' };
    },
    reset() {
      work = { kind: 'idle' };
      result = { kind: 'empty' };
    }
  };
}

type Template = { id: string; title: string; content: string };
type TemplateSnapshot = Readonly<{ templates: Template[]; busy: boolean }>;

export function createEditorTemplateCatalog() {
  let work: Work = { kind: 'idle' };
  let templates: Template[] = [];
  let snapshot: TemplateSnapshot = { templates, busy: false };
  const owns = (request: Promise<unknown>) => work.kind === 'pending' && work.request === request;
  return {
    owns,
    get snapshot() {
      const busy = work.kind !== 'idle';
      if (snapshot.templates !== templates || snapshot.busy !== busy) snapshot = { templates, busy };
      return snapshot;
    },
    begin(request: Promise<unknown>) {
      work = { kind: 'pending', request };
    },
    received(request: Promise<unknown>, next: Template[]) {
      if (owns(request)) templates = next;
    },
    settled(request: Promise<unknown>) {
      if (owns(request)) work = { kind: 'idle' };
    },
    retire() {
      if (work.kind === 'pending') work = { kind: 'retired' };
    },
    reset() {
      work = { kind: 'idle' };
      templates = [];
    }
  };
}
