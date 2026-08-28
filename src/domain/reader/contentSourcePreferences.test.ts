import { describe, expect, it } from 'vitest';
import {
  canonicalEnabledSourcesKey,
  defaultContentSourcePreferences,
  normalizeContentSourcePreferences,
  projectContentSourcePreferences
} from './contentSourcePreferences';

describe('content source preferences', () => {
  it('uses the current home order with every source enabled by default', () => {
    const preferences = defaultContentSourcePreferences();
    expect(preferences).toEqual([
      { source: 'v2ex', enabled: true },
      { source: 'linuxdo', enabled: true },
      { source: 'nodeseek', enabled: true },
      { source: 'yaohuo', enabled: true }
    ]);
    expect(preferences.map((preference) => preference.source)).toEqual(['v2ex', 'linuxdo', 'nodeseek', 'yaohuo']);
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
      { source: 'yaohuo', enabled: true }
    ]);
  });

  it('projects enabled sources into ordered Catalog capability subsets', () => {
    expect(
      projectContentSourcePreferences([
        { source: 'linuxdo', enabled: true },
        { source: 'v2ex', enabled: true },
        { source: 'yaohuo', enabled: true },
        { source: 'linuxdo', enabled: false },
        { source: 'nodeseek', enabled: true }
      ])
    ).toEqual({
      orderedSources: ['linuxdo', 'v2ex', 'yaohuo', 'nodeseek'],
      enabledSources: ['linuxdo', 'v2ex', 'yaohuo', 'nodeseek'],
      sessionSources: ['linuxdo', 'yaohuo', 'nodeseek'],
      notificationSources: ['linuxdo', 'yaohuo', 'nodeseek']
    });
  });

  it('supports an all-disabled selection', () => {
    expect(
      projectContentSourcePreferences(
        defaultContentSourcePreferences().map((preference) => ({ ...preference, enabled: false }))
      )
    ).toEqual({
      orderedSources: ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo'],
      enabledSources: [],
      sessionSources: [],
      notificationSources: []
    });
  });

  it('projects no source capabilities before persisted preferences settle', () => {
    expect(projectContentSourcePreferences(undefined, false)).toEqual({
      orderedSources: [],
      enabledSources: [],
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
      { source: 'linuxdo', enabled: false }
    ];

    expect(canonicalEnabledSourcesKey(sourceSet)).toBe('nodeseek,v2ex,yaohuo');
    expect(canonicalEnabledSourcesKey([...sourceSet].reverse())).toBe('nodeseek,v2ex,yaohuo');
  });
});
