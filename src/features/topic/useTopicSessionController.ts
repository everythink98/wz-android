import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { createReplyTextIndexForQuery, filterRepliesByQuery } from './model/replySearch';
import type { ReplyEditTarget, ReplyFilter, ReplyTarget } from './model/types';
import { appendReplyImageMarkup } from '@/sources/imageUpload';
import { filterRepliesWithImages, type InlineSizedImageUrlMap, type TopicImageDeriver } from './model/topicDerivedData';
import type { Reply, ReplyOrder, Source, Topic, TopicDetail } from '@/domain/forum/models';
import type { ComposerSnapshot, PendingNodeSeekPoll } from '@/domain/forum/structuredComposer';

export type ReplyComposerIntent =
  | { kind: 'closed'; target?: never }
  | { kind: 'new'; target?: never }
  | { kind: 'floor'; target: ReplyTarget }
  | { kind: 'edit'; target: ReplyEditTarget };

type ReplyComposerState = {
  intent: ReplyComposerIntent;
  content: string;
  face: string;
};

type ReplyComposerTransition =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'reply-to-floor'; target: ReplyTarget }
  | { type: 'edit'; target: ReplyEditTarget }
  | { type: 'detach-edit' }
  | { type: 'complete-submission' }
  | { type: 'change-content'; content: string }
  | { type: 'change-face'; face: string }
  | { type: 'append-markup'; markup: string };

const CLOSED_REPLY_COMPOSER_INTENT: ReplyComposerIntent = { kind: 'closed' };
const INITIAL_REPLY_COMPOSER_STATE: ReplyComposerState = {
  intent: CLOSED_REPLY_COMPOSER_INTENT,
  content: '',
  face: ''
};

export function transitionReplyComposer(
  state: ReplyComposerState,
  transition: ReplyComposerTransition
): ReplyComposerState {
  switch (transition.type) {
    case 'open':
      if (state.intent.kind === 'new' && !state.face) return state;
      return { ...state, intent: { kind: 'new' }, face: '' };
    case 'close':
      if (state.intent.kind === 'closed' && !state.face) return state;
      return {
        intent: CLOSED_REPLY_COMPOSER_INTENT,
        content: state.intent.kind === 'edit' ? '' : state.content,
        face: ''
      };
    case 'reply-to-floor':
      return { ...state, intent: { kind: 'floor', target: transition.target }, face: '' };
    case 'edit':
      return {
        intent: { kind: 'edit', target: transition.target },
        content: transition.target.contentMarkdown,
        face: ''
      };
    case 'detach-edit':
      if (state.intent.kind === 'closed' && !state.face) return state;
      return { ...state, intent: CLOSED_REPLY_COMPOSER_INTENT, face: '' };
    case 'complete-submission':
      return INITIAL_REPLY_COMPOSER_STATE;
    case 'change-content':
      return state.content === transition.content ? state : { ...state, content: transition.content };
    case 'change-face':
      return state.face === transition.face ? state : { ...state, face: transition.face };
    case 'append-markup': {
      const content = appendReplyImageMarkup(state.content, transition.markup);
      return content === state.content ? state : { ...state, content };
    }
  }
}

export function filterTopicSessionReplies({
  commentQuery,
  inlineSizedImageUrls,
  replyFilter,
  source,
  topicDetail,
  topicImageDeriver,
  topicReplies
}: {
  commentQuery: string;
  inlineSizedImageUrls: InlineSizedImageUrlMap;
  replyFilter: ReplyFilter;
  source: Source;
  topicDetail: TopicDetail | null;
  topicImageDeriver: TopicImageDeriver;
  topicReplies: Reply[];
}) {
  let replies = topicReplies;
  if (replyFilter === 'author') {
    replies = topicDetail ? replies.filter((reply) => reply.author === topicDetail.author) : replies;
  } else if (replyFilter === 'images') {
    replies = filterRepliesWithImages(replies, inlineSizedImageUrls, topicImageDeriver, source);
  }
  return filterRepliesByQuery(replies, commentQuery, createReplyTextIndexForQuery(topicReplies, commentQuery));
}

export function useTopicSessionController({ notify, topic }: { notify: (message: string) => void; topic: Topic }) {
  const [replyFilter, setReplyFilter] = useState<ReplyFilter>('all');
  const [replyOrder, setReplyOrder] = useState<ReplyOrder>('oldest');
  const [replyComposer, dispatchReplyComposer] = useReducer(transitionReplyComposer, INITIAL_REPLY_COMPOSER_STATE);
  const [replyPendingNodeSeekPolls, setReplyPendingNodeSeekPolls] = useState<PendingNodeSeekPoll[]>([]);
  const [commentQuery, setCommentQuery] = useState('');
  const [debouncedCommentQuery, setDebouncedCommentQuery] = useState('');
  const [expandedQuotes, setExpandedQuotes] = useState<Record<string, boolean>>({});
  const [quoteStateVersion, setQuoteStateVersion] = useState(0);
  const topicScrollYRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedCommentQuery(commentQuery), 180);
    return () => clearTimeout(timer);
  }, [commentQuery]);

  const toggleReplyComposer = useCallback(
    (open: boolean) => {
      if (!open && replyComposer.intent.kind === 'edit') setReplyPendingNodeSeekPolls([]);
      dispatchReplyComposer({ type: open ? 'open' : 'close' });
    },
    [replyComposer.intent.kind]
  );

  const replyToFloor = useCallback(
    (reply: Reply) => {
      if (!reply.floor) {
        notify('当前楼层信息不完整，刷新主题后再试。');
        return;
      }
      dispatchReplyComposer({
        type: 'reply-to-floor',
        target: {
          floor: reply.floor,
          author: reply.author,
          authorId: reply.authorId
        }
      });
    },
    [notify]
  );

  const editReply = useCallback((target: ReplyEditTarget) => {
    setReplyPendingNodeSeekPolls([]);
    dispatchReplyComposer({ type: 'edit', target });
  }, []);

  const detachReplyEdit = useCallback(() => {
    dispatchReplyComposer({ type: 'detach-edit' });
  }, []);

  const completeReplySubmission = useCallback(() => {
    setReplyPendingNodeSeekPolls([]);
    dispatchReplyComposer({ type: 'complete-submission' });
  }, []);

  const appendReplyMarkup = useCallback((markup: string) => {
    dispatchReplyComposer({ type: 'append-markup', markup });
  }, []);

  const changeReplyContent = useCallback((content: string) => {
    dispatchReplyComposer({ type: 'change-content', content });
  }, []);

  const changeReplySnapshot = useCallback((snapshot: ComposerSnapshot) => {
    dispatchReplyComposer({ type: 'change-content', content: snapshot.markdown });
    setReplyPendingNodeSeekPolls(snapshot.pendingNodeSeekPolls);
  }, []);

  const changeReplyFace = useCallback((face: string) => {
    dispatchReplyComposer({ type: 'change-face', face });
  }, []);

  const changeQuoteExpanded = useCallback((key: string, expanded: boolean) => {
    setExpandedQuotes((current) => ({ ...current, [key]: expanded }));
    setQuoteStateVersion((current) => current + 1);
  }, []);

  const rememberScrollY = useCallback((value: number) => {
    topicScrollYRef.current = Math.max(0, value);
  }, []);

  return {
    state: {
      commentQuery,
      debouncedCommentQuery,
      expandedQuotes,
      quoteStateVersion,
      replyComposerIntent: replyComposer.intent,
      replyContent: replyComposer.content,
      replyFace: replyComposer.face,
      replyPendingNodeSeekPolls,
      replyFilter,
      replyOrder,
      selectedTopic: topic
    },
    commands: {
      composer: {
        appendMarkup: appendReplyMarkup,
        changeContent: changeReplyContent,
        changeSnapshot: changeReplySnapshot,
        changeFace: changeReplyFace,
        completeSubmission: completeReplySubmission,
        detachEdit: detachReplyEdit,
        editReply,
        replyToFloor,
        toggle: toggleReplyComposer
      },
      quotes: {
        changeExpanded: changeQuoteExpanded,
        isExpanded: (key: string) => Boolean(expandedQuotes[key])
      },
      topic: {
        getCurrentKey: () => `${topic.source}:${topic.id}`
      },
      view: {
        changeCommentQuery: setCommentQuery,
        changeReplyFilter: setReplyFilter,
        changeReplyOrder: setReplyOrder,
        rememberScrollY
      }
    }
  };
}

export type TopicSessionController = ReturnType<typeof useTopicSessionController>;
