import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Image } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import type { Topic } from '@/domain/forum/models';
import {
  applyTopicCategory,
  emptyTopicDraft,
  validateTopicDraft,
  type CreateTopicResult,
  type TopicCreationContext,
  type TopicCreationSource,
  type TopicDraft,
  type TopicDraftAttachment,
  type TopicSubmissionAttempt,
  draftFromTopicEdit,
  hasTopicEditChanges,
  topicDraftTarget,
  topicEditChanges,
  validateTopicEdit,
  type TopicComposerIntent,
  type TopicEditContext,
  type TopicEditResult,
  type TopicEditableFields
} from '@/domain/forum/topicComposer';
import type { ComposerSnapshot } from '@/domain/forum/structuredComposer';
import { editLinuxDoTopic } from '@/sources/linuxdo/topicEditing';
import { editNodeSeekTopic } from '@/sources/nodeseek/topicEditing';
import { editYaohuoTopic } from '@/sources/yaohuo/topicEditing';
import { siteSessionIdentityKey } from '@/domain/session/siteSessionState';
import type { WritableSessionTicket } from '@/domain/session/writableSessionGate';
import type { LinuxDoReadRecovery } from '@/domain/session/sessionContracts';
import { errorMessage } from '@/platform/network/errors';
import { withRequestBeforeSend, type Fetcher, type RequestDispatchState } from '@/platform/network/request';
import {
  acknowledgeTopicSubmissionAttempt,
  beginTopicSubmissionAttempt,
  checkpointTopicEdit,
  discardTopicDraft,
  loadTopicDraft,
  readLastTopicCreationSource,
  readTopicSubmissionAttempt,
  saveLastTopicCreationSource,
  saveTopicDraft,
  settleTopicSubmissionAttempt
} from '@/platform/persistence/topicDrafts';
import {
  persistTopicDraftAttachment,
  verifyTopicDraftAttachments,
  removeTopicDraftAttachmentFile
} from '@/platform/media/topicDraftAttachments';
import { createNodeSeekTopic, loadNodeSeekTopicCreationContext } from '@/sources/nodeseek/topicCreation';
import { createLinuxDoTopic, searchLinuxDoTopicTags } from '@/sources/linuxdo/topicCreation';
import { createYaohuoTopic, loadYaohuoTopicCreationContext } from '@/sources/yaohuo/topicCreation';
import { materializePendingNodeSeekPolls } from '@/sources/nodeseek/pendingPolls';
import { buildNodeSeekPollCreateRequest } from '@/sources/nodeseek/actionRequest';
import { runNodeSeekAction } from '@/sources/nodeseek/actionClient';
import { currentNodeImageApiKeyGeneration } from '@/sources/nodeimage/credentials';
import { fetchLinuxDoTemplates } from '@/sources/linuxdo/templates';
import { resolveLinuxDoUpload } from '@/sources/linuxdo/uploadUrls';
import { sourceErrorFromUnknown } from '@/sources/sourceErrors';
import { retryEmojiCatalog } from '@/sources/discourse/retryEmojiCatalog';
import { normalizeReplyImageAsset } from '@/sources/imageUpload';
import type { StructuredReplyComposerHandle } from '@/ui/composer/StructuredReplyComposer';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import type { TopicComposerRouteRuntimeValue } from './TopicComposerRouteRuntime';
import { uploadTopicAttachment, validateTopicAttachment } from './topicCreationActions';

const SOURCES: TopicCreationSource[] = ['nodeseek', 'linuxdo', 'yaohuo'];
function confirm(title: string, message: string, label = '确定') {
  return new Promise<boolean>((resolve) =>
    Alert.alert(
      title,
      message,
      [
        { text: '取消', style: 'cancel', onPress: () => resolve(false) },
        { text: label, onPress: () => resolve(true) }
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    )
  );
}
function identifier() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function useTopicComposerController({
  runtime,
  intent,
  active,
  onPosted,
  onAccepted,
  onEdited
}: {
  runtime: TopicComposerRouteRuntimeValue;
  intent: TopicComposerIntent;
  active: boolean;
  onPosted: (topic: Topic) => void;
  onAccepted: () => void;
  onEdited?: (source: TopicCreationSource, topicId: string) => void;
}) {
  const initialSource = intent.kind === 'edit' ? intent.source : intent.initialSource;
  const editTopicId = intent.kind === 'edit' ? intent.topicId : undefined;
  const target = editTopicId ? `edit:${editTopicId}` : 'create';
  const runtimeRef = useCommittedRef(runtime);
  const activeRef = useCommittedRef(active);
  const editorRef = useRef<StructuredReplyComposerHandle>(null);
  const [source, setSource] = useState<TopicCreationSource | null>(initialSource || null);
  const sourceRef = useCommittedRef(source);
  const [draft, setDraft] = useState<TopicDraft | null>(null);
  const draftRef = useRef<TopicDraft | null>(null);
  const [context, setContext] = useState<TopicCreationContext | null>(null);
  const [editContext, setEditContext] = useState<TopicEditContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [contextLoading, setContextLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const transitionRef = useRef(false);
  const [uploading, setUploading] = useState(false);
  const picking = useRef(false);
  const uploadRef = useRef<{ abort: AbortController; promise: Promise<string | undefined> } | null>(null);
  const [error, setError] = useState('');
  const [contextError, setContextError] = useState('');
  const [contextNeedsVerification, setContextNeedsVerification] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveStatus, setSaveStatus] = useState('');
  const [attempt, setAttempt] = useState<TopicSubmissionAttempt | null>(null);
  const [draftSites, setDraftSites] = useState<Partial<Record<TopicCreationSource, boolean>>>({});
  const [emojiUrls, setEmojiUrls] = useState<Record<string, string>>({});
  const [contextReload, setContextReload] = useState(0);
  const [draftReload, setDraftReload] = useState(0);
  const categoryRequest = useRef(0);
  const completedContext = useRef('');
  const completedEmojis = useRef('');
  const mounted = useRef(true);
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const savedRevision = useRef<{ id: string; revision: number } | null>(null);
  const snapshotIssues = useRef<{ draftId: string; issues: ComposerSnapshot['validationIssues'] } | null>(null);
  const session = source ? runtime.sessions[source] : null;
  const identityKey = session ? siteSessionIdentityKey(session) : '';
  const enabled = Boolean(source && runtime.enabledSources.includes(source));
  useEffect(() => {
    if (
      attempt?.status === 'saved' &&
      draft?.edit &&
      attempt.draftId === draft.id &&
      active &&
      runtime.appActive &&
      enabled &&
      draft.identityKey === identityKey
    )
      onEdited?.(draft.source, draft.edit.topicId);
  }, [attempt, draft, active, runtime.appActive, enabled, identityKey, onEdited]);

  const readEditContext = useCallback(
    async (site: TopicCreationSource, ownerKey: string, topicId: string, signal?: AbortSignal) => {
      const owner = runtimeRef.current;
      const ticket = await owner.ensureWritableSession(site);
      await owner.ensureNetworkProxyReady();
      if (
        !owner.isWritableSessionTicketCurrent(ticket) ||
        siteSessionIdentityKey(runtimeRef.current.sessions[site]) !== ownerKey
      )
        throw new Error('站点或账号已变化，请重新进入');
      const value = await owner.getTopicEditContext({
        source: site,
        identityKey: ownerKey,
        topicId,
        signal,
        userAgent: owner.getUserAgent(site)
      });
      if (
        signal?.aborted ||
        !runtimeRef.current.isWritableSessionTicketCurrent(ticket) ||
        siteSessionIdentityKey(runtimeRef.current.sessions[site]) !== ownerKey
      )
        throw new Error('编辑读取已失效');
      return value;
    },
    [runtimeRef]
  );

  const installDraft = useCallback((value: TopicDraft | null) => {
    draftRef.current = value;
    setDraft(value);
  }, []);
  const change = useCallback(
    (update: (current: TopicDraft) => TopicDraft) => {
      const current = draftRef.current;
      if (
        !current ||
        busyRef.current ||
        transitionRef.current ||
        siteSessionIdentityKey(runtimeRef.current.sessions[current.source]) !== current.identityKey
      )
        return;
      const next = update(current);
      if (next === current) return;
      installDraft({ ...next, revision: current.revision + 1, updatedAt: Date.now() });
      setSaveStatus('正在保存…');
      setErrors({});
    },
    [installDraft, runtimeRef]
  );

  const persist = useCallback(async (value: TopicDraft) => {
    if (savedRevision.current?.id === value.id && savedRevision.current.revision >= value.revision) return;
    const operation = saving.current
      .catch(() => undefined)
      .then(async () => {
        // A queued autosave can become stale while a newer explicit flush is committing.
        if (savedRevision.current?.id === value.id && savedRevision.current.revision >= value.revision) return;
        const accepted = await saveTopicDraft(value);
        if (!accepted) throw new Error('草稿已在其他页面更新，请重新进入后继续编辑');
        if (draftRef.current?.id === value.id) savedRevision.current = { id: value.id, revision: value.revision };
        if (mounted.current && draftRef.current?.id === value.id && draftRef.current.revision === value.revision) {
          setSaveStatus('已保存到本机');
          setDraftSites((previous) => ({ ...previous, [value.source]: true }));
        }
      });
    saving.current = operation;
    try {
      await operation;
    } catch (cause) {
      if (mounted.current && draftRef.current?.id === value.id) setSaveStatus(`保存失败：${errorMessage(cause)}`);
      throw cause;
    }
  }, []);

  const acceptSnapshot = useCallback(
    (snapshot: ComposerSnapshot, draftId?: string) => {
      const current = draftRef.current;
      if (!current || (draftId && current.id !== draftId) || current.source === 'yaohuo') return;
      if (current.edit && snapshot.revision === 0) return;
      snapshotIssues.current = { draftId: current.id, issues: snapshot.validationIssues };
      const contentChanged =
        current.body !== snapshot.markdown ||
        JSON.stringify(current.pendingNodeSeekPolls) !== JSON.stringify(snapshot.pendingNodeSeekPolls);
      if (!contentChanged && current.mode === snapshot.mode) return;
      const next = {
        ...current,
        body: snapshot.markdown,
        mode: snapshot.mode,
        pendingNodeSeekPolls: snapshot.pendingNodeSeekPolls,
        revision: current.revision + 1,
        updatedAt: Date.now()
      };
      installDraft(next);
      setSaveStatus('正在保存…');
      if (contentChanged)
        setErrors((previous) =>
          Object.fromEntries(Object.entries(previous).filter(([key]) => key !== 'body' && key !== 'poll'))
        );
    },
    [installDraft]
  );

  const flush = useCallback(async () => {
    const before = draftRef.current;
    if (!before) return null;
    setSaveStatus('正在保存…');
    try {
      if (before.source !== 'yaohuo' && editorRef.current) {
        const snapshot = await editorRef.current.requestSnapshot();
        if (draftRef.current?.id !== before.id) throw new Error('草稿已切换，请重试');
        acceptSnapshot(snapshot, before.id);
      }
      let latest = draftRef.current;
      while (latest) {
        await persist(latest);
        if (draftRef.current?.id !== before.id) throw new Error('草稿已切换，请重试');
        if (draftRef.current.revision === latest.revision) {
          if (mounted.current) setSaveStatus('已保存到本机');
          return latest;
        }
        latest = draftRef.current;
      }
      return null;
    } catch (cause) {
      if (mounted.current && draftRef.current?.id === before.id) setSaveStatus(`保存失败：${errorMessage(cause)}`);
      throw cause;
    }
  }, [acceptSnapshot, persist]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      uploadRef.current?.abort.abort();
    };
  }, []);
  useEffect(() => {
    if (initialSource) return;
    let alive = true;
    void readLastTopicCreationSource()
      .catch(() => null)
      .then((previous) => {
        if (!alive) return;
        const available = runtimeRef.current.enabledSources;
        setSource(
          previous && available.includes(previous)
            ? previous
            : SOURCES.find((site) => available.includes(site)) || 'nodeseek'
        );
      });
    return () => {
      alive = false;
    };
  }, [initialSource, runtimeRef]);
  useEffect(() => {
    if (!source) return;
    let alive = true;
    const abort = new AbortController();
    setLoading(true);
    setError('');
    completedContext.current = '';
    completedEmojis.current = '';
    setEmojiUrls({});
    setContext(null);
    setEditContext(null);
    setContextError('');
    setErrors({});
    void (async () => {
      const previous = draftRef.current;
      // Keep the old owner installed until its in-flight upload has recorded its result.
      // Do not abort an already dispatched request solely because the account changed:
      // its authoritative response still belongs to the original draft.
      const pending = uploadRef.current;
      if (pending) await pending.promise;
      if (!alive) return;
      // Explicit site switches already flush before changing source; account changes still need it.
      if (previous?.source === source) await flush();
      if (!alive) return;
      if (!identityKey || identityKey.endsWith(':anonymous')) {
        installDraft(null);
        setAttempt(null);
        return;
      }
      const [stored, submission] = await Promise.all([
        loadTopicDraft(source, identityKey, target),
        readTopicSubmissionAttempt(source, identityKey, target)
      ]);
      const editing =
        editTopicId && !stored ? await readEditContext(source, identityKey, editTopicId, abort.signal) : null;
      let restored = stored
        ? await verifyTopicDraftAttachments(stored)
        : editing
          ? draftFromTopicEdit(editing)
          : emptyTopicDraft(source, identityKey);
      if (restored.edit && submission?.draftId === restored.id && submission.confirmed) {
        const original = { ...restored.edit.original, ...submission.confirmed };
        if (JSON.stringify(original) !== JSON.stringify(restored.edit.original))
          restored = {
            ...restored,
            ...(submission.revision === restored.revision ? submission.confirmed : {}),
            edit: { ...restored.edit, original },
            revision: restored.revision + 1,
            updatedAt: Date.now()
          } as TopicDraft;
      }
      if (stored && JSON.stringify(restored.attachments) !== JSON.stringify(stored.attachments))
        restored = { ...restored, revision: stored.revision + 1, updatedAt: Date.now() };
      if (!alive) return;
      savedRevision.current = stored ? { id: stored.id, revision: stored.revision } : null;
      installDraft(restored);
      if (editing) {
        setEditContext(editing);
        setContext(editing.rules);
      }
      setAttempt(submission?.status === 'saved' && submission.draftId !== restored.id ? null : submission);
      if (submission?.status === 'partial' && submission.draftId === restored.id)
        setError(submission.result?.message || '部分修改已保存，请核对剩余修改后继续');
      setSaveStatus(stored ? '已恢复本机草稿' : '自动保存到本机');
      if (stored && restored.revision !== stored.revision) await persist(restored);
    })()
      .catch((cause) => {
        if (alive) {
          setError(errorMessage(cause));
          setSaveStatus(`保存或恢复失败：${errorMessage(cause)}`);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      abort.abort();
    };
  }, [source, identityKey, target, editTopicId, draftReload, flush, installDraft, persist, readEditContext]);
  useEffect(() => {
    let alive = true;
    void Promise.all(
      SOURCES.map(async (site) => {
        const key = siteSessionIdentityKey(runtime.sessions[site]);
        return [site, !key.endsWith(':anonymous') && Boolean(await loadTopicDraft(site, key))] as const;
      })
    )
      .then((rows) => {
        if (alive) setDraftSites(Object.fromEntries(rows));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [runtime.sessions]);
  useEffect(() => {
    if (!draft || loading) return;
    const timer = setTimeout(() => {
      void persist(draft).catch(() => undefined);
    }, 400);
    return () => clearTimeout(timer);
  }, [draft, loading, persist]);
  useEffect(() => {
    if (editTopicId || !source || !enabled || loading || draft?.source !== source) return;
    let alive = true;
    void saveLastTopicCreationSource(source).catch((cause) => {
      if (alive) setError(`无法保存上次使用的网站：${errorMessage(cause)}`);
    });
    return () => {
      alive = false;
    };
  }, [source, enabled, loading, draft?.source, editTopicId]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      const value = draftRef.current;
      // Pickers pause the WebView. Its queued autosnapshot resumes with it; requesting
      // another snapshot on native foreground can time out before the renderer wakes.
      if (state !== 'active' && value) void persist(value).catch(() => undefined);
    });
    return () => listener.remove();
  }, [persist]);

  const assertLocalOwner = useCallback(
    (value: TopicDraft, ticket?: WritableSessionTicket) => {
      const currentRuntime = runtimeRef.current;
      const current = draftRef.current;
      if (
        !mounted.current ||
        !activeRef.current ||
        sourceRef.current !== value.source ||
        !current ||
        current.id !== value.id ||
        current.source !== value.source ||
        current.identityKey !== value.identityKey ||
        !currentRuntime.enabledSources.includes(value.source) ||
        siteSessionIdentityKey(currentRuntime.sessions[value.source]) !== value.identityKey ||
        (ticket && !currentRuntime.isWritableSessionTicketCurrent(ticket))
      ) {
        throw new Error('站点或账号已变化，请重新确认后重试');
      }
    },
    [activeRef, runtimeRef, sourceRef]
  );
  const assertOwner = useCallback(
    (value: TopicDraft, ticket?: WritableSessionTicket) => {
      assertLocalOwner(value, ticket);
      if (!runtimeRef.current.appActive) {
        throw new Error('站点或账号已变化，请重新确认后重试');
      }
    },
    [assertLocalOwner, runtimeRef]
  );
  const requestAccess = useCallback(
    async (value: TopicDraft, dispatchState?: RequestDispatchState) => {
      const owner = runtimeRef.current;
      const ticket = await owner.ensureWritableSession(value.source);
      assertOwner(value, ticket);
      await owner.ensureNetworkProxyReady();
      assertOwner(value, ticket);
      const fetcher: Fetcher = (input, init) =>
        withRequestBeforeSend(
          owner.fetcher,
          () => assertOwner(value, ticket),
          init?.method && !['GET', 'HEAD', 'OPTIONS'].includes(init.method.toUpperCase()) ? dispatchState : undefined
        )(input, init);
      return { ticket, fetcher, userAgent: owner.getUserAgent(value.source) };
    },
    [assertOwner, runtimeRef]
  );

  const draftId = draft?.id;
  const readWithVerification = useCallback(
    async <T>(value: TopicDraft, signal: AbortSignal, key: readonly unknown[], read: () => Promise<T>): Promise<T> => {
      const epoch = runtimeRef.current.sessionEpochs[value.source];
      let settled = false;
      const isCurrent = () => {
        try {
          assertOwner(value);
          return !settled && !signal.aborted && runtimeRef.current.sessionEpochs[value.source] === epoch;
        } catch {
          return false;
        }
      };
      let challenge: unknown;
      try {
        return await read();
      } catch (cause) {
        if (
          !isCurrent() ||
          value.source !== 'linuxdo' ||
          sourceErrorFromUnknown('linuxdo', cause).kind !== 'verification-required'
        )
          throw cause;
        challenge = cause;
      }
      return new Promise<T>((resolve, reject) => {
        const finish = (result: { value: T } | { error: unknown }) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', cancel);
          if ('value' in result) resolve(result.value);
          else reject(result.error);
        };
        const cancel = () => finish({ error: new Error('验证已取消，草稿已保留，请重试读取') });
        const recovery: LinuxDoReadRecovery = {
          queryKey: ['create-topic', value.identityKey, value.id, epoch, ...key],
          isCurrent,
          cancel,
          resume: async () => {
            if (!isCurrent()) {
              cancel();
              return 'stale';
            }
            try {
              const result = await read();
              if (!isCurrent()) {
                cancel();
                return 'stale';
              }
              finish({ value: result });
              return 'completed';
            } catch (cause) {
              if (!isCurrent()) {
                cancel();
                return 'stale';
              }
              if (sourceErrorFromUnknown('linuxdo', cause).kind === 'verification-required')
                return 'verification-required';
              finish({ error: cause });
              throw cause;
            }
          }
        };
        signal.addEventListener('abort', cancel, { once: true });
        void Promise.resolve(runtimeRef.current.openAccount('linuxdo', errorMessage(challenge), recovery)).then(
          (accepted) => {
            if (!accepted) cancel();
          },
          (error: unknown) => finish({ error })
        );
      });
    },
    [assertOwner, runtimeRef]
  );
  const sessionEpoch = source ? runtime.sessionEpochs[source] : 0;
  const contextKey = JSON.stringify([draftId, sessionEpoch, contextReload]);
  useEffect(() => {
    if (!draftId || loading || !active || !runtime.appActive || !enabled || !session?.canWrite) return;
    if (completedContext.current === contextKey) return;
    const value = draftRef.current!;
    const abort = new AbortController();
    setContext(null);
    setContextLoading(true);
    setContextError('');
    setContextNeedsVerification(false);
    void (async () => {
      const read = async () => {
        const access = await requestAccess(value);
        const options = { ...access, signal: abort.signal };
        if (value.edit) {
          const editing = await runtimeRef.current.getTopicEditContext({
            source: value.source,
            topicId: value.edit.topicId,
            identityKey: value.identityKey,
            userAgent: access.userAgent,
            signal: abort.signal
          });
          assertOwner(value, access.ticket);
          if (!abort.signal.aborted) setEditContext(editing);
          return editing.rules;
        }
        const result =
          value.source === 'nodeseek'
            ? await loadNodeSeekTopicCreationContext(options)
            : value.source === 'linuxdo'
              ? await runtimeRef.current.getLinuxDoTopicCreationContext({ source: 'linuxdo', signal: abort.signal })
              : await loadYaohuoTopicCreationContext(options);
        assertOwner(value, access.ticket);
        return result;
      };
      const result = await readWithVerification(value, abort.signal, ['rules'], read);
      if (!abort.signal.aborted) {
        completedContext.current = contextKey;
        setContext(result);
        if (
          !value.edit &&
          !draftRef.current?.categoryId &&
          result.defaultCategoryId &&
          result.categories.some((item) => item.id === result.defaultCategoryId && item.canCreate !== false)
        ) {
          change((current) => applyTopicCategory(current, result.defaultCategoryId!, result));
        }
      }
    })()
      .catch((cause) => {
        if (!abort.signal.aborted) {
          setContextError(errorMessage(cause));
          const kind = sourceErrorFromUnknown(value.source, cause).kind;
          setContextNeedsVerification(['verification-required', 'login-required', 'login-expired'].includes(kind));
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setContextLoading(false);
      });
    return () => abort.abort();
  }, [
    draftId,
    loading,
    active,
    runtime.appActive,
    enabled,
    session?.canWrite,
    contextKey,
    requestAccess,
    readWithVerification,
    assertOwner,
    runtimeRef,
    change
  ]);
  useEffect(() => {
    if (
      context?.source !== 'linuxdo' ||
      !active ||
      !runtime.appActive ||
      !enabled ||
      !session?.canWrite ||
      completedContext.current !== contextKey ||
      completedEmojis.current === contextKey
    )
      return;
    const abort = new AbortController();
    void retryEmojiCatalog(
      () => runtimeRef.current.getEmojiUrls({ source: 'linuxdo', signal: abort.signal }),
      abort.signal
    ).then(
      (urls) => {
        if (abort.signal.aborted) return;
        completedEmojis.current = contextKey;
        setEmojiUrls(urls);
      },
      () => {
        if (abort.signal.aborted) return;
        setEmojiUrls({});
      }
    );
    return () => abort.abort();
  }, [active, context, contextKey, enabled, runtime.appActive, runtimeRef, session?.canWrite]);

  const waitForUploads = useCallback(async () => {
    const pending = uploadRef.current;
    if (!pending) return true;
    const choice = await new Promise<'wait' | 'cancel' | 'stay'>((resolve) =>
      Alert.alert(
        '上传尚未结束',
        '可以等待上传完成，或取消剩余上传后继续。已完成的上传和本地文件都会保留。',
        [
          { text: '留在此页', style: 'cancel', onPress: () => resolve('stay') },
          { text: '取消剩余上传', onPress: () => resolve('cancel') },
          { text: '等待上传完成', onPress: () => resolve('wait') }
        ],
        { cancelable: true, onDismiss: () => resolve('stay') }
      )
    );
    if (choice === 'stay') return false;
    if (choice === 'cancel') pending.abort.abort();
    await pending.promise;
    return true;
  }, []);
  const switchSource = useCallback(
    async (next: TopicCreationSource) => {
      if (editTopicId || busyRef.current || transitionRef.current || next === source) return;
      transitionRef.current = true;
      try {
        if (!(await waitForUploads())) return;
        await flush();
        setSource(next);
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        transitionRef.current = false;
      }
    },
    [flush, source, waitForUploads, editTopicId]
  );
  const leave = useCallback(async () => {
    if (busyRef.current || transitionRef.current) {
      setError('正在保存或发布，请等待结果');
      return false;
    }
    transitionRef.current = true;
    try {
      if (!(await waitForUploads())) return false;
      await flush();
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    } finally {
      transitionRef.current = false;
    }
  }, [flush, waitForUploads]);

  const applyConfirmedEdit = useCallback(
    async (value: TopicDraft, confirmed?: Partial<TopicEditableFields>, sentRevision = value.revision) => {
      if (draftRef.current?.id === value.id) value = draftRef.current;
      if (!value.edit || !confirmed || !Object.keys(confirmed).length) return value;
      const original = { ...value.edit.original, ...confirmed };
      if (JSON.stringify(original) === JSON.stringify(value.edit.original)) return value;
      const updated = {
        ...value,
        ...(value.revision === sentRevision ? confirmed : {}),
        edit: { ...value.edit, original },
        revision: value.revision + 1,
        updatedAt: Date.now()
      } as TopicDraft;
      // Install before awaiting disk so late editor snapshots build on this revision.
      if (draftRef.current?.id === value.id) installDraft(updated);
      await persist(updated);
      return updated;
    },
    [persist, installDraft]
  );

  const submitEdit = useCallback(async () => {
    if (
      busyRef.current ||
      uploadRef.current ||
      transitionRef.current ||
      loading ||
      !editContext ||
      (attempt?.status === 'saved' && attempt.draftId === draftRef.current?.id)
    )
      return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    let value: TopicDraft | null = null;
    let submission: TopicSubmissionAttempt | undefined;
    let result: TopicEditResult | undefined;
    const dispatchState: RequestDispatchState = { mayHaveSent: false };
    try {
      value = await flush();
      if (!value?.edit) return;
      if (!hasTopicEditChanges(value)) {
        runtimeRef.current.notify('没有需要保存的修改');
        return;
      }
      if (attempt?.status === 'unknown' || attempt?.status === 'sending') throw new Error('请先核对上次保存结果');
      const validation = validateTopicEdit(value, editContext);
      if (snapshotIssues.current?.draftId === value.id && snapshotIssues.current.issues.length)
        validation.body = snapshotIssues.current.issues[0]!.message;
      setErrors(validation);
      if (Object.keys(validation).length) return;
      const access = await requestAccess(value, dispatchState);
      const sentDraft = value;
      const assertCurrent = () => {
        assertOwner(sentDraft, access.ticket);
        if (draftRef.current?.revision !== sentDraft.revision) throw new Error('草稿已更新，请确认后重试');
      };
      if (
        value.source === 'nodeseek' &&
        value.rank === 255 &&
        value.edit.original.rank !== 255 &&
        !(await confirm('改为私有帖子', '原站将收取 10 鸡腿。', '确认保存'))
      )
        return;
      if (
        value.additionalReward &&
        !(await confirm('确认追加悬赏', `本次将追加 ${value.additionalReward} 妖晶。`, '确认保存'))
      )
        return;
      assertCurrent();
      const fresh =
        value.source === 'linuxdo'
          ? await readEditContext(value.source, value.identityKey, value.edit.topicId)
          : editContext;
      assertCurrent();
      submission = {
        id: identifier(),
        source: value.source,
        identityKey: value.identityKey,
        target: topicDraftTarget(value),
        draftId: value.id,
        revision: value.revision,
        startedAt: Date.now(),
        status: 'sending'
      };
      await beginTopicSubmissionAttempt(submission);
      setAttempt(submission);
      let body = value.body;
      if (value.source === 'nodeseek' && value.pendingNodeSeekPolls.length) {
        body = await materializePendingNodeSeekPolls({
          content: body,
          polls: value.pendingNodeSeekPolls,
          identityKey: value.identityKey,
          assertCurrent,
          confirmReplacement: () => confirm('投票已有创建记录', '修改后的投票会创建新对象，继续？', '继续保存'),
          notify: runtimeRef.current.notify,
          createPoll: async (poll, options) => {
            const response = await runNodeSeekAction({
              fetcher: withRequestBeforeSend(access.fetcher, assertCurrent, options.dispatchState),
              userAgent: access.userAgent,
              request: buildNodeSeekPollCreateRequest({ poll })
            });
            await options.persistResult(response);
            assertCurrent();
            return response;
          }
        });
      }
      const options = {
        draft: { ...value, body },
        fetcher: withRequestBeforeSend(access.fetcher, assertCurrent),
        userAgent: access.userAgent
      };
      result =
        value.source === 'nodeseek'
          ? await editNodeSeekTopic(options)
          : value.source === 'yaohuo'
            ? await editYaohuoTopic(options)
            : await editLinuxDoTopic({
                ...options,
                context: fresh,
                checkpoint: (fields) => checkpointTopicEdit(submission!, fields)
              });
      if (!(await settleTopicSubmissionAttempt(submission, result))) throw new Error('保存记录已变化，请先到原站核对');
      if (result.status === 'saved') {
        savedRevision.current = { id: value.id, revision: Number.MAX_SAFE_INTEGER };
        await Promise.allSettled(value.attachments.map((file) => removeTopicDraftAttachmentFile(value!, file)));
      } else await applyConfirmedEdit(value, result.confirmed);
      if (
        !mounted.current ||
        draftRef.current?.id !== value.id ||
        siteSessionIdentityKey(runtimeRef.current.sessions[value.source]) !== value.identityKey
      )
        return;
      setAttempt({ ...submission, status: result.status, result, confirmed: result.confirmed });
      if (result.status === 'saved') {
        runtimeRef.current.notify(result.message);
      } else setError(result.message);
    } catch (cause) {
      if (submission && !result) {
        result = {
          status: dispatchState.mayHaveSent ? 'unknown' : 'rejected',
          message: dispatchState.mayHaveSent ? '保存结果未知，请到原站核对，勿重复提交' : errorMessage(cause)
        };
        try {
          await settleTopicSubmissionAttempt(submission, result);
        } catch {
          result = { status: 'unknown', message: '保存记录写入失败，请到原站核对' };
        }
      } else if (result)
        result = { ...result, status: 'unknown', message: '原站已返回结果，但本机记录未完成保存，请先核对' };
      if (
        mounted.current &&
        value &&
        draftRef.current?.id === value.id &&
        siteSessionIdentityKey(runtimeRef.current.sessions[value.source]) === value.identityKey
      ) {
        if (submission && result) setAttempt({ ...submission, status: result.status, result });
        setError(result?.message || errorMessage(cause));
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [
    loading,
    editContext,
    attempt,
    flush,
    runtimeRef,
    requestAccess,
    assertOwner,
    readEditContext,
    applyConfirmedEdit
  ]);

  const submit = useCallback(async () => {
    if (editTopicId) return submitEdit();
    if (busyRef.current || uploadRef.current || transitionRef.current || loading) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    let submission: TopicSubmissionAttempt | undefined;
    const dispatchState: RequestDispatchState = { mayHaveSent: false };
    let result: CreateTopicResult | undefined;
    try {
      const value = await flush();
      if (!value || !context || context.source !== value.source) throw new Error('请先加载当前站点的发帖设置');
      const validation = validateTopicDraft(value, context);
      if (snapshotIssues.current?.draftId === value.id && snapshotIssues.current.issues.length)
        validation.body = snapshotIssues.current.issues[0]!.message;
      setErrors(validation);
      if (Object.keys(validation).length) return;
      const access = await requestAccess(value, dispatchState);
      const assertSubmissionCurrent = () => {
        assertOwner(value, access.ticket);
        if (draftRef.current?.revision !== value.revision) throw new Error('草稿已更新，请确认最新内容后重新发布');
      };
      if (value.source === 'linuxdo') {
        const latestTags = await searchLinuxDoTopicTags({
          ...access,
          categoryId: value.categoryId,
          selectedTags: value.tags,
          query: ''
        });
        assertSubmissionCurrent();
        if (latestTags.forbidden || latestTags.forbiddenMessage) {
          setErrors({ tags: latestTags.forbiddenMessage || `此标签不可使用：${latestTags.forbidden}` });
          return;
        }
        if (latestTags.requiredGroup) {
          setErrors({
            tags: `请从${latestTags.requiredGroup.name || '要求的标签组'}选择至少 ${latestTags.requiredGroup.minCount} 个标签`
          });
          return;
        }
      }
      if (
        value.source === 'nodeseek' &&
        value.categoryId === 'inside' &&
        !(await confirm(
          '发布到内版',
          `本次发布将收取 ${context.source === 'nodeseek' ? context.insideFee : 5} 鸡腿。`,
          '确认发布'
        ))
      )
        return;
      if (value.source === 'yaohuo') {
        const amount =
          value.kind === 'gift'
            ? value.gift.total
            : value.kind === 'poll' && value.poll.giftEnabled
              ? value.poll.total
              : value.kind === 'normal'
                ? value.reward
                : '';
        if (amount && !(await confirm('确认发布金额', `本帖包含 ${amount} 妖晶的悬赏或派币设置。`, '确认发布'))) return;
      }
      assertSubmissionCurrent();
      const candidate: TopicSubmissionAttempt = {
        id: identifier(),
        source: value.source,
        identityKey: value.identityKey,
        draftId: value.id,
        revision: value.revision,
        startedAt: Date.now(),
        status: 'sending'
      };
      await beginTopicSubmissionAttempt(candidate);
      submission = candidate;
      setAttempt(submission);
      let body = value.body;
      if (value.source === 'nodeseek') {
        body = await materializePendingNodeSeekPolls({
          content: body,
          polls: value.pendingNodeSeekPolls,
          identityKey: value.identityKey,
          assertCurrent: assertSubmissionCurrent,
          confirmReplacement: () => confirm('投票已有创建记录', '修改后的投票会创建一个新对象，继续？', '继续发布'),
          notify: runtimeRef.current.notify,
          createPoll: async (poll, options) => {
            const pollFetcher: Fetcher = (input, init) =>
              withRequestBeforeSend(
                runtimeRef.current.fetcher,
                assertSubmissionCurrent,
                options.dispatchState
              )(input, init);
            const response = await runNodeSeekAction({
              fetcher: pollFetcher,
              userAgent: access.userAgent,
              request: buildNodeSeekPollCreateRequest({ poll })
            });
            await options.persistResult(response);
            assertSubmissionCurrent();
            return response;
          }
        });
      }
      assertSubmissionCurrent();
      const options = {
        input: { draft: value, body },
        fetcher: withRequestBeforeSend(access.fetcher, assertSubmissionCurrent),
        userAgent: access.userAgent
      };
      result =
        value.source === 'nodeseek'
          ? await createNodeSeekTopic(options)
          : value.source === 'linuxdo'
            ? await createLinuxDoTopic(options)
            : await createYaohuoTopic(options);
      if (!(await settleTopicSubmissionAttempt(submission, result)))
        throw new Error('本机发布记录已变化，请到原站核对发布结果');
      if (result.status === 'posted' || result.status === 'enqueued')
        await Promise.allSettled(value.attachments.map((file) => removeTopicDraftAttachmentFile(value, file)));
      if (
        !mounted.current ||
        draftRef.current?.id !== value.id ||
        siteSessionIdentityKey(runtimeRef.current.sessions[value.source]) !== value.identityKey
      )
        return;
      setAttempt({ ...submission, status: result.status, result });
      if (result.status === 'posted' || result.status === 'enqueued') {
        const canNavigate = activeRef.current && runtimeRef.current.enabledSources.includes(value.source);
        if (draftRef.current.revision === value.revision) {
          savedRevision.current = { id: value.id, revision: Number.MAX_SAFE_INTEGER };
          if (!canNavigate) {
            installDraft(emptyTopicDraft(value.source, value.identityKey));
            setSaveStatus('自动保存到本机');
            setDraftSites((previous) => ({ ...previous, [value.source]: false }));
          }
        }
        if (!canNavigate) return;
        runtimeRef.current.notify(result.message);
        if (result.status === 'posted' && result.topic) onPosted(result.topic);
        else onAccepted();
      } else setError(result.message);
    } catch (cause) {
      const message = errorMessage(cause);
      if (submission && !result) {
        let failure: CreateTopicResult = dispatchState.mayHaveSent
          ? { status: 'unknown', message: '发布结果未知，请先到原站核对，勿直接重发' }
          : { status: 'rejected', message };
        try {
          if (!(await settleTopicSubmissionAttempt(submission, failure)))
            failure = { status: 'unknown', message: '本机发布记录已变化，请先到原站核对，勿直接重发' };
        } catch {
          failure = { status: 'unknown', message: '发布记录保存失败，请先到原站核对，勿直接重发' };
        }
        if (
          mounted.current &&
          draftRef.current?.id === submission.draftId &&
          siteSessionIdentityKey(runtimeRef.current.sessions[submission.source]) === submission.identityKey
        ) {
          setAttempt({ ...submission, status: failure.status, result: failure });
          setError(failure.message);
        }
      } else setError(result ? '原站已返回发布结果，但本机记录保存失败。请先到原站核对，勿重复发布。' : message);
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [
    activeRef,
    assertOwner,
    context,
    flush,
    installDraft,
    loading,
    onAccepted,
    onPosted,
    requestAccess,
    runtimeRef,
    editTopicId,
    submitEdit
  ]);

  const acknowledgeUnknown = useCallback(async () => {
    if (
      busyRef.current ||
      !attempt ||
      !(await confirm(
        editTopicId ? '确认未保存的部分' : '确认没有发布成功',
        editTopicId
          ? '请在原站核对剩余修改和追加悬赏，确认未生效后才解除再次保存限制。已确认保存的字段不会重发。'
          : '请先在原站核对。确认未发布后，才解除本稿的再次发布限制。',
        editTopicId ? '已核对，未保存' : '已核对，未发布'
      ))
    )
      return;
    if (busyRef.current || transitionRef.current) return;
    transitionRef.current = true;
    try {
      if (
        busyRef.current ||
        draftRef.current?.source !== attempt.source ||
        siteSessionIdentityKey(runtimeRef.current.sessions[attempt.source]) !== attempt.identityKey
      )
        throw new Error('站点或账号已变化，请重新核对当前草稿');
      if (editTopicId) {
        // Keep the durable checkpoint until its confirmed baseline is safely in the draft.
        const recorded = await readTopicSubmissionAttempt(attempt.source, attempt.identityKey, target);
        if (recorded?.id !== attempt.id) throw new Error('保存记录已变化，请重新进入后核对');
        const value = await flush();
        if (value?.id === recorded.draftId) await applyConfirmedEdit(value, recorded.confirmed, recorded.revision);
      }
      if (
        draftRef.current?.source !== attempt.source ||
        siteSessionIdentityKey(runtimeRef.current.sessions[attempt.source]) !== attempt.identityKey
      )
        throw new Error('站点或账号已变化，请重新核对当前草稿');
      if (!(await acknowledgeTopicSubmissionAttempt(attempt.source, attempt.identityKey, attempt.id, target)))
        throw new Error('发布记录已变化，请重新进入后核对');
      if (
        !mounted.current ||
        draftRef.current?.source !== attempt.source ||
        siteSessionIdentityKey(runtimeRef.current.sessions[attempt.source]) !== attempt.identityKey
      )
        return;
      setAttempt(null);
      setError('');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      transitionRef.current = false;
    }
  }, [attempt, runtimeRef, editTopicId, target, flush, applyConfirmedEdit]);
  const discard = useCallback(async () => {
    if (busyRef.current || transitionRef.current || uploadRef.current || !draftRef.current) return;
    const owner = draftRef.current;
    transitionRef.current = true;
    try {
      if (!(await confirm('丢弃当前草稿', '只删除当前站点当前账号的本机草稿。', '丢弃'))) return;
      if (
        draftRef.current?.id !== owner.id ||
        siteSessionIdentityKey(runtimeRef.current.sessions[owner.source]) !== owner.identityKey
      )
        throw new Error('站点或账号已变化，请重新确认后重试');
      const value = await flush();
      if (!value) return;
      if (
        !(await discardTopicDraft(value.source, value.identityKey, value.id, value.revision, topicDraftTarget(value)))
      )
        throw new Error('草稿已更新，请重试');
      savedRevision.current = { id: value.id, revision: Number.MAX_SAFE_INTEGER };
      if (draftRef.current?.id === value.id) {
        if (value.edit) {
          installDraft(null);
          onAccepted();
        } else installDraft(emptyTopicDraft(value.source, value.identityKey));
        setSaveStatus('草稿已丢弃');
        setDraftSites((previous) => ({ ...previous, [value.source]: false }));
      }
      for (const file of value.attachments) await removeTopicDraftAttachmentFile(value, file);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      transitionRef.current = false;
    }
  }, [flush, installDraft, runtimeRef, onAccepted]);

  const insertMarkup = useCallback(
    async (markup: string) => {
      if (draftRef.current?.source === 'yaohuo')
        change((value) => ({ ...value, body: `${value.body}${value.body ? '\n' : ''}${markup}` }));
      else {
        if (!editorRef.current) throw new Error('编辑器尚未就绪，请稍后插入');
        await editorRef.current.insertMarkup(markup);
      }
    },
    [change]
  );

  const uploadFiles = useCallback(
    (files: TopicDraftAttachment[], insert = true) => {
      if (uploadRef.current || busyRef.current || transitionRef.current) return Promise.resolve(undefined);
      const value = draftRef.current;
      if (!value || !context || context.source !== value.source) return Promise.resolve(undefined);
      if (value.edit && !editContext?.permissions.body) return Promise.resolve(undefined);
      const abort = new AbortController();
      const promise = (async () => {
        const markups: string[] = [];
        const updateFile = async (id: string, patch: Partial<TopicDraftAttachment>) => {
          const current = draftRef.current;
          if (!current || current.id !== value.id || current.identityKey !== value.identityKey)
            throw new Error('上传所属草稿已变化，请先核对上传结果');
          const next = {
            ...current,
            revision: current.revision + 1,
            updatedAt: Date.now(),
            attachments: current.attachments.map((file) => (file.id === id ? { ...file, ...patch } : file))
          };
          // Account restoration waits for this promise. Persist the original owner's confirmed
          // result even if its session was replaced or this screen has already unmounted.
          draftRef.current = next;
          if (mounted.current) setDraft(next);
          await persist(next);
        };
        try {
          if (
            files.some(
              (file) => draftRef.current?.attachments.find((item) => item.id === file.id)?.status === 'unknown'
            ) &&
            !(await confirm(
              '核对上次上传结果',
              '上次上传可能已被原站接收。请先核对上传记录；确认仍需上传后，会创建新的远端文件。',
              '已核对，重新上传'
            ))
          )
            return;
          setUploading(true);
          setError('');
          const access = await requestAccess(value);
          const apiKey = value.source === 'nodeseek' ? await runtimeRef.current.ensureNodeImageApiKey() : null;
          const generation = currentNodeImageApiKeyGeneration();
          if (value.source === 'nodeseek' && !apiKey) throw new Error('请到账号中心获取 NodeImage 授权');
          for (const file of files) {
            if (abort.signal.aborted) break;
            assertOwner(value, access.ticket);
            const currentFile = draftRef.current?.attachments.find((item) => item.id === file.id);
            if (!currentFile || currentFile.status === 'uploaded') continue;
            await updateFile(file.id, { status: 'uploading', error: undefined });
            const dispatchState: RequestDispatchState = { mayHaveSent: false };
            let uploadResponseStatus: number | undefined;
            let confirmedMarkup: string | undefined;
            let placeholder: { editor: StructuredReplyComposerHandle; id: string } | undefined;
            try {
              if (insert && value.source !== 'yaohuo') {
                const editor = editorRef.current;
                if (!editor) throw new Error('编辑器尚未就绪，请稍后上传');
                placeholder = { editor, id: await editor.beginImageUpload() };
                assertOwner(value, access.ticket);
              }
              const markup = await uploadTopicAttachment({
                source: value.source,
                file: currentFile,
                context,
                signal: abort.signal,
                userAgent: access.userAgent,
                fetcher: async (input, init) => {
                  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes((init?.method || 'GET').toUpperCase());
                  const response = await withRequestBeforeSend(
                    access.fetcher,
                    () => {
                      assertOwner(value, access.ticket);
                      if (value.source === 'nodeseek' && generation !== currentNodeImageApiKeyGeneration())
                        throw new Error('NodeImage 凭据已变化');
                    },
                    mutation ? dispatchState : undefined
                  )(input, init);
                  if (mutation) uploadResponseStatus = response.status;
                  return response;
                },
                ensureNodeImageApiKey: async () => apiKey
              });
              confirmedMarkup = markup;
              await updateFile(file.id, { status: 'uploaded', markup, error: undefined });
              assertOwner(value, access.ticket);
              if (insert && value.source === 'yaohuo') {
                const current = draftRef.current!;
                installDraft({
                  ...current,
                  body: `${current.body}${current.body ? '\n' : ''}${markup}`,
                  revision: current.revision + 1,
                  updatedAt: Date.now()
                });
              } else if (placeholder) {
                await placeholder.editor.finishImageUpload(placeholder.id, markup);
                placeholder = undefined;
              } else markups.push(markup);
              if (draftRef.current) await persist(draftRef.current);
            } catch (cause) {
              // Only an explicit request rejection confirms that an upload did not succeed.
              // Timeout/conflict responses, 5xx and a lost response still require reconciliation.
              const unknown =
                dispatchState.mayHaveSent &&
                ![400, 401, 403, 404, 405, 413, 415, 422, 429].includes(uploadResponseStatus || 0);
              if (!confirmedMarkup)
                await updateFile(file.id, {
                  status: unknown ? 'unknown' : abort.signal.aborted && !uploadResponseStatus ? 'queued' : 'failed',
                  error: unknown ? '上传结果未知，请先核对，勿重复上传' : errorMessage(cause)
                });
              if (mounted.current && !abort.signal.aborted)
                setError(
                  confirmedMarkup
                    ? `${file.kind === 'image' ? '图片已上传，可在“更多 → 图片上传记录”中再次插入' : '附件已上传，可在附件面板中再次插入'}：${errorMessage(cause)}`
                    : errorMessage(cause)
                );
              break;
            } finally {
              // Only the captured editor owns this token; a restored draft must never receive it.
              if (placeholder) await placeholder.editor.finishImageUpload(placeholder.id).catch(() => undefined);
            }
          }
        } catch (cause) {
          if (mounted.current) setError(errorMessage(cause));
        } finally {
          uploadRef.current = null;
          if (mounted.current) setUploading(false);
        }
        return markups.length ? markups.join('\n') : undefined;
      })();
      uploadRef.current = { abort, promise };
      return promise;
    },
    [assertOwner, context, installDraft, persist, requestAccess, runtimeRef, editContext]
  );

  const pickAttachments = useCallback(
    async (kind: TopicDraftAttachment['kind'], hostInsert = false) => {
      if (!context || picking.current || busyRef.current || transitionRef.current || uploadRef.current) return;
      picking.current = true;
      setError('');
      const rejected: string[] = [];
      try {
        const value = await flush();
        if (!value) return;
        if (value.edit && !editContext?.permissions.body) throw new Error('原站不允许编辑正文');
        const ticket = await runtimeRef.current.ensureWritableSession(value.source);
        assertOwner(value, ticket);
        const selected = await DocumentPicker.getDocumentAsync({
          type: kind === 'image' ? 'image/*' : '*/*',
          multiple: true,
          copyToCacheDirectory: true
        });
        assertLocalOwner(value, ticket);
        if (selected.canceled) return;
        if (busyRef.current || transitionRef.current) throw new Error('正在保存或发布，请稍后重新选择文件');
        if (
          kind === 'yaohuo-file' &&
          value.attachments.filter((file) => file.kind === kind).length + selected.assets.length > 9
        )
          throw new Error('文件帖最多选择 9 个文件');
        const added: TopicDraftAttachment[] = [];
        for (const asset of selected.assets) {
          const normalizedAsset =
            kind === 'image' && !asset.mimeType
              ? { ...asset, mimeType: normalizeReplyImageAsset({ uri: asset.uri, name: asset.name }).mimeType }
              : asset;
          const file = await persistTopicDraftAttachment({ draft: value, asset: normalizedAsset, kind });
          try {
            try {
              validateTopicAttachment(file, context);
              if (kind === 'yaohuo-file' && ['image/jpeg', 'image/jpg', 'image/png'].includes(file.mimeType))
                await Image.getSize(file.uri);
            } catch (cause) {
              await removeTopicDraftAttachmentFile(value, file);
              rejected.push(`${file.name}：${errorMessage(cause)}`);
              continue;
            }
            assertLocalOwner(value, ticket);
            if (busyRef.current || transitionRef.current) throw new Error('正在保存或发布，请稍后重新选择文件');
            added.push(file);
            change((current) => ({ ...current, attachments: [...current.attachments, file] }));
          } catch (cause) {
            await removeTopicDraftAttachmentFile(value, file);
            throw cause;
          }
        }
        if (draftRef.current) await persist(draftRef.current);
        assertLocalOwner(value, ticket);
        if (kind !== 'yaohuo-file' && added.length) {
          assertOwner(value, ticket);
          return await uploadFiles(added, !hostInsert);
        }
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        picking.current = false;
        if (rejected.length) setError((current) => [rejected.join('\n'), current].filter(Boolean).join('\n'));
      }
    },
    [assertLocalOwner, assertOwner, change, context, flush, persist, runtimeRef, uploadFiles, editContext]
  );

  const removeAttachment = useCallback(
    async (file: TopicDraftAttachment) => {
      const value = draftRef.current;
      if (!value || uploadRef.current || busyRef.current || transitionRef.current) return;
      change((current) => ({ ...current, attachments: current.attachments.filter((item) => item.id !== file.id) }));
      try {
        if (draftRef.current) await persist(draftRef.current);
        await removeTopicDraftAttachmentFile(value, file);
      } catch (cause) {
        setError(errorMessage(cause));
      }
    },
    [change, persist]
  );

  const searchTags = useCallback(
    async (query: string, signal = new AbortController().signal) => {
      const value = draftRef.current;
      if (!value || value.source !== 'linuxdo' || !value.categoryId || signal.aborted) return;
      try {
        const found = await readWithVerification(
          value,
          signal,
          ['tags', value.categoryId, value.tags, query],
          async () => {
            const access = await requestAccess(value);
            const result = await searchLinuxDoTopicTags({
              ...access,
              signal,
              categoryId: value.categoryId,
              selectedTags: value.tags,
              query
            });
            assertOwner(value, access.ticket);
            return result;
          }
        );
        if (!signal.aborted) return found;
      } catch (cause) {
        if (signal.aborted) return;
        try {
          assertOwner(value);
        } catch {
          return;
        }
        throw cause;
      }
    },
    [assertOwner, requestAccess, readWithVerification]
  );

  const editorServices = {
    useTemplate: async () => {
      const value = draftRef.current;
      if (!value || value.source !== 'linuxdo') throw new Error('当前站点不支持模板');
      assertOwner(value);
    },
    loadTemplates: async () => {
      const value = draftRef.current;
      if (!value || value.source !== 'linuxdo') throw new Error('当前站点不支持模板');
      return fetchLinuxDoTemplates(await requestAccess(value));
    },
    resolveUpload: async (shortUrl: string) => {
      const value = draftRef.current;
      if (!value || value.source !== 'linuxdo') throw new Error('当前站点不支持该附件');
      return resolveLinuxDoUpload({ ...(await requestAccess(value)), shortUrl });
    }
  };
  return {
    editing: Boolean(editTopicId),
    editContext,
    hasChanges: draft ? hasTopicEditChanges(draft) : false,
    source,
    draft,
    context,
    loading,
    contextLoading,
    busy,
    uploading,
    error,
    contextError,
    contextNeedsVerification,
    errors,
    saveStatus,
    attempt,
    draftSites,
    emojiUrls,
    editorRef,
    enabled,
    session,
    change,
    acceptSnapshot,
    flush,
    switchSource,
    leave,
    submit,
    discard,
    acknowledgeUnknown,
    searchTags,
    pickAttachments,
    uploadFiles,
    removeAttachment,
    insertMarkup,
    editorServices,
    reloadContext: () => setContextReload((value) => value + 1),
    retryDraft: () => setDraftReload((value) => value + 1),
    reviewLatest: async () => {
      try {
        const value = await flush();
        if (!value?.edit) return;
        const fresh = await readEditContext(value.source, value.identityKey, value.edit.topicId);
        assertOwner(value);
        setEditContext(fresh);
        return fresh.original;
      } catch (cause) {
        setError(errorMessage(cause));
      }
    },
    rebaseEdit: async () => {
      if (!editContext || busyRef.current || attempt?.status === 'unknown' || attempt?.status === 'sending') return;
      try {
        const value = await flush();
        if (!value?.edit) return;
        if (
          !(await confirm(
            '保留本机修改继续',
            '已核对原站最新内容。继续后，下次保存将以最新内容为基准提交你的修改。',
            '继续编辑'
          ))
        )
          return;
        assertOwner(value);
        const updated = {
          ...value,
          ...editContext.original,
          ...topicEditChanges(value),
          edit: { ...value.edit, original: editContext.original },
          revision: value.revision + 1,
          updatedAt: Date.now()
        } as TopicDraft;
        await persist(updated);
        installDraft(updated);
        setError('');
      } catch (cause) {
        setError(errorMessage(cause));
      }
    },
    changeCategory: async (categoryId: string) => {
      if (!context || busyRef.current) return;
      const request = ++categoryRequest.current;
      if (draftRef.current?.categoryId === categoryId) return;
      const before = draftRef.current;
      try {
        await flush();
        if (request !== categoryRequest.current || draftRef.current?.id !== before?.id) return;
        change((value) => (value.edit ? { ...value, categoryId } : applyTopicCategory(value, categoryId, context)));
      } catch (cause) {
        setError(errorMessage(cause));
      }
    }
  };
}
