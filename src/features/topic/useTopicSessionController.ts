import { useCallback, useEffect, useRef, useState } from 'react';
import { createReplyTextIndexForQuery, filterRepliesByQuery } from './model/replySearch';
import type { ReplyEditTarget, ReplyFilter, ReplyTarget } from './model/types';
import { appendReplyImageMarkup } from '@/sources/imageUpload';
import { filterRepliesWithImages, type InlineSizedImageUrlMap, type TopicImageDeriver } from './model/topicDerivedData';
import type { Reply, ReplyOrder, Topic, TopicDetail } from '@/domain/forum/models';

export function replyContentAfterComposerClose(content: string, replyEditTarget: ReplyEditTarget | null) {
  return replyEditTarget ? '' : content;
}

export function replyComposerAfterSuccessfulSubmission() {
  return {
    replyComposerOpen: false,
    replyContent: '',
    replyEditTarget: null,
    replyFace: '',
    replyTarget: null
  };
}

export function filterTopicSessionReplies({
  commentQuery,
  inlineSizedImageUrls,
  replyFilter,
  topicDetail,
  topicImageDeriver,
  topicReplies
}: {
  commentQuery: string;
  inlineSizedImageUrls: InlineSizedImageUrlMap;
  replyFilter: ReplyFilter;
  topicDetail: TopicDetail | null;
  topicImageDeriver: TopicImageDeriver;
  topicReplies: Reply[];
}) {
  let replies = topicReplies;
  if (replyFilter === 'author') {
    replies = topicDetail ? replies.filter((reply) => reply.author === topicDetail.author) : replies;
  } else if (replyFilter === 'images') {
    replies = filterRepliesWithImages(replies, inlineSizedImageUrls, topicImageDeriver);
  }
  return filterRepliesByQuery(replies, commentQuery, createReplyTextIndexForQuery(topicReplies, commentQuery));
}

export function useTopicSessionController({ notify, topic }: { notify: (message: string) => void; topic: Topic }) {
  const [replyFilter, setReplyFilter] = useState<ReplyFilter>('all');
  const [replyOrder, setReplyOrder] = useState<ReplyOrder>('oldest');
  const [replyContent, setReplyContent] = useState('');
  const [replyFace, setReplyFace] = useState('');
  const [commentQuery, setCommentQuery] = useState('');
  const [debouncedCommentQuery, setDebouncedCommentQuery] = useState('');
  const [replyComposerOpen, setReplyComposerOpen] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [replyEditTarget, setReplyEditTarget] = useState<ReplyEditTarget | null>(null);
  const [expandedQuotes, setExpandedQuotes] = useState<Record<string, boolean>>({});
  const [quoteStateVersion, setQuoteStateVersion] = useState(0);
  const topicScrollYRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedCommentQuery(commentQuery), 180);
    return () => clearTimeout(timer);
  }, [commentQuery]);

  const toggleReplyComposer = useCallback(
    (open: boolean) => {
      setReplyComposerOpen(open);
      if (open) {
        setReplyTarget(null);
        setReplyEditTarget(null);
        setReplyFace('');
        return;
      }
      setReplyContent((current) => replyContentAfterComposerClose(current, replyEditTarget));
      setReplyFace('');
      setReplyTarget(null);
      setReplyEditTarget(null);
    },
    [replyEditTarget]
  );

  const replyToFloor = useCallback(
    (reply: Reply) => {
      if (!reply.floor) {
        notify('当前楼层信息不完整，刷新主题后再试。');
        return;
      }
      setReplyTarget({
        floor: reply.floor,
        author: reply.author,
        authorId: reply.authorId,
        commentId: reply.commentId
      });
      setReplyEditTarget(null);
      setReplyFace('');
      setReplyComposerOpen(true);
    },
    [notify]
  );

  const editReply = useCallback((target: ReplyEditTarget) => {
    setReplyTarget(null);
    setReplyFace('');
    // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- This is an event callback, not a React state updater.
    setReplyEditTarget(target);
    setReplyContent(target.contentMarkdown);
    setReplyComposerOpen(true);
  }, []);

  const detachReplyEdit = useCallback(() => {
    setReplyComposerOpen(false);
    setReplyFace('');
    setReplyTarget(null);
    setReplyEditTarget(null);
  }, []);

  const completeReplySubmission = useCallback(() => {
    const next = replyComposerAfterSuccessfulSubmission();
    setReplyContent(next.replyContent);
    setReplyFace(next.replyFace);
    setReplyComposerOpen(next.replyComposerOpen);
    setReplyTarget(next.replyTarget);
    setReplyEditTarget(next.replyEditTarget);
  }, []);

  const appendReplyMarkup = useCallback((markup: string) => {
    setReplyContent((current) => appendReplyImageMarkup(current, markup));
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
      replyComposerOpen,
      replyContent,
      replyEditTarget,
      replyFace,
      replyFilter,
      replyOrder,
      replyTarget,
      selectedTopic: topic
    },
    commands: {
      composer: {
        appendMarkup: appendReplyMarkup,
        changeContent: setReplyContent,
        changeFace: setReplyFace,
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
