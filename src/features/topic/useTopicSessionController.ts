import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import { createReplySearchCache, filterRepliesByQuery } from './model/replySearch';
import type { ReplyEditTarget, ReplyFilter, ReplyTarget } from './model/types';
import { appendReplyImageMarkup } from '@/sources/imageUpload';
import { filterRepliesWithImages } from './model/topicDerivedData';
import type { Reply, ReplyOrder, Source, Topic, TopicDetail } from '@/domain/forum/models';
import { userFromReply, userFromTopic } from '@/domain/forum/userNavigation';
import type { ComposerSnapshot, PendingNodeSeekPoll } from '@/domain/forum/structuredComposer';
import { replyEditRecoveryText } from '@/domain/forum/structuredComposer';

export type ReplyComposerIntent =
  | { kind: 'closed'; target?: never }
  | { kind: 'new'; target?: never }
  | { kind: 'floor'; target: ReplyTarget }
  | { kind: 'edit'; target: ReplyEditTarget };

type ReplyDraft = {
  content: string;
  face: string;
  polls: PendingNodeSeekPoll[];
};

type ReplyDraftOwner = { scope: string; edit: ReplyEditTarget | null };

type ReplyComposerState = {
  scope: string;
  reply: ReplyDraft;
  mode:
    | { kind: 'reply'; intent: Exclude<ReplyComposerIntent, { kind: 'edit' }> }
    | { kind: 'edit'; intent: Extract<ReplyComposerIntent, { kind: 'edit' }>; draft: ReplyDraft }
    | { kind: 'recovery'; content: string };
};

type ReplyComposerTransition =
  | { type: 'reset'; scope: string }
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'reply-to-floor'; target: ReplyTarget }
  | { type: 'edit'; target: ReplyEditTarget }
  | { type: 'detach-edit'; target?: ReplyEditTarget; content?: string }
  | { type: 'complete-submission' }
  | { type: 'update'; owner: ReplyDraftOwner; update: (draft: ReplyDraft) => ReplyDraft };

const CLOSED_REPLY_COMPOSER = { kind: 'reply', intent: { kind: 'closed' } } as const;
const EMPTY_REPLY_DRAFT: ReplyDraft = { content: '', face: '', polls: [] };

function initialReplyComposer(scope: string): ReplyComposerState {
  return { scope, reply: EMPTY_REPLY_DRAFT, mode: CLOSED_REPLY_COMPOSER };
}

export function transitionReplyComposer(
  state: ReplyComposerState,
  transition: ReplyComposerTransition
): ReplyComposerState {
  const { mode } = state;
  switch (transition.type) {
    case 'reset':
      return state.scope === transition.scope ? state : initialReplyComposer(transition.scope);
    case 'open':
      if (mode.kind === 'reply' && mode.intent.kind === 'new') return state;
      return { ...state, mode: { kind: 'reply', intent: { kind: 'new' } } };
    case 'close':
      return { ...state, mode: CLOSED_REPLY_COMPOSER };
    case 'reply-to-floor':
      return { ...state, mode: { kind: 'reply', intent: { kind: 'floor', target: transition.target } } };
    case 'edit':
      return {
        ...state,
        mode: {
          kind: 'edit',
          intent: { kind: 'edit', target: transition.target },
          draft: { ...EMPTY_REPLY_DRAFT, content: transition.target.contentMarkdown }
        }
      };
    case 'detach-edit':
      if (transition.target && (mode.kind !== 'edit' || mode.intent.target !== transition.target)) return state;
      if (mode.kind === 'recovery') return state;
      if (mode.kind === 'edit') {
        const content = transition.content ?? replyEditRecoveryText(mode.draft.content, mode.draft.polls);
        if (content !== mode.intent.target.contentMarkdown) return { ...state, mode: { kind: 'recovery', content } };
      }
      return { ...state, mode: CLOSED_REPLY_COMPOSER };
    case 'complete-submission':
      if (mode.kind === 'recovery') return state;
      return mode.kind === 'reply' ? initialReplyComposer(state.scope) : { ...state, mode: CLOSED_REPLY_COMPOSER };
    case 'update': {
      if (state.scope !== transition.owner.scope || mode.kind === 'recovery') return state;
      if (mode.kind === 'edit') {
        if (mode.intent.target !== transition.owner.edit) return state;
        const draft = transition.update(mode.draft);
        return draft === mode.draft ? state : { ...state, mode: { ...mode, draft } };
      }
      if (transition.owner.edit) return state;
      const reply = transition.update(state.reply);
      return reply === state.reply ? state : { ...state, reply };
    }
  }
}

export function filterTopicSessionReplies({
  commentQuery,
  replyFilter,
  source,
  topicDetail,
  topicReplies,
  searchCache
}: {
  commentQuery: string;
  replyFilter: ReplyFilter;
  source: Source;
  topicDetail: TopicDetail | null;
  topicReplies: Reply[];
  searchCache?: ReturnType<typeof createReplySearchCache>;
}) {
  searchCache?.retain(topicReplies);
  let replies = topicReplies;
  if (replyFilter === 'author') {
    if (source === 'linuxdo') {
      const owner = topicDetail && userFromTopic(topicDetail)?.username?.toLowerCase();
      replies = owner
        ? replies.filter(
            (reply) => (reply.authorId?.trim() || userFromReply(reply, source)?.username)?.toLowerCase() === owner
          )
        : [];
    } else if (topicDetail) {
      const ownerId = source === 'nodeseek' ? userFromTopic(topicDetail)?.id : topicDetail.authorId?.trim();
      replies = replies.filter((reply) => {
        const replyId = source === 'nodeseek' ? userFromReply(reply, source)?.id : reply.authorId?.trim();
        return ownerId && replyId
          ? ownerId === replyId
          : Boolean(topicDetail.author) && reply.author === topicDetail.author;
      });
    }
  } else if (replyFilter === 'images') {
    replies = filterRepliesWithImages(replies, source);
  }
  return filterRepliesByQuery(replies, commentQuery, searchCache);
}

export function useTopicSessionController({
  notify,
  topic,
  accountScope = ''
}: {
  notify: (message: string) => void;
  topic: Topic;
  accountScope?: string;
}) {
  const currentTopicKey = useCommittedRef(`${topic.source}:${topic.id}`);
  const [replyFilter, setReplyFilter] = useState<ReplyFilter>('all');
  const [replyOrder, setReplyOrder] = useState<ReplyOrder>('oldest');
  const scope = JSON.stringify([topic.source, topic.id, accountScope]);
  const [composerState, dispatchReplyComposer] = useReducer(transitionReplyComposer, scope, initialReplyComposer);
  const { mode, reply } = composerState.scope === scope ? composerState : initialReplyComposer(scope);
  const replyDraft = mode.kind === 'edit' ? mode.draft : reply;
  const replyIntent = mode.kind === 'recovery' ? CLOSED_REPLY_COMPOSER.intent : mode.intent;
  const edit = mode.kind === 'edit' ? mode.intent.target : null;
  const owner = useMemo<ReplyDraftOwner>(() => ({ scope, edit }), [scope, edit]);
  const committedOwner = useCommittedRef(owner);
  const currentNotify = useCommittedRef(notify);
  const editRecoveryRef = useRef<(() => Promise<string>) | null>(null);
  const queuedEdit = useRef<ReplyEditTarget | null>(edit);
  const replyDraftRevisionRef = useRef(0);
  useLayoutEffect(() => {
    if (composerState.scope === scope) return;
    replyDraftRevisionRef.current += 1;
    queuedEdit.current = null;
    dispatchReplyComposer({ type: 'reset', scope });
  }, [composerState.scope, scope]);
  const [commentQuery, setCommentQuery] = useState('');
  const [debouncedCommentQuery, setDebouncedCommentQuery] = useState('');
  const [expandedQuotes, setExpandedQuotes] = useState<Record<string, boolean>>({});
  const [quoteStateVersion, setQuoteStateVersion] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedCommentQuery(commentQuery), 180);
    return () => clearTimeout(timer);
  }, [commentQuery]);

  const toggleReplyComposer = useCallback((open: boolean) => {
    replyDraftRevisionRef.current += 1;
    queuedEdit.current = null;
    dispatchReplyComposer({ type: open ? 'open' : 'close' });
  }, []);

  const replyToFloor = useCallback(
    (reply: Reply) => {
      if (!reply.floor) {
        notify('当前楼层信息不完整，刷新主题后再试。');
        return;
      }
      replyDraftRevisionRef.current += 1;
      queuedEdit.current = null;
      dispatchReplyComposer({
        type: 'reply-to-floor',
        target: { floor: reply.floor, author: reply.author, authorId: reply.authorId }
      });
    },
    [notify]
  );

  const editReply = useCallback((target: ReplyEditTarget) => {
    replyDraftRevisionRef.current += 1;
    queuedEdit.current = target;
    dispatchReplyComposer({ type: 'edit', target });
  }, []);

  const detachReplyEdit = useCallback(
    (target = queuedEdit.current ?? undefined) => {
      const currentOwner = committedOwner.current;
      if (target ? queuedEdit.current !== target : currentOwner.edit) return;
      queuedEdit.current = null;
      replyDraftRevisionRef.current += 1;
      const read = target && currentOwner.edit === target && editRecoveryRef.current;
      if (!read) {
        dispatchReplyComposer({ type: 'detach-edit', target });
        return;
      }
      const finish = (content?: string) => {
        if (committedOwner.current === currentOwner && queuedEdit.current === null)
          dispatchReplyComposer({ type: 'detach-edit', target, content });
      };
      void read().then(finish, () => {
        if (committedOwner.current !== currentOwner || queuedEdit.current !== null) return;
        if (!editRecoveryRef.current) {
          finish();
          return;
        }
        // Keep a live editor on screen if its export timed out. Closing it would discard unconfirmed keystrokes.
        queuedEdit.current = target ?? null;
        currentNotify.current('编辑权限已变化，暂未取得最新草稿。请复制正文后再关闭编辑器。');
      });
    },
    [committedOwner, currentNotify]
  );

  const completeReplySubmission = useCallback((expectedRevision?: number) => {
    if (expectedRevision !== undefined && expectedRevision !== replyDraftRevisionRef.current) return false;
    replyDraftRevisionRef.current += 1;
    queuedEdit.current = null;
    dispatchReplyComposer({ type: 'complete-submission' });
    return true;
  }, []);

  const updateDraft = useCallback(
    (update: (draft: ReplyDraft) => ReplyDraft, fromSnapshot = false) => {
      if (committedOwner.current !== owner || (fromSnapshot && queuedEdit.current !== owner.edit)) return;
      replyDraftRevisionRef.current += 1;
      dispatchReplyComposer({ type: 'update', owner: { scope, edit: queuedEdit.current }, update });
    },
    [committedOwner, owner, scope]
  );
  const appendReplyMarkup = useCallback(
    (markup: string, expectedRevision?: number) => {
      if (expectedRevision !== undefined && expectedRevision !== replyDraftRevisionRef.current) return;
      updateDraft((draft) => ({ ...draft, content: appendReplyImageMarkup(draft.content, markup) }));
    },
    [updateDraft]
  );
  const changeReplyContent = useCallback(
    (content: string) => updateDraft((draft) => (draft.content === content ? draft : { ...draft, content })),
    [updateDraft]
  );
  const changeReplySnapshot = useCallback(
    (snapshot: ComposerSnapshot) =>
      updateDraft((draft) => ({ ...draft, content: snapshot.markdown, polls: snapshot.pendingNodeSeekPolls }), true),
    [updateDraft]
  );
  const changeReplyFace = useCallback(
    (face: string) => updateDraft((draft) => (draft.face === face ? draft : { ...draft, face })),
    [updateDraft]
  );

  const changeQuoteExpanded = useCallback((key: string, expanded: boolean) => {
    setExpandedQuotes((current) => ({ ...current, [key]: expanded }));
    setQuoteStateVersion((current) => current + 1);
  }, []);

  const composerCommands = useMemo(
    () => ({
      appendMarkup: appendReplyMarkup,
      changeContent: changeReplyContent,
      changeSnapshot: changeReplySnapshot,
      changeFace: changeReplyFace,
      completeSubmission: completeReplySubmission,
      getDraftRevision: () => replyDraftRevisionRef.current,
      detachEdit: detachReplyEdit,
      editRecoveryRef,
      editReply,
      replyToFloor,
      toggle: toggleReplyComposer
    }),
    [
      appendReplyMarkup,
      changeReplyContent,
      changeReplySnapshot,
      changeReplyFace,
      completeReplySubmission,
      detachReplyEdit,
      editReply,
      replyToFloor,
      toggleReplyComposer
    ]
  );
  const quoteCommands = useMemo(
    () => ({
      changeExpanded: changeQuoteExpanded,
      isExpanded: (key: string) => Boolean(expandedQuotes[key])
    }),
    [changeQuoteExpanded, expandedQuotes]
  );
  const topicCommands = useMemo(() => ({ getCurrentKey: () => currentTopicKey.current }), [currentTopicKey]);
  const viewCommands = useMemo(
    () => ({
      changeCommentQuery: setCommentQuery,
      changeReplyFilter: setReplyFilter,
      changeReplyOrder: setReplyOrder,
      clearReplyFilters() {
        setCommentQuery('');
        setReplyFilter('all');
      }
    }),
    []
  );

  return {
    state: {
      commentQuery,
      debouncedCommentQuery,
      expandedQuotes,
      quoteStateVersion,
      replyComposerIntent: replyIntent,
      replyContent: replyDraft.content,
      replyFace: replyDraft.face,
      replyPendingNodeSeekPolls: replyDraft.polls,
      replyEditRecovery: mode.kind === 'recovery' ? mode.content : null,
      replyComposerScope: scope,
      replyFilter,
      replyOrder,
      selectedTopic: topic
    },
    commands: {
      composer: composerCommands,
      quotes: quoteCommands,
      topic: topicCommands,
      view: viewCommands
    }
  };
}

export type TopicSessionController = ReturnType<typeof useTopicSessionController>;
