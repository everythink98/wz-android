import { describe, expect, it } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  TopicSplitDisclosureProvider,
  TopicSplitDisclosureScope,
  useTopicSplitDisclosure
} from '@/features/topic/rendering/TopicSplitDisclosure';

type SplitKind = 'callout' | 'details';
type SplitPart = 'first' | 'middle' | 'last' | 'only';

function DisclosurePart({
  defaultExpanded = false,
  group = 'block-0.0',
  id,
  kind,
  part,
  scopeKey
}: {
  defaultExpanded?: boolean;
  group?: string;
  id: string;
  kind: SplitKind;
  part: SplitPart;
  scopeKey: string;
}) {
  const attributes =
    kind === 'details'
      ? { 'data-wz-details-group': group, 'data-wz-details-part': part }
      : { 'data-wz-callout-group': group, 'data-wz-callout-part': part };
  return (
    <TopicSplitDisclosureScope scopeKey={scopeKey}>
      <DisclosurePartContent attributes={attributes} defaultExpanded={defaultExpanded} id={id} kind={kind} />
    </TopicSplitDisclosureScope>
  );
}

function DisclosurePartContent({
  attributes,
  defaultExpanded,
  id,
  kind
}: {
  attributes: Readonly<Record<string, string | undefined>>;
  defaultExpanded: boolean;
  id: string;
  kind: SplitKind;
}) {
  const disclosure = useTopicSplitDisclosure({ attributes, defaultExpanded, kind });
  return (
    <View>
      {disclosure.headerVisible ? (
        <Pressable
          accessibilityLabel={`toggle-${id}`}
          accessibilityRole="button"
          accessibilityState={{ expanded: disclosure.expanded }}
          onPress={disclosure.toggle}
        >
          <Text>{`header-${id}`}</Text>
        </Pressable>
      ) : null}
      {disclosure.expanded ? <Text>{`body-${id}`}</Text> : null}
    </View>
  );
}

function SharedPair({ kind, scopeKey }: { kind: SplitKind; scopeKey: string }) {
  return (
    <>
      <DisclosurePart id={`${scopeKey}-first`} kind={kind} part="first" scopeKey={scopeKey} />
      <DisclosurePart id={`${scopeKey}-middle`} kind={kind} part="middle" scopeKey={scopeKey} />
    </>
  );
}

describe('Topic split disclosure state', () => {
  it.each(['details', 'callout'] as const)('shares one %s disclosure across parent FlashList rows', async (kind) => {
    const view = await render(
      <TopicSplitDisclosureProvider key="linuxdo:100">
        <SharedPair kind={kind} scopeKey={`${kind}:opening:block-0`} />
      </TopicSplitDisclosureProvider>
    );

    expect(view.queryByText(`header-${kind}:opening:block-0-middle`)).toBeNull();
    expect(view.queryByText(`body-${kind}:opening:block-0-first`)).toBeNull();
    expect(view.queryByText(`body-${kind}:opening:block-0-middle`)).toBeNull();

    await fireEvent.press(view.getByLabelText(`toggle-${kind}:opening:block-0-first`));

    expect(view.getByText(`body-${kind}:opening:block-0-first`)).toBeTruthy();
    expect(view.getByText(`body-${kind}:opening:block-0-middle`)).toBeTruthy();

    await fireEvent.press(view.getByLabelText(`toggle-${kind}:opening:block-0-first`));
    expect(view.queryByText(`body-${kind}:opening:block-0-first`)).toBeNull();
    expect(view.queryByText(`body-${kind}:opening:block-0-middle`)).toBeNull();
  });

  it('isolates identical planner group attributes by content entrance and HTML instance', async () => {
    const view = await render(
      <TopicSplitDisclosureProvider key="linuxdo:100">
        <SharedPair kind="details" scopeKey="opening-copy-a:block-0" />
        <SharedPair kind="details" scopeKey="opening-copy-b:block-0" />
        <SharedPair kind="details" scopeKey="reply:comment-2:body:block-0" />
      </TopicSplitDisclosureProvider>
    );

    await fireEvent.press(view.getByLabelText('toggle-opening-copy-a:block-0-first'));

    expect(view.getByText('body-opening-copy-a:block-0-middle')).toBeTruthy();
    expect(view.queryByText('body-opening-copy-b:block-0-middle')).toBeNull();
    expect(view.queryByText('body-reply:comment-2:body:block-0-middle')).toBeNull();
  });

  it('resets shared disclosure state when the Topic changes', async () => {
    const first = (
      <TopicSplitDisclosureProvider key="linuxdo:100">
        <SharedPair kind="details" scopeKey="opening:block-0" />
      </TopicSplitDisclosureProvider>
    );
    const view = await render(first);
    await fireEvent.press(view.getByLabelText('toggle-opening:block-0-first'));
    expect(view.getByText('body-opening:block-0-middle')).toBeTruthy();

    await view.rerender(
      <TopicSplitDisclosureProvider key="linuxdo:101">
        <SharedPair kind="details" scopeKey="opening:block-0" />
      </TopicSplitDisclosureProvider>
    );

    expect(view.queryByText('body-opening:block-0-first')).toBeNull();
    expect(view.queryByText('body-opening:block-0-middle')).toBeNull();

    await view.rerender(
      <TopicSplitDisclosureProvider key="linuxdo:100">
        <SharedPair kind="details" scopeKey="opening:block-0" />
      </TopicSplitDisclosureProvider>
    );
    expect(view.queryByText('body-opening:block-0-first')).toBeNull();
    expect(view.queryByText('body-opening:block-0-middle')).toBeNull();
  });

  it('keeps unsplit details independent even when their attributes and scope match', async () => {
    const view = await render(
      <TopicSplitDisclosureProvider key="linuxdo:100">
        <DisclosurePart id="only-a" kind="details" part="only" scopeKey="opening:block-0" />
        <DisclosurePart id="only-b" kind="details" part="only" scopeKey="opening:block-0" />
      </TopicSplitDisclosureProvider>
    );

    await fireEvent.press(view.getByLabelText('toggle-only-a'));

    expect(view.getByText('body-only-a')).toBeTruthy();
    expect(view.queryByText('body-only-b')).toBeNull();
  });
});
