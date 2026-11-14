import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import { recordStartupPhase } from '@/platform/diagnostics/startupTiming';
import { errorMessage } from '@/platform/network/errors';
import {
  createEmptyReaderState,
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
import { createReaderCommandQueue } from './readerCommandQueue';

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
  const [commands] = useState(createReaderCommandQueue);
  const [view, setView] = useState(commands.snapshot);
  const { data: readerData, status: readerStatus } = view;
  const readerDataRef = commands.dataRef;
  const notifyRef = useCommittedRef(notify);
  const publish = useCallback(() => {
    if (commands.active) setView(commands.snapshot);
  }, [commands]);
  const requireRecovery = useCallback(() => {
    commands.recoveryRequired();
    publish();
  }, [commands, publish]);
  useLayoutEffect(() => {
    const lifetime = commands.attached();
    return () => lifetime.abort();
  }, [commands]);

  const commitReaderData = useCallback(
    (command: ReaderCommand) => {
      if (!commands.active) return;
      if (commands.status !== 'ready') {
        notifyRef.current(
          commands.status === 'recovery'
            ? '本机资料读取失败，请先导入备份再修改本机资料。'
            : '本机资料尚未加载完成，请稍后再试。'
        );
        return;
      }
      const trace = beginDiagnosticTrace('reader-data', 'mutate', { state: 'queued' });
      const operation = commands.enqueue(command);
      if (!operation) return;
      publish();
      // Storage is the single ordering owner. UI completion handlers preserve the
      // same order and rebase pending absolute intents after success or rollback.
      const result = commitReaderCommand(command)
        .then(
          (change) => {
            commands.confirmed(change);
            for (const collection of change.changed)
              void queryClient.invalidateQueries({ queryKey: ['reader-library', collection] });
            finishDiagnosticTrace(trace, 'success');
          },
          (error) => {
            if (error instanceof AggregateError) requireRecovery();
            finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
            if (commands.current(operation.owner)) notifyRef.current(errorMessage(error));
          }
        )
        .finally(() => {
          commands.settled(operation);
          publish();
        });
      void result;
    },
    [commands, notifyRef, publish, queryClient, requireRecovery]
  );

  const importBackup = useCallback(
    async (json: string) => {
      if (commands.status === 'loading') throw new Error('本机资料尚未加载完成，请稍后再试。');
      const result = importReaderDataBackup(json, commands.status === 'recovery')
        .then((state) => {
          // Import invalidates all loaded collections, even when membership is equal.
          commands.imported(state);
          void queryClient.invalidateQueries({ queryKey: ['reader-library'] });
          publish();
        })
        .catch((error) => {
          if (error instanceof AggregateError) requireRecovery();
          throw error;
        });

      return result;
    },
    [commands, publish, queryClient, requireRecovery]
  );

  const exportBackup = useCallback(() => {
    if (commands.status !== 'ready') return Promise.reject(new Error('本机资料尚未恢复，无法导出。'));
    return exportReaderDataBackup();
  }, [commands]);

  useEffect(() => {
    const owner = commands.signal;
    void loadInitialReaderData({
      isActive: () => commands.current(owner),
      notify: (message) => notifyRef.current(message),
      onLoaded: (state, status) => {
        commands.restored(state, status);
        publish();
        recordStartupPhase('reader-ready');
      }
    });
  }, [commands, notifyRef, publish]);

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
