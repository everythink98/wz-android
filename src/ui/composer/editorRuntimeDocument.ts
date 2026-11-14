import type { ComposerHostMessage } from './structuredComposerBridge';

type Config = Extract<ComposerHostMessage, { type: 'INIT' }>['payload'];
type Document =
  { kind: 'empty' } | { kind: 'installing' | 'ready'; config: Config } | { kind: 'destroyed'; config: Config | null };

export function createEditorRuntimeDocument() {
  let document: Document = { kind: 'empty' };
  let generation = 0;
  return {
    get config() {
      return document.kind === 'empty' ? null : document.config;
    },
    get renderConfig() {
      return document.kind === 'ready' ? document.config : null;
    },
    get initialized() {
      return document.kind === 'ready';
    },
    get generation() {
      return generation;
    },
    retireRequests() {
      // Source-view effect reconstruction retires requests without discarding the installed document.
      generation += 1;
    },
    installing(config: Config) {
      document = { kind: 'installing', config };
    },
    installed() {
      if (document.kind === 'installing') document = { kind: 'ready', config: document.config };
    },
    readOnlyChanged(readOnly: boolean) {
      if (document.kind !== 'ready') return null;
      const config = { ...document.config, readOnly };
      document = { kind: 'ready', config };
      return config;
    },
    emojiChanged(discourseEmoji: Config['discourseEmoji']) {
      if (document.kind !== 'ready') return null;
      const config = { ...document.config, discourseEmoji };
      document = { kind: 'ready', config };
      return config;
    },
    destroyed() {
      document = { kind: 'destroyed', config: document.kind === 'empty' ? null : document.config };
    }
  };
}
