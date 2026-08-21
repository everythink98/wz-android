import { describe, expect, it } from 'vitest';

import {
  aggregateFeedSources,
  aggregateSearchSources,
  isFeedFilterSource,
  isDiscourseSource,
  isSessionSource,
  isNotificationSource,
  isNodeSeekHost,
  notificationSources,
  sessionSources,
  sourceCatalog,
  sourceValues,
  sourceSupportsTopicAction
} from './sourceCatalog';

describe('source capability catalog', () => {
  it('registers linux.do as the Discourse source', () => {
    expect(isDiscourseSource('linuxdo')).toBe(true);
    expect(isDiscourseSource('nodeseek')).toBe(false);
    expect(isFeedFilterSource('linuxdo')).toBe(true);
    expect(isFeedFilterSource('yaohuo')).toBe(false);
  });

  it('exposes semantic actions', () => {
    expect(sourceSupportsTopicAction('linuxdo', 'like')).toBe(true);
    expect(sourceSupportsTopicAction('v2ex', 'like')).toBe(false);
  });

  it('[REG-WRITE-013] does not advertise NodeSeek reply deletion when the original site exposes no confirmed delete action', () => {
    expect(sourceSupportsTopicAction('nodeseek', 'edit')).toBe(true);
    expect(sourceSupportsTopicAction('nodeseek', 'delete')).toBe(false);
  });

  it('derives aggregate registration from the catalog', () => {
    expect(sourceValues).toEqual(['nodeseek', 'linuxdo', 'v2ex', 'yaohuo']);
    expect(aggregateFeedSources).toEqual(['nodeseek', 'linuxdo', 'v2ex', 'yaohuo']);
    expect(aggregateSearchSources).toEqual(['v2ex', 'linuxdo', 'nodeseek', 'yaohuo']);
    expect(sessionSources).toEqual(['nodeseek', 'linuxdo', 'yaohuo']);
  });

  it('[REG-SOURCE-008] derives managed sessions from their own catalog capability', () => {
    expect(Object.fromEntries(sourceValues.map((source) => [source, sourceCatalog[source].managedSession]))).toEqual({
      nodeseek: true,
      v2ex: false,
      linuxdo: true,
      yaohuo: true
    });
    expect(sourceValues.filter(isSessionSource)).toEqual(sessionSources);
  });

  it('derives notification registration from the catalog and keeps V2EX out until its protocol exists', () => {
    expect(notificationSources).toEqual(['nodeseek', 'linuxdo', 'yaohuo']);
    expect(sourceValues.filter(isNotificationSource)).toEqual(notificationSources);
    expect(sourceCatalog.v2ex.notifications).toBe(false);
  });

  it.each([
    ['nodeseek.com', true],
    ['www.nodeseek.com', true],
    ['STATIC.NODESEEK.COM', true],
    ['nodeseek.com.example', false],
    ['evilnodeseek.com', false],
    ['', false]
  ] as const)('classifies the NodeSeek host boundary for %s', (hostname, expected) => {
    expect(isNodeSeekHost(hostname)).toBe(expected);
  });
});
