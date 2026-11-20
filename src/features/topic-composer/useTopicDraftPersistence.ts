import { useCallback, useRef, useState } from 'react';
import type { TopicCreationSource, TopicDraft } from '@/domain/forum/topicComposer';
import type { ComposerSnapshot } from '@/domain/forum/structuredComposer';
import { saveTopicDraft } from '@/platform/persistence/topicDrafts';
import { errorMessage } from '@/platform/network/errors';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';

type Durability =
  { kind: 'unknown' } | { kind: 'saved'; draftId: string; revision: number } | { kind: 'retired'; draftId: string };
type Feedback =
  | { kind: 'empty' }
  | { kind: 'saving' | 'saved' | 'restored' | 'fresh' | 'discarded' }
  | { kind: 'failed'; message: string };

export class TopicDraftConflictError extends Error {
  constructor() {
    super('草稿已在其他页面更新。请先复制需要保留的本页修改，再返回。');
  }
}

export function useTopicDraftPersistence(input: {
  getDraft(): TopicDraft | null;
  isMounted(): boolean;
  onSaved(source: TopicCreationSource): void;
  completedSubmissionId(draft: TopicDraft): string | undefined;
}) {
  const inputRef = useCommittedRef(input);
  const durability = useRef<Durability>({ kind: 'unknown' });
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  const issues = useRef<{ draftId: string; issues: ComposerSnapshot['validationIssues'] } | null>(null);
  const [feedback, setFeedback] = useState<Feedback>({ kind: 'empty' });
  const report = useCallback(
    (value: Feedback) => {
      if (inputRef.current.isMounted()) setFeedback(value);
    },
    [inputRef]
  );
  const alreadyDurable = useCallback((value: TopicDraft) => {
    const current = durability.current;
    return (
      current.kind !== 'unknown' &&
      current.draftId === value.id &&
      (current.kind === 'retired' || current.revision >= value.revision)
    );
  }, []);
  const persist = useCallback(
    async (value: TopicDraft) => {
      if (alreadyDurable(value)) return;
      const operation = tail.current
        .catch(() => undefined)
        .then(async () => {
          if (alreadyDurable(value)) return;
          const baseline = durability.current;
          const expectedRevision =
            baseline.kind === 'saved' && baseline.draftId === value.id ? baseline.revision : null;
          if (!(await saveTopicDraft(value, expectedRevision, inputRef.current.completedSubmissionId(value))))
            throw new TopicDraftConflictError();
          const current = inputRef.current.getDraft();
          if (current?.id === value.id)
            durability.current = { kind: 'saved', draftId: value.id, revision: value.revision };
          if (current?.id === value.id && current.revision === value.revision && inputRef.current.isMounted()) {
            report({ kind: 'saved' });
            inputRef.current.onSaved(value.source);
          }
        });
      tail.current = operation;
      try {
        await operation;
      } catch (cause) {
        if (inputRef.current.getDraft()?.id === value.id)
          report({ kind: 'failed', message: `保存失败：${errorMessage(cause)}` });
        throw cause;
      }
    },
    [alreadyDurable, inputRef, report]
  );
  const flush = useCallback(
    async ({
      capture,
      accept
    }: {
      capture?: () => Promise<ComposerSnapshot>;
      accept(snapshot: ComposerSnapshot, draftId: string): void;
    }) => {
      const before = inputRef.current.getDraft();
      if (!before) return null;
      report({ kind: 'saving' });
      try {
        if (capture) {
          const snapshot = await capture();
          if (inputRef.current.getDraft()?.id !== before.id) throw new Error('草稿已切换，请重试');
          accept(snapshot, before.id);
        }
        let latest = inputRef.current.getDraft();
        while (latest) {
          await persist(latest);
          const current = inputRef.current.getDraft();
          if (current?.id !== before.id) throw new Error('草稿已切换，请重试');
          if (current.revision === latest.revision) {
            report({ kind: 'saved' });
            return latest;
          }
          latest = current;
        }
        return null;
      } catch (cause) {
        if (inputRef.current.getDraft()?.id === before.id)
          report({ kind: 'failed', message: `保存失败：${errorMessage(cause)}` });
        throw cause;
      }
    },
    [inputRef, persist, report]
  );
  const edited = useCallback(() => report({ kind: 'saving' }), [report]);
  const restored = useCallback(
    (stored: TopicDraft | null) => {
      durability.current = stored
        ? { kind: 'saved', draftId: stored.id, revision: stored.revision }
        : { kind: 'unknown' };
      report({ kind: stored ? 'restored' : 'fresh' });
    },
    [report]
  );
  const restorationFailed = useCallback(
    (cause: unknown) => {
      report({
        kind: 'failed',
        message: `保存或恢复失败：${errorMessage(cause)}`
      });
    },
    [report]
  );
  const retire = useCallback((draftId: string) => {
    durability.current = { kind: 'retired', draftId };
  }, []);
  const fresh = useCallback(() => report({ kind: 'fresh' }), [report]);
  const discarded = useCallback(() => report({ kind: 'discarded' }), [report]);
  const recordSnapshot = useCallback((draftId: string, value: ComposerSnapshot['validationIssues']) => {
    issues.current = { draftId, issues: value };
  }, []);
  const snapshotIssue = useCallback(
    (draftId: string) => (issues.current?.draftId === draftId ? issues.current.issues[0]?.message : undefined),
    []
  );
  const messages = {
    empty: '',
    saving: '正在保存…',
    saved: '已保存到本机',
    restored: '已恢复本机草稿',
    fresh: '自动保存到本机',
    discarded: '草稿已丢弃'
  };
  return {
    saveStatus: feedback.kind === 'failed' ? feedback.message : messages[feedback.kind],
    persist,
    flush,
    edited,
    restored,
    restorationFailed,
    retire,
    fresh,
    discarded,
    recordSnapshot,
    snapshotIssue
  };
}
