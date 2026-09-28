import { useEffect } from 'react';
import {
  type TopicBodyMediaAggregate,
  TopicBodyMediaCoordinatorProvider,
  TopicBodyMediaRowBoundary,
  useTopicBodyMediaLease
} from '@/features/topic/media/TopicBodyMediaCoordinator';
import { act, render } from '../render';

jest.mock('expo-video', () => ({ createVideoPlayer: jest.fn() }));

type Lease = ReturnType<typeof useTopicBodyMediaLease>;

function Probe({ id, slot, observe }: { id: number; slot: number; observe: (slot: number, lease: Lease) => void }) {
  const lease = useTopicBodyMediaLease({
    automaticRetry: false,
    kind: slot === 0 ? 'original' : 'base',
    requestIdentity: `synthetic-image-${id}`
  });
  useEffect(() => {
    observe(slot, lease);
  }, [lease, observe, slot]);
  return null;
}

it('keeps media permits and timers bounded through eight thousand recycled registrations and stale callbacks', async () => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
  const leases = new Map<number, Lease>();
  const observe = (slot: number, lease: Lease) => leases.set(slot, lease);
  const finished = jest.fn<void, [TopicBodyMediaAggregate]>();
  const session = {
    networkMediaCount: 4_080,
    plannedRowCount: 1_020,
    source: 'nodeseek' as const,
    topicRef: 'synthetic-pressure'
  };
  const tree = (window: number, active = true) => (
    <TopicBodyMediaCoordinatorProvider
      active={active}
      paused={false}
      viewportRowKeys={Array.from({ length: 4 }, (_, index) => `row-${window}-${index}`)}
      diagnosticSession={session}
      onDiagnosticFinish={finished}
    >
      {Array.from({ length: 40 }, (_, slot) => (
        <TopicBodyMediaRowBoundary key={slot} rowKey={`row-${window}-${Math.floor(slot / 4)}`}>
          <Probe id={window * 40 + slot} slot={slot} observe={observe} />
        </TopicBodyMediaRowBoundary>
      ))}
    </TopicBodyMediaCoordinatorProvider>
  );
  let view: Awaited<ReturnType<typeof render>> | undefined;
  try {
    view = await render(tree(0));
    // Match a recycled list's mounted working set; the full catalog stays offscreen.
    for (const window of [
      ...Array.from({ length: 100 }, (_, i) => i + 1),
      ...Array.from({ length: 100 }, (_, i) => 99 - i)
    ]) {
      const stale = [...leases.values()];
      await view.rerender(tree(window));
      const before = [...leases.values()];
      expect(before.filter((lease) => lease.admitted).length).toBeGreaterThan(0);
      expect(before.filter((lease) => lease.admitted).length).toBeLessThanOrEqual(8);
      await view.rerender(tree(window));
      expect([...leases.values()]).toEqual(before);

      // Previous-window work can finish after cells have acquired different identities.
      expect(stale.every((lease, index) => lease.attemptId !== before[index].attemptId)).toBe(true);
      await act(() => {
        for (const lease of stale) {
          lease.progress(1);
          lease.settle('error');
          lease.retry();
        }
      });
      expect([...leases.values()]).toEqual(before);
      await act(() => {
        for (const lease of before) if (lease.admitted) lease.settle('displayed');
      });
      expect([...leases.values()].every((lease) => lease.failure === null)).toBe(true);
    }
    await view.rerender(tree(101, false));
    expect([...leases.values()].every((lease) => !lease.admitted)).toBe(true);
    await view.unmount();
    view = undefined;
    expect(finished).toHaveBeenCalledTimes(1);
    const aggregate = finished.mock.calls[0][0];
    expect(aggregate.runningHighWater).toBe(4);
    expect(aggregate.warmHighWater).toBe(8);
    expect(aggregate.timerHighWater).toBe(1);
    expect(aggregate.displayCount).toBeGreaterThanOrEqual(200);
    expect(aggregate.errorCount).toBe(0);
    expect(aggregate.timeoutCount).toBe(0);
    expect(aggregate.retryCount).toBe(0);
    await act(() => jest.runOnlyPendingTimers());
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    await view?.unmount();
    jest.useRealTimers();
  }
});
