import { describe, expect, it } from 'vitest';
import {
  canonicalEnabledSourcesKey,
  defaultContentSourcePreferences,
  normalizeContentSourcePreferences,
  projectContentSourcePreferences
} from './contentSourcePreferences';
import { sourceValues } from '@/domain/forum/sourceCatalog';

describe('content source preferences', () => {
  it('uses the current home order with every source enabled by default', () => {
    const preferences = defaultContentSourcePreferences();
    expect(preferences.slice(0, 5)).toEqual([
      { source: 'v2ex', enabled: true },
      { source: 'linuxdo', enabled: true },
      { source: 'nodeseek', enabled: true },
      { source: 'yaohuo', enabled: true },
      { source: 'xiaoyinsi', enabled: true }
    ]);
    expect(preferences.map((preference) => preference.source)).toEqual([
      'v2ex',
      'linuxdo',
      'nodeseek',
      'yaohuo',
      'xiaoyinsi',
      ...sourceValues.filter((source) => !['v2ex', 'linuxdo', 'nodeseek', 'yaohuo', 'xiaoyinsi'].includes(source))
    ]);
    expect(preferences.every((preference) => preference.enabled)).toBe(true);
  });

  it('drops invalid entries, keeps each source first valid value, and adds missing defaults', () => {
    expect(
      normalizeContentSourcePreferences([
        { source: 'unknown', enabled: true },
        { source: 'toString', enabled: true },
        { source: 'v2ex', enabled: 'true' },
        { source: 'v2ex', enabled: false },
        { source: 'v2ex', enabled: true },
        { source: 'linuxdo', enabled: true }
      ])
    ).toEqual([
      { source: 'v2ex', enabled: false },
      { source: 'linuxdo', enabled: true },
      { source: 'nodeseek', enabled: true },
      { source: 'yaohuo', enabled: true },
      { source: 'xiaoyinsi', enabled: true }
    ]);
  });

  it('projects enabled sources into ordered Catalog capability subsets', () => {
    expect(
      projectContentSourcePreferences([
        { source: 'xiaoyinsi', enabled: true },
        { source: 'v2ex', enabled: true },
        { source: 'yaohuo', enabled: true },
        { source: 'linuxdo', enabled: false },
        { source: 'nodeseek', enabled: true }
      ])
    ).toEqual({
      orderedSources: ['xiaoyinsi', 'v2ex', 'yaohuo', 'linuxdo', 'nodeseek'],
      enabledSources: ['xiaoyinsi', 'v2ex', 'yaohuo', 'nodeseek'],
      feedSources: ['xiaoyinsi', 'v2ex', 'yaohuo', 'nodeseek'],
      searchSources: ['xiaoyinsi', 'v2ex', 'yaohuo', 'nodeseek'],
      sessionSources: ['xiaoyinsi', 'yaohuo', 'nodeseek'],
      notificationSources: ['xiaoyinsi', 'yaohuo', 'nodeseek']
    });
  });

  it('supports an all-disabled selection', () => {
    expect(
      projectContentSourcePreferences(
        defaultContentSourcePreferences().map((preference) => ({ ...preference, enabled: false }))
      )
    ).toEqual({
      orderedSources: ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo', 'xiaoyinsi'],
      enabledSources: [],
      feedSources: [],
      searchSources: [],
      sessionSources: [],
      notificationSources: []
    });
  });

  it('projects no source capabilities before persisted preferences settle', () => {
    expect(projectContentSourcePreferences(undefined, false)).toEqual({
      orderedSources: [],
      enabledSources: [],
      feedSources: [],
      searchSources: [],
      sessionSources: [],
      notificationSources: []
    });
  });

  it('keeps the enabled key when only preference order changes', () => {
    const sourceSet = [
      { source: 'v2ex', enabled: true },
      { source: 'linuxdo', enabled: false },
      { source: 'nodeseek', enabled: true },
      { source: 'yaohuo', enabled: true },
      { source: 'xiaoyinsi', enabled: false }
    ];

    expect(canonicalEnabledSourcesKey(sourceSet)).toBe('nodeseek,v2ex,yaohuo');
    expect(canonicalEnabledSourcesKey([...sourceSet].reverse())).toBe('nodeseek,v2ex,yaohuo');
  });
});
