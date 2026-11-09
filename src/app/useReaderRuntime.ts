import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import { recordStartupPhase } from '@/platform/diagnostics/startupTiming';
import { errorMessage } from '@/platform/network/errors';
import {
  applyReaderChange,
  createEmptyReaderState,
  projectReaderCommand,
  type ReaderCommand,
  type ReaderStatus,
  type ReaderState
} from '@/domain/reader/readerRecordState';
import {
  commitReaderCommand,
  exportReaderDataBackup,
  importReaderDataBackup,
  loadReaderState
} from '@/platform/storage/readerDataStore';
import { beginDiagnosticTrace, finishDiagnosticTrace } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';

export async function loadInitialReaderData({
  isActive,
  load = loadReaderState,
  notify,
  onLoaded
}: {
  isActive: () => boolean;
  load?: () => Promise<ReaderState>;
  notify: (message: string) => void;
  onLoaded: (data: ReaderState, status: Exclude<ReaderStatus, 'loading'>) => void;
}) {
  try {
    const state = await load();
    if (isActive()) onLoaded(state, 'ready');
  } catch (error) {
    if (!isActive()) return;
    notify(`本机资料读取失败，已进入恢复模式；请先导入备份再修改本机资料：${errorMessage(error)}`);
    onLoaded(createEmptyReaderState(), 'recovery');
  }
}

export function useReaderRuntime({ notify }: { notify: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [readerData, setReaderData] = useState(createEmptyReaderState);
  const [readerStatus, setReaderStatus] = useState<ReaderStatus>('loading');
  const lifetimeRef = useRef(new AbortController());
  const notifyRef = useCommittedRef(notify);
  const statusRef = useRef<ReaderStatus>('loading');
  const updateStatus = useCallback((status: ReaderStatus) => {
    statusRef.current = status;
    if (!lifetimeRef.current.signal.aborted) setReaderStatus(status);
  }, []);
  const readerDataRef = useRef(readerData);
  const committed = useRef(readerData);
  const pending = useRef<{ command: ReaderCommand; owner: AbortSignal }[]>([]);

  useLayoutEffect(() => {
    if (lifetimeRef.current.signal.aborted) lifetimeRef.current = new AbortController();
    const lifetime = lifetimeRef.current;
    for (const operation of pending.current) operation.owner = lifetime.signal;
    return () => lifetime.abort();
  }, []);

  const publish = useCallback(() => {
    const state = pending.current.reduce(
      (value, operation) => projectReaderCommand(value, operation.command),
      committed.current
    );
    readerDataRef.current = state;
    if (!lifetimeRef.current.signal.aborted) setReaderData(state);
  }, []);

  const commitReaderData = useCallback(
    (command: ReaderCommand) => {
      if (lifetimeRef.current.signal.aborted) return;
      if (statusRef.current !== 'ready') {
        notifyRef.current(
          statusRef.current === 'recovery'
            ? '本机资料读取失败，请先导入备份再修改本机资料。'
            : '本机资料尚未加载完成，请稍后再试。'
        );
        return;
      }
      const trace = beginDiagnosticTrace('reader-data', 'mutate', { state: 'queued' });
      const operation = { command, owner: lifetimeRef.current.signal };
      pending.current.push(operation);
      publish();
      // Storage is the single ordering owner. UI completion handlers preserve the
      // same order and rebase pending absolute intents after success or rollback.
      const result = commitReaderCommand(command)
        .then(
          (change) => {
            committed.current = applyReaderChange(committed.current, change);
            for (const collection of change.changed)
              void queryClient.invalidateQueries({ queryKey: ['reader-library', collection] });
            finishDiagnosticTrace(trace, 'success');
          },
          (error) => {
            if (error instanceof AggregateError) updateStatus('recovery');
            finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
            if (!operation.owner.aborted && lifetimeRef.current.signal === operation.owner)
              notifyRef.current(errorMessage(error));
          }
        )
        .finally(() => {
          pending.current = pending.current.filter((item) => item !== operation);
          publish();
        });
      void result;
    },
    [notifyRef, publish, queryClient, updateStatus]
  );

  const importBackup = useCallback(
    async (json: string) => {
      if (statusRef.current === 'loading') throw new Error('本机资料尚未加载完成，请稍后再试。');
      const result = importReaderDataBackup(json, statusRef.current === 'recovery')
        .then((state) => {
          // Import invalidates all loaded collections, even when membership is equal.
          state.revisions = {
            favorites: committed.current.revisions.favorites + 1,
            history: committed.current.revisions.history + 1,
            followedUsers: committed.current.revisions.followedUsers + 1
          };
          committed.current = state;
          void queryClient.invalidateQueries({ queryKey: ['reader-library'] });
          publish();
          updateStatus('ready');
        })
        .catch((error) => {
          if (error instanceof AggregateError) updateStatus('recovery');
          throw error;
        });

      return result;
    },
    [publish, queryClient, updateStatus]
  );

  const exportBackup = useCallback(() => {
    if (statusRef.current !== 'ready') return Promise.reject(new Error('本机资料尚未恢复，无法导出。'));
    return exportReaderDataBackup();
  }, []);

  useEffect(() => {
    const owner = lifetimeRef.current.signal;
    void loadInitialReaderData({
      isActive: () => !owner.aborted && lifetimeRef.current.signal === owner,
      notify: (message) => notifyRef.current(message),
      onLoaded: (state, status) => {
        committed.current = state;
        publish();
        updateStatus(status);
        recordStartupPhase('reader-ready');
      }
    });
  }, [notifyRef, publish, updateStatus]);

  return {
    commitReaderData,
    readerData,
    readerStatus,
    readerDataLoaded: readerStatus !== 'loading',
    readerDataRef,
    importBackup,
    exportBackup
  };
}
