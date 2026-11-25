import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  TopicCreationContext,
  TopicCreationSource,
  TopicDraft,
  TopicEditContext
} from '@/domain/forum/topicComposer';
import { sourceErrorFromUnknown } from '@/sources/sourceErrors';
import { retryEmojiCatalog } from '@/sources/discourse/retryEmojiCatalog';
import { errorMessage } from '@/platform/network/errors';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';

type Failure = { kind: 'none' } | { kind: 'error' | 'verification'; message: string };
type ReadRun = { key: string; request: object; controller: AbortController };
type Rules =
  | { phase: 'idle'; preloaded: TopicCreationContext | null }
  | { phase: 'loading'; run: ReadRun }
  | { phase: 'ready'; key: string; request: object; context: TopicCreationContext }
  | { phase: 'failed'; key: string; request: object; failure: Exclude<Failure, { kind: 'none' }> };
type Emojis = { urls: Record<string, string> } & (
  { phase: 'idle' } | { phase: 'loading'; run: ReadRun } | { phase: 'ready'; key: string; request: object }
);
type State = { request: object; rules: Rules; editContext: TopicEditContext | null; emojis: Emojis };
export function useTopicDraftContext(input: {
  source: TopicCreationSource | null;
  identityKey: string;
  target: string;
  draft: TopicDraft | null;
  sessionEpoch: number;
  canRead: boolean;
  getDraft(): TopicDraft | null;
  readRules(
    value: TopicDraft,
    signal: AbortSignal
  ): Promise<{
    context: TopicCreationContext;
    editing: TopicEditContext | null;
  }>;
  readEmojis(signal: AbortSignal): Promise<Record<string, string>>;
  rulesReady(value: TopicDraft, context: TopicCreationContext): void;
}) {
  const inputRef = useCommittedRef(input);
  const key = JSON.stringify([input.source, input.identityKey, input.target, input.draft?.id, input.sessionEpoch]);
  const keyRef = useCommittedRef(key);
  const [snapshot, setSnapshot] = useState<State>({
    request: {},
    rules: { phase: 'idle', preloaded: null },
    editContext: null,
    emojis: { phase: 'idle', urls: {} }
  });
  const current = useRef(snapshot);
  const category = useRef<object | null>(null);
  const publish = useCallback((value: State) => {
    current.current = value;
    setSnapshot(value);
  }, []);
  const reset = useCallback(() => {
    const state = current.current;
    if (state.rules.phase === 'loading') state.rules.run.controller.abort();
    if (state.emojis.phase === 'loading') state.emojis.run.controller.abort();
    category.current = null;
    publish({
      request: {},
      rules: { phase: 'idle', preloaded: null },
      editContext: null,
      emojis: { phase: 'idle', urls: {} }
    });
  }, [publish]);
  const request = snapshot.request;
  const reload = useCallback(() => {
    const state = current.current;
    if (
      keyRef.current !== key ||
      state.request !== request ||
      (state.rules.phase !== 'ready' && state.rules.phase !== 'failed') ||
      state.rules.request !== request
    )
      return;
    publish({ ...state, request: {} });
  }, [key, keyRef, publish, request]);
  const installRestoredEdit = useCallback(
    (editing: TopicEditContext, verifiedDraftId?: string) => {
      const state = current.current;
      const { source, identityKey, target, sessionEpoch } = inputRef.current;
      publish({
        ...state,
        editContext: editing,
        rules: verifiedDraftId
          ? {
              phase: 'ready',
              key: JSON.stringify([source, identityKey, target, verifiedDraftId, sessionEpoch]),
              request: state.request,
              context: editing.rules
            }
          : { phase: 'idle', preloaded: editing.rules }
      });
    },
    [inputRef, publish]
  );
  const reviewedEdit = useCallback(
    (editing: TopicEditContext) => publish({ ...current.current, editContext: editing }),
    [publish]
  );
  const beginCategory = useCallback(() => {
    const run = { key: keyRef.current, request: current.current.request };
    category.current = run;
    return run;
  }, [keyRef]);
  const ownsCategory = useCallback(
    (run: { key: string; request: object }, draftId: string | undefined) =>
      category.current === run &&
      run.key === keyRef.current &&
      run.request === current.current.request &&
      inputRef.current.getDraft()?.id === draftId,
    [inputRef, keyRef]
  );
  const eligible =
    input.canRead &&
    Boolean(input.draft && input.draft.source === input.source && input.draft.identityKey === input.identityKey);
  useEffect(() => {
    if (!eligible) return;
    const state = current.current;
    if (state.rules.phase === 'ready' && state.rules.key === key && state.rules.request === request) return;
    const value = inputRef.current.getDraft();
    if (!value) return;
    const run: ReadRun = { key, request, controller: new AbortController() };
    publish({ ...state, rules: { phase: 'loading', run } });
    const owns = () =>
      current.current.rules.phase === 'loading' &&
      current.current.rules.run === run &&
      !run.controller.signal.aborted &&
      inputRef.current.canRead &&
      keyRef.current === run.key;
    const fail = (cause: unknown) => {
      if (!owns()) return;
      const kind = sourceErrorFromUnknown(value.source, cause).kind;
      publish({
        ...current.current,
        rules: {
          phase: 'failed',
          key,
          request,
          failure: {
            kind: ['verification-required', 'login-required', 'login-expired'].includes(kind)
              ? 'verification'
              : 'error',
            message: errorMessage(cause)
          }
        }
      });
    };
    void inputRef.current
      .readRules(value, run.controller.signal)
      .then((result) => {
        if (!owns()) return;
        publish({
          ...current.current,
          rules: { phase: 'ready', key, request, context: result.context },
          editContext: result.editing || current.current.editContext
        });
        if (keyRef.current === run.key) inputRef.current.rulesReady(value, result.context);
      })
      .catch(fail);
    return () => {
      run.controller.abort();
      if (current.current.rules.phase === 'loading' && current.current.rules.run === run)
        publish({ ...current.current, rules: { phase: 'idle', preloaded: null } });
    };
  }, [eligible, inputRef, key, keyRef, publish, request]);
  const rules = snapshot.rules;
  const context = rules.phase === 'ready' ? rules.context : rules.phase === 'idle' ? rules.preloaded : null;
  const readyKey = rules.phase === 'ready' ? rules.key : '';
  const readyRequest = rules.phase === 'ready' ? rules.request : undefined;
  useEffect(() => {
    if (!eligible || context?.source !== 'linuxdo' || !readyKey || !readyRequest) return;
    const state = current.current;
    if (state.emojis.phase === 'ready' && state.emojis.key === readyKey && state.emojis.request === readyRequest)
      return;
    const run: ReadRun = { key: readyKey, request: readyRequest, controller: new AbortController() };
    publish({ ...state, emojis: { phase: 'loading', run, urls: state.emojis.urls } });
    const owns = () =>
      current.current.emojis.phase === 'loading' &&
      current.current.emojis.run === run &&
      current.current.request === run.request &&
      current.current.rules.phase === 'ready' &&
      current.current.rules.request === run.request &&
      !run.controller.signal.aborted &&
      keyRef.current === run.key;
    void retryEmojiCatalog(() => inputRef.current.readEmojis(run.controller.signal), run.controller.signal).then(
      (urls) => {
        if (owns())
          publish({ ...current.current, emojis: { phase: 'ready', key: readyKey, request: readyRequest, urls } });
      },
      () => {
        if (owns()) publish({ ...current.current, emojis: { phase: 'idle', urls: {} } });
      }
    );
    return () => run.controller.abort();
  }, [context, eligible, inputRef, keyRef, publish, readyKey, readyRequest]);
  const failure: Failure = rules.phase === 'failed' ? rules.failure : { kind: 'none' };
  const requested =
    eligible && (rules.phase === 'ready' || rules.phase === 'failed') && rules.request !== snapshot.request;
  return {
    context,
    editContext: snapshot.editContext,
    contextLoading: rules.phase === 'loading' || requested,
    failure,
    emojiUrls: snapshot.emojis.urls,
    reload,
    reset,
    installRestoredEdit,
    reviewedEdit,
    beginCategory,
    ownsCategory
  };
}
