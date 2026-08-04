import { describe, expect, it } from 'vitest';

import {
  aggregateFeedSources,
  aggregateSearchSources,
  isFeedFilterSource,
  isDiscourseSource,
  isSessionSource,
  isNotificationSource,
  notificationSources,
  sessionSources,
  sourceCatalog,
  sourceValues,
  sourceSupportsTopicAction,
  sourceUsesTopicCreatePermission
} from './sourceCatalog';

describe('source capability catalog', () => {
  it('registers linux.do and Xiaoyinsi as independent Discourse sources', () => {
    expect(sourceCatalog.linuxdo).not.toBe(sourceCatalog.xiaoyinsi);
    expect(isDiscourseSource('linuxdo')).toBe(true);
    expect(isDiscourseSource('xiaoyinsi')).toBe(true);
    expect(isDiscourseSource('nodeseek')).toBe(false);
    expect(isFeedFilterSource('xiaoyinsi')).toBe(true);
    expect(isFeedFilterSource('yaohuo')).toBe(false);
  });

  it('exposes semantic actions and per-site reply permission policy', () => {
    expect(sourceSupportsTopicAction('linuxdo', 'like')).toBe(true);
    expect(sourceSupportsTopicAction('xiaoyinsi', 'like')).toBe(true);
    expect(sourceSupportsTopicAction('v2ex', 'like')).toBe(false);
    expect(sourceUsesTopicCreatePermission('linuxdo')).toBe(false);
    expect(sourceUsesTopicCreatePermission('xiaoyinsi')).toBe(true);
  });

  it('[REG-WRITE-013] does not advertise NodeSeek reply deletion when the original site exposes no confirmed delete action', () => {
    expect(sourceSupportsTopicAction('nodeseek', 'edit')).toBe(true);
    expect(sourceSupportsTopicAction('nodeseek', 'delete')).toBe(false);
  });

  it('derives aggregate registration from the catalog', () => {
    expect(sourceValues).toEqual(['nodeseek', 'linuxdo', 'v2ex', 'yaohuo', 'xiaoyinsi']);
    expect(aggregateFeedSources).toEqual(['nodeseek', 'linuxdo', 'v2ex', 'yaohuo', 'xiaoyinsi']);
    expect(aggregateSearchSources).toEqual(['v2ex', 'linuxdo', 'nodeseek', 'yaohuo', 'xiaoyinsi']);
    expect(sessionSources).toEqual(['nodeseek', 'linuxdo', 'yaohuo', 'xiaoyinsi']);
  });

  it('[REG-SOURCE-008] derives managed sessions from their own catalog capability', () => {
    expect(Object.fromEntries(sourceValues.map((source) => [source, sourceCatalog[source].managedSession]))).toEqual({
      linuxdo: true,
      nodeseek: true,
      v2ex: false,
      xiaoyinsi: true,
      yaohuo: true
    });
    expect(sourceValues.filter(isSessionSource)).toEqual(sessionSources);
  });

  it('derives notification registration from the catalog and keeps V2EX out until its protocol exists', () => {
    expect(notificationSources).toEqual(['nodeseek', 'linuxdo', 'yaohuo', 'xiaoyinsi']);
    expect(sourceValues.filter(isNotificationSource)).toEqual(notificationSources);
    expect(sourceCatalog.v2ex.notifications).toBe(false);
  });
});
