import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { act, fireEvent, render } from '../render';
import {
  type TopicBodyMediaAggregate,
  TopicBodyMediaCoordinatorProvider,
  TopicBodyMediaRowBoundary,
  useTopicBodyMediaFirstRowMarker,
  useTopicBodyMediaLease
} from '@/features/topic/media/TopicBodyMediaCoordinator';
import {
  getReadNetworkRuntimeSnapshot,
  publishReadNetworkRuntimeRotation
} from '@/platform/network/readNetworkRuntime';

const VIEWPORT_ROW_KEYS = ['row-1'];

type MediaKind = Parameters<typeof useTopicBodyMediaLease>[0]['kind'];
type MediaLease = ReturnType<typeof useTopicBodyMediaLease>;

function attachmentKeyFor(lease: MediaLease) {
  const attachmentKey = (lease as MediaLease & { attachmentKey?: unknown }).attachmentKey;
  return typeof attachmentKey === 'string' ? attachmentKey : `missing:${lease.attemptId}`;
}

function MediaProbe({
  automaticRetry = true,
  enabled = true,
  id,
  kind = 'base',
  onLease,
  probeKey = id
}: {
  automaticRetry?: boolean;
  enabled?: boolean;
  id: string;
  kind?: MediaKind;
  onLease?: (lease: MediaLease) => void;
  probeKey?: string;
}) {
  const lease = useTopicBodyMediaLease({ automaticRetry, enabled, kind, requestIdentity: id });
  useEffect(() => {
    onLease?.(lease);
  }, [lease, onLease]);
  return (
    <View testID={`probe-${probeKey}`}>
      <Text testID={`media-${probeKey}`}>
        {lease.admitted ? 'admitted' : lease.failure ? `failed:${lease.failure}` : 'idle'}
      </Text>
      <Text testID={`attempt-${probeKey}`}>{lease.attemptId}</Text>
      <Text testID={`attachment-${probeKey}`}>{attachmentKeyFor(lease)}</Text>
      <Pressable accessibilityLabel={`display-${probeKey}`} onPress={() => lease.settle('displayed')} />
      <Pressable accessibilityLabel={`error-${probeKey}`} onPress={() => lease.settle('error')} />
      <Pressable accessibilityLabel={`progress-${probeKey}`} onPress={() => lease.progress(1)} />
      <Pressable accessibilityLabel={`retry-${probeKey}`} onPress={lease.retry} />
    </View>
  );
}

function PassiveMediaProbe({ id }: { id: string }) {
  const lease = useTopicBodyMediaLease({ kind: 'base', requestIdentity: id });
  return (
    <Text testID={`media-${id}`}>
      {lease.admitted ? 'admitted' : lease.failure ? `failed:${lease.failure}` : 'idle'}
    </Text>
  );
}

function FirstRowMarkerProbe() {
  const markFirstRow = useTopicBodyMediaFirstRowMarker();
  return (
    <>
      <Pressable accessibilityLabel="mark-first-row-250" onPress={() => markFirstRow(250)} />
      <Pressable accessibilityLabel="mark-first-row-900" onPress={() => markFirstRow(900)} />
    </>
  );
}

function CoordinatorHarness({
  active = true,
  children,
  diagnosticSession,
  onDiagnosticFinish,
  paused = false,
  viewportRowKeys = VIEWPORT_ROW_KEYS
}: {
  active?: boolean;
  children: React.ReactNode;
  diagnosticSession?: {
    networkMediaCount: number;
    plannedRowCount: number;
    responseReadyAt?: number;
    source: 'nodeseek';
    topicRef: string;
  };
  onDiagnosticFinish?: (aggregate: TopicBodyMediaAggregate) => void | Promise<void>;
  paused?: boolean;
  viewportRowKeys?: readonly string[];
}) {
  return (
    <TopicBodyMediaCoordinatorProvider
      active={active}
      diagnosticSession={diagnosticSession}
      onDiagnosticFinish={onDiagnosticFinish}
      paused={paused}
      viewportRowKeys={viewportRowKeys}
    >
      <TopicBodyMediaRowBoundary rowKey="row-1">{children}</TopicBodyMediaRowBoundary>
    </TopicBodyMediaCoordinatorProvider>
  );
}

describe('TopicBodyMediaCoordinator', () => {
  it('keeps 2000 descriptors within four runs and one timer', async () => {
    jest.useFakeTimers();
    let timeoutSpy: jest.SpiedFunction<typeof setTimeout> | undefined;
    try {
      const descriptors = (
        <>
          {Array.from({ length: 2_000 }, (_, index) => (
            <PassiveMediaProbe id={`image-${index}`} key={index} />
          ))}
        </>
      );
      const view = await render(<CoordinatorHarness paused>{descriptors}</CoordinatorHarness>);
      timeoutSpy = jest.spyOn(global, 'setTimeout');

      await view.rerender(<CoordinatorHarness>{descriptors}</CoordinatorHarness>);

      expect(view.getAllByText('admitted')).toHaveLength(4);
      expect(view.getAllByText('idle')).toHaveLength(1_996);
      const coordinatorTimerCallIndex = timeoutSpy.mock.calls.findIndex(([, delay]) => delay === 30_000);
      expect(coordinatorTimerCallIndex).toBeGreaterThanOrEqual(0);
      expect(timeoutSpy.mock.calls.filter(([, delay]) => delay === 30_000)).toHaveLength(1);

      await view.unmount();
    } finally {
      timeoutSpy?.mockRestore();
      jest.useRealTimers();
    }
  });

  it('changes the first permit attempt without replacing the attachment identity', async () => {
    const probe = <MediaProbe id="first-permit-attachment" />;
    const view = await render(<CoordinatorHarness paused>{probe}</CoordinatorHarness>);
    const waitingAttempt = view.getByTestId('attempt-first-permit-attachment').props.children;
    const waitingAttachment = view.getByTestId('attachment-first-permit-attachment').props.children;

    await view.rerender(<CoordinatorHarness>{probe}</CoordinatorHarness>);

    expect(view.getByTestId('attempt-first-permit-attachment').props.children).not.toBe(waitingAttempt);
    expect(view.getByTestId('attachment-first-permit-attachment').props.children).toBe(waitingAttachment);
  });

  it('changes a resumed permit attempt without replacing the attachment identity', async () => {
    const probe = <MediaProbe id="resumed-attachment" />;
    const view = await render(<CoordinatorHarness>{probe}</CoordinatorHarness>);
    const firstAttempt = view.getByTestId('attempt-resumed-attachment').props.children;
    const firstAttachment = view.getByTestId('attachment-resumed-attachment').props.children;

    await view.rerender(<CoordinatorHarness viewportRowKeys={[]}>{probe}</CoordinatorHarness>);
    expect(view.getByTestId('attachment-resumed-attachment').props.children).toBe(firstAttachment);

    await view.rerender(<CoordinatorHarness>{probe}</CoordinatorHarness>);
    expect(view.getByTestId('attempt-resumed-attachment').props.children).not.toBe(firstAttempt);
    expect(view.getByTestId('attachment-resumed-attachment').props.children).toBe(firstAttachment);
  });

  it('rotates once after error and rejects old callbacks', async () => {
    let latestLease: MediaLease | undefined;
    const probe = <MediaProbe id="error-attachment" onLease={(lease) => (latestLease = lease)} />;
    const view = await render(<CoordinatorHarness>{probe}</CoordinatorHarness>);
    const firstLease = latestLease!;
    const firstAttachment = attachmentKeyFor(firstLease);

    await act(() => firstLease.settle('error'));
    const retryLease = latestLease!;
    const retryAttachment = attachmentKeyFor(retryLease);
    expect(retryLease.attemptId).not.toBe(firstLease.attemptId);
    expect(retryAttachment).not.toBe(firstAttachment);

    await act(() => {
      firstLease.progress(1);
      firstLease.settle('displayed');
      firstLease.settle('error');
    });
    expect(view.getByTestId('attachment-error-attachment').props.children).toBe(retryAttachment);
    expect(view.getByTestId('media-error-attachment').props.children).toBe('admitted');
  });

  it('rotates the attachment once for timeout and once for the later explicit retry', async () => {
    jest.useFakeTimers();
    try {
      const view = await render(
        <CoordinatorHarness>
          <MediaProbe id="timeout-attachment" />
        </CoordinatorHarness>
      );
      const firstAttachment = view.getByTestId('attachment-timeout-attachment').props.children;

      await act(() => jest.advanceTimersByTime(30_000));
      const automaticRetryAttachment = view.getByTestId('attachment-timeout-attachment').props.children;
      expect(automaticRetryAttachment).not.toBe(firstAttachment);

      await act(() => jest.advanceTimersByTime(30_000));
      expect(view.getByTestId('media-timeout-attachment').props.children).toBe('failed:timeout');
      expect(view.getByTestId('attachment-timeout-attachment').props.children).toBe(automaticRetryAttachment);

      await fireEvent.press(view.getByLabelText('retry-timeout-attachment'));
      const explicitRetryAttachment = view.getByTestId('attachment-timeout-attachment').props.children;
      expect(explicitRetryAttachment).not.toBe(automaticRetryAttachment);
      await view.rerender(
        <CoordinatorHarness>
          <MediaProbe id="timeout-attachment" />
        </CoordinatorHarness>
      );
      expect(view.getByTestId('attachment-timeout-attachment').props.children).toBe(explicitRetryAttachment);
      await view.unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  it('rotates a running attachment once for one runtime generation', async () => {
    const view = await render(
      <CoordinatorHarness
        diagnosticSession={{
          networkMediaCount: 1,
          plannedRowCount: 1,
          source: 'nodeseek',
          topicRef: 'topic-attachment-runtime'
        }}
      >
        <MediaProbe id="runtime-attachment" />
      </CoordinatorHarness>
    );
    const firstAttempt = view.getByTestId('attempt-runtime-attachment').props.children;
    const firstAttachment = view.getByTestId('attachment-runtime-attachment').props.children;
    const before = getReadNetworkRuntimeSnapshot();

    await act(() => publishReadNetworkRuntimeRotation(before.generation + 1, 'nodeseek'));

    const rotatedAttempt = view.getByTestId('attempt-runtime-attachment').props.children;
    const rotatedAttachment = view.getByTestId('attachment-runtime-attachment').props.children;
    expect(rotatedAttempt).not.toBe(firstAttempt);
    expect(rotatedAttachment).not.toBe(firstAttachment);

    await act(() => publishReadNetworkRuntimeRotation(before.generation + 1, 'nodeseek'));
    expect(view.getByTestId('attempt-runtime-attachment').props.children).toBe(rotatedAttempt);
    expect(view.getByTestId('attachment-runtime-attachment').props.children).toBe(rotatedAttachment);
  });

  it('does not let disabled or empty media consume a permit or deadline', async () => {
    const view = await render(
      <CoordinatorHarness>
        {Array.from({ length: 4 }, (_, index) => (
          <MediaProbe enabled={false} id={`empty-${index}`} key={index} />
        ))}
        <MediaProbe id="valid" />
      </CoordinatorHarness>
    );

    expect(view.getByTestId('media-valid').props.children).toBe('admitted');
    expect(view.getAllByText('idle')).toHaveLength(4);
  });

  it('releases a running slot after a request is displayed and advances the next waiter', async () => {
    const view = await render(
      <CoordinatorHarness>
        {Array.from({ length: 5 }, (_, index) => (
          <MediaProbe id={`image-${index}`} key={index} />
        ))}
      </CoordinatorHarness>
    );

    expect(view.getByTestId('media-image-4').props.children).toBe('idle');
    await fireEvent.press(view.getByLabelText('display-image-0'));

    expect(view.getByTestId('media-image-4').props.children).toBe('admitted');
    expect(view.getByTestId('media-image-0').props.children).toBe('admitted');
  });

  it('automatically retries one failed attempt without exceeding the running budget', async () => {
    const view = await render(
      <CoordinatorHarness>
        {Array.from({ length: 5 }, (_, index) => (
          <MediaProbe id={`image-${index}`} key={index} />
        ))}
      </CoordinatorHarness>
    );
    const firstAttempt = view.getByTestId('attempt-image-0').props.children;

    await fireEvent.press(view.getByLabelText('error-image-0'));

    expect(view.getByTestId('media-image-0').props.children).toBe('admitted');
    expect(view.getByTestId('attempt-image-0').props.children).not.toBe(firstAttempt);
    expect(view.getByTestId('media-image-4').props.children).toBe('idle');

    await fireEvent.press(view.getByLabelText('error-image-0'));
    expect(view.getByTestId('media-image-0').props.children).toBe('failed:error');
    expect(view.getByTestId('media-image-4').props.children).toBe('admitted');
  });

  it('leaves opted-out media failed until one explicit retry and releases its permit', async () => {
    const view = await render(
      <CoordinatorHarness>
        <MediaProbe automaticRetry={false} id="native-video" kind="video" />
        {Array.from({ length: 4 }, (_, index) => (
          <MediaProbe id={`queued-${index}`} key={index} />
        ))}
      </CoordinatorHarness>
    );
    const firstAttempt = view.getByTestId('attempt-native-video').props.children;

    await fireEvent.press(view.getByLabelText('error-native-video'));

    expect(view.getByTestId('media-native-video').props.children).toBe('failed:error');
    expect(view.getByTestId('attempt-native-video').props.children).toBe(firstAttempt);
    expect(view.getByTestId('media-queued-3').props.children).toBe('admitted');

    await fireEvent.press(view.getByLabelText('display-queued-0'));
    await fireEvent.press(view.getByLabelText('retry-native-video'));
    expect(view.getByTestId('media-native-video').props.children).toBe('admitted');
    expect(view.getByTestId('attempt-native-video').props.children).not.toBe(firstAttempt);
  });

  it('leaves opted-out media timed out until one explicit retry and releases its permit', async () => {
    jest.useFakeTimers();
    try {
      const view = await render(
        <CoordinatorHarness>
          <MediaProbe automaticRetry={false} id="native-video-timeout" kind="video" />
          {Array.from({ length: 4 }, (_, index) => (
            <MediaProbe id={`timeout-queued-${index}`} key={index} />
          ))}
        </CoordinatorHarness>
      );
      const firstAttempt = view.getByTestId('attempt-native-video-timeout').props.children;

      await act(() => jest.advanceTimersByTime(30_000));

      expect(view.getByTestId('media-native-video-timeout').props.children).toBe('failed:timeout');
      expect(view.getByTestId('attempt-native-video-timeout').props.children).toBe(firstAttempt);
      expect(view.getByTestId('media-timeout-queued-3').props.children).toBe('admitted');

      await fireEvent.press(view.getByLabelText('display-timeout-queued-0'));
      await fireEvent.press(view.getByLabelText('retry-native-video-timeout'));
      expect(view.getByTestId('media-native-video-timeout').props.children).toBe('admitted');
      expect(view.getByTestId('attempt-native-video-timeout').props.children).not.toBe(firstAttempt);
      await view.unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  it('restarts a running attempt when its source publishes a newer runtime generation', async () => {
    const onDiagnosticFinish = jest.fn((_aggregate: TopicBodyMediaAggregate) => undefined);
    const view = await render(
      <CoordinatorHarness
        diagnosticSession={{
          networkMediaCount: 1,
          plannedRowCount: 1,
          source: 'nodeseek',
          topicRef: 'topic-runtime-restart'
        }}
        onDiagnosticFinish={onDiagnosticFinish}
      >
        <MediaProbe id="runtime-image" />
      </CoordinatorHarness>
    );
    const firstAttempt = view.getByTestId('attempt-runtime-image').props.children;
    const before = getReadNetworkRuntimeSnapshot();

    await act(() => publishReadNetworkRuntimeRotation(before.generation + 1, 'nodeseek'));

    expect(view.getByTestId('media-runtime-image').props.children).toBe('admitted');
    expect(view.getByTestId('attempt-runtime-image').props.children).not.toBe(firstAttempt);
    await fireEvent.press(view.getByLabelText('display-runtime-image'));
    await view.unmount();
    expect(onDiagnosticFinish).toHaveBeenCalledWith(expect.objectContaining({ cancelCount: 1, retryCount: 0 }));
  });

  it('preserves terminal attachments across runtime rotation', async () => {
    const view = await render(
      <TopicBodyMediaCoordinatorProvider
        active
        diagnosticSession={{
          networkMediaCount: 4,
          plannedRowCount: 2,
          source: 'nodeseek',
          topicRef: 'topic-runtime-terminal-state'
        }}
        paused={false}
        viewportRowKeys={['active-row']}
      >
        <TopicBodyMediaRowBoundary rowKey="active-row">
          <MediaProbe id="still-running" />
          <MediaProbe id="already-displayed" />
          <MediaProbe id="retry-exhausted" />
        </TopicBodyMediaRowBoundary>
        <TopicBodyMediaRowBoundary rowKey="outside-window-row">
          <MediaProbe id="still-waiting" />
        </TopicBodyMediaRowBoundary>
      </TopicBodyMediaCoordinatorProvider>
    );
    await fireEvent.press(view.getByLabelText('display-already-displayed'));
    await fireEvent.press(view.getByLabelText('error-retry-exhausted'));
    await fireEvent.press(view.getByLabelText('error-retry-exhausted'));
    const attempts = Object.fromEntries(
      ['still-running', 'already-displayed', 'retry-exhausted', 'still-waiting'].map((id) => [
        id,
        view.getByTestId(`attempt-${id}`).props.children
      ])
    );
    const attachments = Object.fromEntries(
      ['still-running', 'already-displayed', 'retry-exhausted', 'still-waiting'].map((id) => [
        id,
        view.getByTestId(`attachment-${id}`).props.children
      ])
    );
    const before = getReadNetworkRuntimeSnapshot();

    await act(() => publishReadNetworkRuntimeRotation(before.generation + 1, 'nodeseek'));

    expect(view.getByTestId('attempt-still-running').props.children).not.toBe(attempts['still-running']);
    expect(view.getByTestId('attempt-already-displayed').props.children).toBe(attempts['already-displayed']);
    expect(view.getByTestId('attempt-retry-exhausted').props.children).toBe(attempts['retry-exhausted']);
    expect(view.getByTestId('attempt-still-waiting').props.children).toBe(attempts['still-waiting']);
    expect(view.getByTestId('attachment-still-running').props.children).not.toBe(attachments['still-running']);
    expect(view.getByTestId('attachment-already-displayed').props.children).toBe(attachments['already-displayed']);
    expect(view.getByTestId('attachment-retry-exhausted').props.children).toBe(attachments['retry-exhausted']);
    expect(view.getByTestId('attachment-still-waiting').props.children).toBe(attachments['still-waiting']);
    expect(view.getByTestId('media-retry-exhausted').props.children).toBe('failed:error');
    expect(view.getByTestId('media-still-waiting').props.children).toBe('idle');
  });

  it('restarts a mixed four-media working set without admitting a fifth request', async () => {
    const media = [
      ['base', 'base'] as const,
      ['inline', 'inline'] as const,
      ['sticker', 'sticker'] as const,
      ['video', 'video'] as const,
      ['waiting', 'poster'] as const
    ];
    const view = await render(
      <CoordinatorHarness
        diagnosticSession={{
          networkMediaCount: media.length,
          plannedRowCount: 1,
          source: 'nodeseek',
          topicRef: 'topic-runtime-mixed-media'
        }}
      >
        {media.map(([id, kind]) => (
          <MediaProbe id={id} key={id} kind={kind} />
        ))}
      </CoordinatorHarness>
    );
    const firstAttempts = media.slice(0, 4).map(([id]) => view.getByTestId(`attempt-${id}`).props.children);
    const before = getReadNetworkRuntimeSnapshot();

    await act(() => publishReadNetworkRuntimeRotation(before.generation + 1, 'nodeseek'));

    expect(view.getAllByText('admitted')).toHaveLength(4);
    expect(view.getByTestId('media-waiting').props.children).toBe('idle');
    media.slice(0, 4).forEach(([id], index) => {
      expect(view.getByTestId(`attempt-${id}`).props.children).not.toBe(firstAttempts[index]);
    });
  });

  it('releases a running slot when its renderer unmounts', async () => {
    const probes = (includeFirst: boolean) => (
      <CoordinatorHarness>
        {Array.from({ length: 5 }, (_, index) =>
          includeFirst || index !== 0 ? <MediaProbe id={`image-${index}`} key={index} /> : null
        )}
      </CoordinatorHarness>
    );
    const view = await render(probes(true));

    expect(view.getByTestId('media-image-4').props.children).toBe('idle');
    await view.rerender(probes(false));

    expect(view.getByTestId('media-image-4').props.children).toBe('admitted');
  });

  it('uses the single nearest-deadline timer to fail stalled requests and advance waiting work', async () => {
    jest.useFakeTimers();
    let timeoutSpy: jest.SpiedFunction<typeof setTimeout> | undefined;
    try {
      const descriptors = (
        <>
          {Array.from({ length: 5 }, (_, index) => (
            <MediaProbe id={`image-${index}`} key={index} />
          ))}
        </>
      );
      const view = await render(<CoordinatorHarness paused>{descriptors}</CoordinatorHarness>);
      timeoutSpy = jest.spyOn(global, 'setTimeout');
      await view.rerender(<CoordinatorHarness>{descriptors}</CoordinatorHarness>);

      expect(timeoutSpy.mock.calls.filter(([, delay]) => delay === 30_000)).toHaveLength(1);
      const firstAttempts = Array.from(
        { length: 4 },
        (_, index) => view.getByTestId(`attempt-image-${index}`).props.children
      );
      await act(() => jest.advanceTimersByTime(30_000));

      expect(view.getAllByText('admitted')).toHaveLength(4);
      expect(view.getByTestId('media-image-4').props.children).toBe('idle');
      firstAttempts.forEach((attempt, index) => {
        expect(view.getByTestId(`attempt-image-${index}`).props.children).not.toBe(attempt);
      });
      await act(() => jest.advanceTimersByTime(30_000));

      expect(view.getAllByText('failed:timeout')).toHaveLength(4);
      expect(view.getByTestId('media-image-4').props.children).toBe('admitted');
      expect(timeoutSpy.mock.calls.filter(([, delay]) => delay === 30_000)).toHaveLength(3);
      view.unmount();
    } finally {
      timeoutSpy?.mockRestore();
      jest.useRealTimers();
    }
  });

  it('moves only the reporting request deadline when progress arrives', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    try {
      const view = await render(
        <CoordinatorHarness>
          <MediaProbe id="progressing" />
        </CoordinatorHarness>
      );

      await act(() => jest.advanceTimersByTime(20_000));
      await fireEvent.press(view.getByLabelText('progress-progressing'));
      await act(() => jest.advanceTimersByTime(10_000));
      expect(view.getByTestId('media-progressing').props.children).toBe('admitted');

      const firstAttempt = view.getByTestId('attempt-progressing').props.children;
      await act(() => jest.advanceTimersByTime(20_000));
      expect(view.getByTestId('media-progressing').props.children).toBe('admitted');
      expect(view.getByTestId('attempt-progressing').props.children).not.toBe(firstAttempt);

      await act(() => jest.advanceTimersByTime(30_000));
      expect(view.getByTestId('media-progressing').props.children).toBe('failed:timeout');
      view.unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not extend a stalled attempt for duplicate progress values', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    try {
      const view = await render(
        <CoordinatorHarness>
          <MediaProbe id="duplicate-progress" />
        </CoordinatorHarness>
      );

      const firstAttempt = view.getByTestId('attempt-duplicate-progress').props.children;
      await act(() => jest.advanceTimersByTime(20_000));
      await fireEvent.press(view.getByLabelText('progress-duplicate-progress'));
      await act(() => jest.advanceTimersByTime(20_000));
      await fireEvent.press(view.getByLabelText('progress-duplicate-progress'));
      await act(() => jest.advanceTimersByTime(10_000));

      expect(view.getByTestId('attempt-duplicate-progress').props.children).not.toBe(firstAttempt);
      view.unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not issue new permits while paused and cancels only unfinished sources while inactive', async () => {
    const probes = (active: boolean, paused: boolean) => (
      <CoordinatorHarness active={active} paused={paused}>
        {Array.from({ length: 5 }, (_, index) => (
          <MediaProbe id={`image-${index}`} key={index} />
        ))}
      </CoordinatorHarness>
    );
    const view = await render(probes(true, true));
    expect(view.queryAllByText('admitted')).toHaveLength(0);

    await view.rerender(probes(true, false));
    expect(view.getAllByText('admitted')).toHaveLength(4);

    await view.rerender(probes(true, true));
    await fireEvent.press(view.getByLabelText('display-image-0'));
    expect(view.getByTestId('media-image-4').props.children).toBe('idle');

    await view.rerender(probes(false, false));
    expect(view.queryAllByText('admitted')).toHaveLength(1);
    expect(view.getByTestId('media-image-0').props.children).toBe('admitted');
    expect(view.getByTestId('media-image-1').props.children).toBe('idle');
  });

  it('admits only one renderer for the same request identity at a time', async () => {
    const view = await render(
      <CoordinatorHarness>
        <MediaProbe id="same-image" probeKey="first" />
        <MediaProbe id="same-image" probeKey="second" />
      </CoordinatorHarness>
    );

    expect(view.getAllByText('admitted')).toHaveLength(1);
    expect(view.getAllByText('idle')).toHaveLength(1);
  });

  it('bounds duplicate renderers to one automatic retry and one explicit retry', async () => {
    const leases = new Map<string, MediaLease>();
    const view = await render(
      <CoordinatorHarness>
        <MediaProbe id="duplicate" onLease={(lease) => leases.set('first', lease)} probeKey="first" />
        <MediaProbe id="duplicate" onLease={(lease) => leases.set('second', lease)} probeKey="second" />
      </CoordinatorHarness>
    );
    const runningLease = [...leases.values()].find((lease) => lease.admitted)!;

    await act(() => runningLease.settle('error'));

    expect(view.getAllByText('admitted')).toHaveLength(1);
    expect(view.getAllByText('idle')).toHaveLength(1);

    const automaticRetryLease = [...leases.values()].find((lease) => lease.admitted)!;
    await act(() => automaticRetryLease.settle('error'));
    expect(view.queryAllByText('admitted')).toHaveLength(0);
    expect(view.getAllByText('failed:error')).toHaveLength(2);

    await fireEvent.press(view.getByLabelText('retry-first'));
    expect(view.getAllByText('admitted')).toHaveLength(1);
    const explicitRetryLease = [...leases.values()].find((lease) => lease.admitted)!;
    await act(() => explicitRetryLease.settle('error'));
    await fireEvent.press(view.getByLabelText('retry-second'));
    expect(view.queryAllByText('admitted')).toHaveLength(0);
    expect(view.getAllByText('failed:error')).toHaveLength(2);
  });

  it('never remounts a healthy displayed duplicate when another copy retries', async () => {
    const view = await render(
      <CoordinatorHarness>
        <MediaProbe id="shared" probeKey="healthy" />
        <MediaProbe id="shared" probeKey="failing" />
      </CoordinatorHarness>
    );
    await fireEvent.press(view.getByLabelText('display-healthy'));
    const healthyAttempt = view.getByTestId('attempt-healthy').props.children;
    expect(view.getByTestId('media-failing').props.children).toBe('admitted');

    await fireEvent.press(view.getByLabelText('error-failing'));
    expect(view.getByTestId('media-healthy').props.children).toBe('admitted');
    expect(view.getByTestId('attempt-healthy').props.children).toBe(healthyAttempt);
    expect(view.getByTestId('media-failing').props.children).toBe('admitted');

    await fireEvent.press(view.getByLabelText('error-failing'));
    await fireEvent.press(view.getByLabelText('retry-failing'));
    expect(view.getByTestId('media-healthy').props.children).toBe('admitted');
    expect(view.getByTestId('attempt-healthy').props.children).toBe(healthyAttempt);
    expect(view.getByTestId('media-failing').props.children).toBe('admitted');
  });

  it('remembers a failed identity across renderer recycling instead of retrying on scroll', async () => {
    let latestLease: MediaLease | undefined;
    const probe = <MediaProbe id="recycled" onLease={(lease) => (latestLease = lease)} probeKey="recycled" />;
    const view = await render(<CoordinatorHarness>{probe}</CoordinatorHarness>);
    await act(() => latestLease!.settle('error'));
    await act(() => latestLease!.settle('error'));

    await view.rerender(<CoordinatorHarness>{null}</CoordinatorHarness>);
    await view.rerender(<CoordinatorHarness>{probe}</CoordinatorHarness>);

    expect(view.queryAllByText('admitted')).toHaveLength(0);
    expect(view.getByTestId('media-recycled').props.children).toBe('failed:error');
  });

  it('admits at most one original upgrade while retaining four total body slots', async () => {
    const view = await render(
      <CoordinatorHarness>
        {Array.from({ length: 4 }, (_, index) => (
          <MediaProbe id={`original-${index}`} kind="original" key={`original-${index}`} />
        ))}
        {Array.from({ length: 4 }, (_, index) => (
          <MediaProbe id={`base-${index}`} key={`base-${index}`} />
        ))}
      </CoordinatorHarness>
    );

    expect(
      view.getAllByText('admitted').filter((node) => String(node.props.testID).startsWith('media-original-'))
    ).toHaveLength(1);
    expect(view.getAllByText('admitted')).toHaveLength(4);
  });

  it('allows only one explicit retry for a failed request in the topic session', async () => {
    const view = await render(
      <CoordinatorHarness>
        <MediaProbe id="retryable" />
      </CoordinatorHarness>
    );
    const firstAttempt = view.getByTestId('attempt-retryable').props.children;

    await fireEvent.press(view.getByLabelText('error-retryable'));
    const secondAttempt = view.getByTestId('attempt-retryable').props.children;
    expect(secondAttempt).not.toBe(firstAttempt);
    expect(view.getByTestId('media-retryable').props.children).toBe('admitted');

    await fireEvent.press(view.getByLabelText('error-retryable'));
    await fireEvent.press(view.getByLabelText('retry-retryable'));
    const thirdAttempt = view.getByTestId('attempt-retryable').props.children;
    expect(thirdAttempt).not.toBe(secondAttempt);
    expect(view.getByTestId('media-retryable').props.children).toBe('admitted');

    await fireEvent.press(view.getByLabelText('error-retryable'));
    await fireEvent.press(view.getByLabelText('retry-retryable'));
    expect(view.getByTestId('attempt-retryable').props.children).toBe(thirdAttempt);
    expect(view.getByTestId('media-retryable').props.children).toBe('failed:error');
  });

  it('ignores a late callback from the failed attempt after automatic retry', async () => {
    let latestLease: MediaLease | undefined;
    await render(
      <CoordinatorHarness>
        <MediaProbe id="late-callback" onLease={(lease) => (latestLease = lease)} />
      </CoordinatorHarness>
    );
    const firstAttemptLease = latestLease!;

    await act(() => firstAttemptLease.settle('error'));
    const secondAttemptLease = latestLease!;
    expect(secondAttemptLease.attemptId).not.toBe(firstAttemptLease.attemptId);

    await act(() => firstAttemptLease.settle('displayed'));
    expect(latestLease!.admitted).toBe(true);
    await act(() => secondAttemptLease.settle('error'));
    expect(latestLease!.failure).toBe('error');
  });

  it('retains a displayed renderer when viewport scheduling oscillates', async () => {
    const probe = <MediaProbe id="reenter" />;
    const view = await render(<CoordinatorHarness>{probe}</CoordinatorHarness>);
    await fireEvent.press(view.getByLabelText('display-reenter'));
    const displayedAttempt = view.getByTestId('attempt-reenter').props.children;

    for (let index = 0; index < 20; index += 1) {
      await view.rerender(
        <CoordinatorHarness viewportRowKeys={index % 2 === 0 ? [] : VIEWPORT_ROW_KEYS}>{probe}</CoordinatorHarness>
      );
      expect(view.getByTestId('media-reenter').props.children).toBe('admitted');
      expect(view.getByTestId('attempt-reenter').props.children).toBe(displayedAttempt);
    }
  });

  it('re-enters the bounded timeout lifecycle when displayed audio returns to visible rows', async () => {
    jest.useFakeTimers();
    try {
      const probe = <MediaProbe automaticRetry={false} id="recycled-audio" kind="audio" />;
      const tree = (visibleRowKeys: readonly string[]) => (
        <TopicBodyMediaCoordinatorProvider
          active
          paused={false}
          visibleRowKeys={visibleRowKeys}
          viewportRowKeys={VIEWPORT_ROW_KEYS}
        >
          <TopicBodyMediaRowBoundary rowKey="row-1">{probe}</TopicBodyMediaRowBoundary>
        </TopicBodyMediaCoordinatorProvider>
      );
      const view = await render(tree(VIEWPORT_ROW_KEYS));
      await fireEvent.press(view.getByLabelText('display-recycled-audio'));
      const displayedAttempt = view.getByTestId('attempt-recycled-audio').props.children;

      await view.rerender(tree([]));
      expect(view.getByTestId('media-recycled-audio').props.children).toBe('idle');
      await view.rerender(tree(VIEWPORT_ROW_KEYS));
      const resumedAttempt = view.getByTestId('attempt-recycled-audio').props.children;

      await act(() => jest.advanceTimersByTime(30_000));

      expect(view.getByTestId('media-recycled-audio').props.children).toBe('failed:timeout');
      expect(resumedAttempt).not.toBe(displayedAttempt);
      await view.unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  it('gives a newly visible row warm capacity ahead of retained prefetch media', async () => {
    const tree = (viewportRowKeys: readonly string[]) => (
      <TopicBodyMediaCoordinatorProvider active paused={false} viewportRowKeys={viewportRowKeys}>
        <TopicBodyMediaRowBoundary rowKey="prefetch-row">
          {Array.from({ length: 8 }, (_, index) => (
            <MediaProbe id={`prefetch-${index}`} key={index} />
          ))}
        </TopicBodyMediaRowBoundary>
        <TopicBodyMediaRowBoundary rowKey="visible-row">
          <MediaProbe id="new-visible" />
        </TopicBodyMediaRowBoundary>
      </TopicBodyMediaCoordinatorProvider>
    );
    const view = await render(tree(['prefetch-row']));
    for (let index = 0; index < 8; index += 1) {
      await fireEvent.press(view.getByLabelText(`display-prefetch-${index}`));
    }
    expect(view.getByTestId('media-new-visible').props.children).toBe('idle');

    await view.rerender(tree(['visible-row', 'prefetch-row']));

    expect(view.getByTestId('media-new-visible').props.children).toBe('admitted');
    expect(view.getAllByText('admitted')).toHaveLength(9);
  });

  it('preempts retained behind-row requests for newly visible media', async () => {
    const tree = (viewportRowKeys: readonly string[]) => (
      <TopicBodyMediaCoordinatorProvider active paused={false} viewportRowKeys={viewportRowKeys}>
        <TopicBodyMediaRowBoundary rowKey="behind-row">
          {Array.from({ length: 4 }, (_, index) => (
            <MediaProbe id={`behind-${index}`} key={index} />
          ))}
        </TopicBodyMediaRowBoundary>
        <TopicBodyMediaRowBoundary rowKey="visible-row">
          <MediaProbe id="new-visible-running" />
        </TopicBodyMediaRowBoundary>
      </TopicBodyMediaCoordinatorProvider>
    );
    const view = await render(tree(['behind-row']));

    expect(view.getAllByText('admitted')).toHaveLength(4);
    expect(view.getByTestId('media-new-visible-running').props.children).toBe('idle');

    await view.rerender(tree(['visible-row', 'behind-row']));

    expect(view.getByTestId('media-new-visible-running').props.children).toBe('admitted');
    expect(view.getAllByText('admitted')).toHaveLength(4);
  });

  it('never exposes the old admitted snapshot after a recycled renderer changes identity', async () => {
    const observed: { admitted: boolean; id: string }[] = [];
    const probe = (id: string) => (
      <MediaProbe id={id} onLease={(lease) => observed.push({ admitted: lease.admitted, id })} probeKey="recycled" />
    );
    const view = await render(<CoordinatorHarness>{probe('first')}</CoordinatorHarness>);
    observed.length = 0;

    await view.rerender(
      <CoordinatorHarness paused viewportRowKeys={[]}>
        {probe('second')}
      </CoordinatorHarness>
    );

    expect(observed).not.toContainEqual({ admitted: true, id: 'second' });
    expect(view.getByTestId('media-recycled').props.children).toBe('idle');
  });

  it('fails closed when a managed renderer is missing its row boundary', async () => {
    const view = await render(
      <TopicBodyMediaCoordinatorProvider active paused={false} viewportRowKeys={['row-1']}>
        <MediaProbe id="missing-boundary" />
      </TopicBodyMediaCoordinatorProvider>
    );

    expect(view.getByTestId('media-missing-boundary').props.children).toBe('idle');
  });

  it('re-enters the bounded retry lifecycle when displayed video or image later errors', async () => {
    const view = await render(
      <CoordinatorHarness>
        <MediaProbe id="late-error" />
      </CoordinatorHarness>
    );
    await fireEvent.press(view.getByLabelText('display-late-error'));
    const displayedAttempt = view.getByTestId('attempt-late-error').props.children;

    await fireEvent.press(view.getByLabelText('error-late-error'));

    expect(view.getByTestId('media-late-error').props.children).toBe('admitted');
    expect(view.getByTestId('attempt-late-error').props.children).not.toBe(displayedAttempt);
  });

  it('keeps the lease object and callbacks stable across unrelated parent renders', async () => {
    const observedLeases: MediaLease[] = [];
    const leaseEffects = jest.fn();
    function StableLeaseProbe({ tick }: { tick: number }) {
      const lease = useTopicBodyMediaLease({ kind: 'base', requestIdentity: 'stable' });
      observedLeases.push(lease);
      useEffect(leaseEffects, [lease]);
      return <Text>{`${tick}:${lease.admitted}`}</Text>;
    }
    const harness = (tick: number) => (
      <CoordinatorHarness>
        <StableLeaseProbe tick={tick} />
      </CoordinatorHarness>
    );
    const view = await render(harness(0));
    const leaseBefore = observedLeases.at(-1)!;
    const effectsBefore = leaseEffects.mock.calls.length;

    await view.rerender(harness(1));
    const leaseAfter = observedLeases.at(-1)!;

    expect(leaseAfter).toBe(leaseBefore);
    expect(leaseAfter.progress).toBe(leaseBefore.progress);
    expect(leaseAfter.retry).toBe(leaseBefore.retry);
    expect(leaseAfter.settle).toBe(leaseBefore.settle);
    expect(leaseEffects).toHaveBeenCalledTimes(effectsBefore);
  });

  it('emits one aggregate with warm eight, running four, and one timer', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    const onDiagnosticFinish = jest.fn<void, [TopicBodyMediaAggregate]>();
    const diagnosticSession = {
      networkMediaCount: 2_000,
      plannedRowCount: 500,
      source: 'nodeseek' as const,
      topicRef: 'topic-opaque-42'
    };
    const probes = (active: boolean) => (
      <CoordinatorHarness active={active} diagnosticSession={diagnosticSession} onDiagnosticFinish={onDiagnosticFinish}>
        {Array.from({ length: 12 }, (_, index) => (
          <MediaProbe
            id={index === 11 ? 'https://secret.example/image.jpg?token=private' : `image-${index}`}
            key={index}
            probeKey={`image-${index}`}
          />
        ))}
      </CoordinatorHarness>
    );
    try {
      const view = await render(probes(true));
      await fireEvent.press(view.getByLabelText('display-image-0'));
      await fireEvent.press(view.getByLabelText('error-image-1'));
      await fireEvent.press(view.getByLabelText('retry-image-1'));
      await act(() => jest.advanceTimersByTime(30_000));

      expect(onDiagnosticFinish).not.toHaveBeenCalled();
      await view.rerender(probes(false));
      expect(onDiagnosticFinish).not.toHaveBeenCalled();
      await view.unmount();

      expect(onDiagnosticFinish).toHaveBeenCalledTimes(1);
      expect(onDiagnosticFinish).toHaveBeenCalledWith({
        cancelCount: 4,
        displayCount: 1,
        errorCount: 1,
        networkMediaCount: 2_000,
        operation: 'topic-body-media',
        phase: 'finish',
        plannedRowCount: 500,
        retryCount: 4,
        runningHighWater: 4,
        source: 'nodeseek',
        timeoutCount: 4,
        timerHighWater: 1,
        topicRef: 'topic-opaque-42',
        warmHighWater: 8
      });
      expect(JSON.stringify(onDiagnosticFinish.mock.calls)).not.toContain('secret.example');
      expect(JSON.stringify(onDiagnosticFinish.mock.calls)).not.toContain('requestIdentity');
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps planned row and network media counts as route-session high-water marks', async () => {
    const onDiagnosticFinish = jest.fn<void, [TopicBodyMediaAggregate]>();
    const tree = (plannedRowCount: number, networkMediaCount: number) => (
      <CoordinatorHarness
        diagnosticSession={{
          networkMediaCount,
          plannedRowCount,
          source: 'nodeseek',
          topicRef: 'topic-high-water'
        }}
        onDiagnosticFinish={onDiagnosticFinish}
      >
        {null}
      </CoordinatorHarness>
    );
    const view = await render(tree(1, 1));

    await view.rerender(tree(500, 2_000));
    await view.rerender(tree(2, 4));
    await view.unmount();

    expect(onDiagnosticFinish).toHaveBeenCalledTimes(1);
    expect(onDiagnosticFinish).toHaveBeenCalledWith(
      expect.objectContaining({
        networkMediaCount: 2_000,
        plannedRowCount: 500,
        topicRef: 'topic-high-water'
      })
    );
  });

  it('records only the first finite first-row elapsed time for the route session', async () => {
    const onDiagnosticFinish = jest.fn<void, [TopicBodyMediaAggregate]>();
    const view = await render(
      <CoordinatorHarness
        diagnosticSession={{
          networkMediaCount: 1,
          plannedRowCount: 1,
          source: 'nodeseek',
          topicRef: 'topic-first-row'
        }}
        onDiagnosticFinish={onDiagnosticFinish}
      >
        <FirstRowMarkerProbe />
      </CoordinatorHarness>
    );

    await fireEvent.press(view.getByLabelText('mark-first-row-250'));
    await fireEvent.press(view.getByLabelText('mark-first-row-900'));
    await view.unmount();

    expect(onDiagnosticFinish).toHaveBeenCalledTimes(1);
    expect(onDiagnosticFinish).toHaveBeenCalledWith(
      expect.objectContaining({
        firstRowElapsedMs: 250,
        topicRef: 'topic-first-row'
      })
    );
  });

  it('records the first admitted media request relative to the ready topic revision', async () => {
    const nowSpy = jest.spyOn(globalThis.performance, 'now').mockReturnValue(1_000);
    const onDiagnosticFinish = jest.fn<void, [TopicBodyMediaAggregate]>();
    try {
      const view = await render(
        <CoordinatorHarness
          diagnosticSession={{
            networkMediaCount: 1,
            plannedRowCount: 1,
            responseReadyAt: 750,
            source: 'nodeseek',
            topicRef: 'topic-first-media'
          }}
          onDiagnosticFinish={onDiagnosticFinish}
        >
          <MediaProbe id="first-media" />
        </CoordinatorHarness>
      );

      await view.unmount();

      expect(onDiagnosticFinish).toHaveBeenCalledWith(
        expect.objectContaining({ firstMediaElapsedMs: 250, topicRef: 'topic-first-media' })
      );
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('finishes the previous provider session once and isolates metrics when the topic identity changes', async () => {
    const onDiagnosticFinish = jest.fn<void, [TopicBodyMediaAggregate]>();
    const tree = (topicRef: string, plannedRowCount: number, networkMediaCount: number) => (
      <CoordinatorHarness
        diagnosticSession={{
          networkMediaCount,
          plannedRowCount,
          source: 'nodeseek',
          topicRef
        }}
        onDiagnosticFinish={onDiagnosticFinish}
      >
        <FirstRowMarkerProbe />
      </CoordinatorHarness>
    );
    const view = await render(tree('topic-session-a', 500, 2_000));
    await fireEvent.press(view.getByLabelText('mark-first-row-250'));

    await view.rerender(tree('topic-session-b', 2, 4));

    expect(onDiagnosticFinish).toHaveBeenCalledTimes(1);
    expect(onDiagnosticFinish.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        firstRowElapsedMs: 250,
        networkMediaCount: 2_000,
        plannedRowCount: 500,
        topicRef: 'topic-session-a'
      })
    );

    await fireEvent.press(view.getByLabelText('mark-first-row-900'));
    await view.unmount();

    expect(onDiagnosticFinish).toHaveBeenCalledTimes(2);
    expect(onDiagnosticFinish.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        firstRowElapsedMs: 900,
        networkMediaCount: 4,
        plannedRowCount: 2,
        topicRef: 'topic-session-b'
      })
    );
  });

  it('swallows aggregate reporter failures so diagnostics cannot change route teardown', async () => {
    const onDiagnosticFinish = jest.fn(() => {
      throw new Error('diagnostic writer unavailable');
    });
    const view = await render(
      <CoordinatorHarness
        diagnosticSession={{
          networkMediaCount: 1,
          plannedRowCount: 1,
          source: 'nodeseek',
          topicRef: 'topic-opaque-1'
        }}
        onDiagnosticFinish={onDiagnosticFinish}
      >
        <PassiveMediaProbe id="image" />
      </CoordinatorHarness>
    );

    await view.unmount();
    expect(onDiagnosticFinish).toHaveBeenCalledTimes(1);
  });
});
