import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { recordStartupPhase } from '@/platform/diagnostics/startupTiming';
import { errorMessage } from '@/platform/network/errors';
import {
  applyReaderChange,
  createEmptyReaderState,
  projectReaderCommand,
  type ReaderCommand,
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
  onLoadFailed,
  onLoaded
}: {
  isActive: () => boolean;
  load?: () => Promise<ReaderState>;
  notify: (message: string) => void;
  onLoadFailed?: () => void;
  onLoaded: (data: ReaderState) => void;
}) {
  try {
    const state = await load();
    if (isActive()) onLoaded(state);
  } catch (error) {
    if (!isActive()) return;
    notify(`本机资料读取失败，已进入恢复模式；请先导入备份再修改本机资料：${errorMessage(error)}`);
    onLoadFailed?.();
    onLoaded(createEmptyReaderState());
  }
}

export function useReaderRuntime({ notify }: { notify: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [readerData, setReaderData] = useState(createEmptyReaderState);
  const [readerDataLoaded, setReaderDataLoaded] = useState(false);
  const readerDataRef = useRef(readerData);
  const committed = useRef(readerData);
  const loaded = useRef(false);
  const suspended = useRef(false);
  const active = useRef(false);
  const pending = useRef<{ command: ReaderCommand }[]>([]);

  const publish = useCallback(() => {
    const state = pending.current.reduce(
      (value, operation) => projectReaderCommand(value, operation.command),
      committed.current
    );
    readerDataRef.current = state;
    if (active.current) setReaderData(state);
  }, []);

  const commitReaderData = useCallback(
    (command: ReaderCommand) => {
      if (!loaded.current || suspended.current) {
        notify(
          loaded.current ? '本机资料读取失败，请先导入备份再修改本机资料。' : '本机资料尚未加载完成，请稍后再试。'
        );
        return;
      }
      const trace = beginDiagnosticTrace('reader-data', 'mutate', { state: 'queued' });
      const operation = { command };
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
            if (error instanceof AggregateError) suspended.current = true;
            finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
            notify(errorMessage(error));
          }
        )
        .finally(() => {
          pending.current = pending.current.filter((item) => item !== operation);
          publish();
        });
      void result;
    },
    [notify, publish, queryClient]
  );

  const importBackup = useCallback(
    async (json: string) => {
      if (!loaded.current) throw new Error('本机资料尚未加载完成，请稍后再试。');
      const result = importReaderDataBackup(json, suspended.current).then((state) => {
        // Import invalidates all loaded collections, even when membership is equal.
        state.revisions = {
          favorites: committed.current.revisions.favorites + 1,
          history: committed.current.revisions.history + 1,
          followedUsers: committed.current.revisions.followedUsers + 1
        };
        committed.current = state;
        void queryClient.invalidateQueries({ queryKey: ['reader-library'] });
        suspended.current = false;
        publish();
      });

      return result;
    },
    [publish, queryClient]
  );

  const exportBackup = useCallback(() => {
    if (!loaded.current || suspended.current) return Promise.reject(new Error('本机资料尚未恢复，无法导出。'));
    return exportReaderDataBackup();
  }, []);

  useEffect(() => {
    let current = true;
    active.current = true;
    void loadInitialReaderData({
      isActive: () => current,
      notify,
      onLoadFailed: () => {
        suspended.current = true;
      },
      onLoaded: (state) => {
        committed.current = state;
        loaded.current = true;
        publish();
        setReaderDataLoaded(true);
        recordStartupPhase('reader-ready');
      }
    });
    return () => {
      current = false;
      active.current = false;
    };
  }, [notify, publish]);

  return { commitReaderData, readerData, readerDataLoaded, readerDataRef, importBackup, exportBackup };
}
