import { describe, expect, it } from 'vitest';
import { createEmptyReaderData } from '../readerData';
import { applyReaderSettingsPatch } from './useReaderSettingsController';

describe('reader settings controller helpers', () => {
  it('updates only reader settings fields from the patch', () => {
    const current = createEmptyReaderData();
    const next = applyReaderSettingsPatch(current, {
      fontScale: 1.15,
      theme: 'dark'
    });

    expect(next).not.toBe(current);
    expect(next.settings).toEqual({
      ...current.settings,
      fontScale: 1.15,
      theme: 'dark'
    });
    expect(next.favorites).toBe(current.favorites);
    expect(next.history).toBe(current.history);
  });

  it('skips unchanged settings patches', () => {
    const current = createEmptyReaderData();
    const next = applyReaderSettingsPatch(current, {
      fontScale: current.settings.fontScale,
      theme: current.settings.theme
    });

    expect(next).toBe(current);
  });
});
