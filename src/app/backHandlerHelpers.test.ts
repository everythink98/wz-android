import { describe, expect, it } from 'vitest';
import {
  executeTopicReturnStrategy,
  executeUserReturnStrategy,
  selectTopicReturnStrategy,
  shouldCloseReplyComposerOnBack
} from './backHandlerHelpers';

describe('Android back handler helpers', () => {
  it('closes the reply composer only on the topic screen', () => {
    expect(shouldCloseReplyComposerOnBack('topic', true)).toBe(true);
    expect(shouldCloseReplyComposerOnBack('user', true)).toBe(false);
    expect(shouldCloseReplyComposerOnBack('topic', false)).toBe(false);
  });

  it('[REG-PERF-002] prefers a returning topic route over a snapshot when native pop is available', () => {
    expect(selectTopicReturnStrategy({
      canGoBack: true,
      hasReturningTopicRoute: true,
      hasSnapshot: true
    })).toBe('route-pop');
  });

  it('[REG-PERF-002] uses a topic snapshot only when the route is missing or cannot be popped', () => {
    expect(selectTopicReturnStrategy({
      canGoBack: true,
      hasReturningTopicRoute: false,
      hasSnapshot: true
    })).toBe('snapshot-fallback');
    expect(selectTopicReturnStrategy({
      canGoBack: false,
      hasReturningTopicRoute: true,
      hasSnapshot: true
    })).toBe('snapshot-fallback');
  });

  it('uses ordinary native or screen navigation when no snapshot exists', () => {
    expect(selectTopicReturnStrategy({
      canGoBack: true,
      hasReturningTopicRoute: false,
      hasSnapshot: false
    })).toBe('native-pop');
    expect(selectTopicReturnStrategy({
      canGoBack: false,
      hasReturningTopicRoute: false,
      hasSnapshot: false
    })).toBe('return-screen');
  });

  it('[REG-PERF-002] performs a normal Topic pop without restoring the fallback snapshot', () => {
    const calls: string[] = [];

    executeTopicReturnStrategy({
      canGoBack: true,
      strategy: 'route-pop',
      goBack: () => calls.push('pop'),
      restoreSnapshot: () => calls.push('restore-snapshot'),
      returnToScreen: () => calls.push('return-screen')
    });

    expect(calls).toEqual(['pop']);
  });

  it('[REG-PERF-002] defers only User return metadata on a normal Topic route pop', () => {
    const calls: string[] = [];
    let deferredTask: (() => void) | null = null;

    executeUserReturnStrategy({
      canGoBack: true,
      strategy: 'route-pop',
      goBack: () => calls.push('pop'),
      restoreFallback: () => calls.push('restore-snapshot-and-open'),
      returnToScreen: () => calls.push('return-screen'),
      scheduleFallbackRestore: () => calls.push('schedule-fallback'),
      scheduleMetadataRestore: () => {
        calls.push('schedule-metadata');
        deferredTask = () => calls.push('restore-metadata');
      }
    });

    expect(calls).toEqual(['schedule-metadata', 'pop']);
    expect(deferredTask).not.toBeNull();
    (deferredTask as (() => void) | null)?.();
    expect(calls).toEqual(['schedule-metadata', 'pop', 'restore-metadata']);
  });
});
