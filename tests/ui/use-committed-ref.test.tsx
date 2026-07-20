import { describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { Suspense, useCallback, useLayoutEffect } from 'react';
import { Text } from 'react-native';
import { useCommittedRef } from '../../src/app/useCommittedRef';

const NEVER_SETTLES = new Promise<void>(() => undefined);

function CommittedRefProbe({
  onCommit,
  suspend,
  value
}: {
  onCommit: (read: () => string) => void;
  suspend?: boolean;
  value: string;
}) {
  const valueRef = useCommittedRef(value);
  const read = useCallback(() => valueRef.current, [valueRef]);

  useLayoutEffect(() => {
    onCommit(read);
  }, [onCommit, read]);

  if (suspend) {
    throw NEVER_SETTLES;
  }
  return <Text>{value}</Text>;
}

describe('useCommittedRef', () => {
  it('keeps the committed value when a newer render is suspended and discarded', async () => {
    const committedReader: { current?: () => string } = {};
    const onCommit = jest.fn((read: () => string) => {
      committedReader.current = read;
    });
    const view = await render(
      <Suspense fallback={<Text>loading</Text>}>
        <CommittedRefProbe onCommit={onCommit} value="committed" />
      </Suspense>
    );

    expect(committedReader.current?.()).toBe('committed');

    await view.rerender(
      <Suspense fallback={<Text>loading</Text>}>
        <CommittedRefProbe onCommit={onCommit} suspend value="discarded" />
      </Suspense>
    );

    expect(committedReader.current?.()).toBe('committed');
  });
});
