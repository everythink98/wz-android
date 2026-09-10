import { describe, expect, it } from 'vitest';
import { createEmptyReaderState, projectReaderCommand } from '@/domain/reader/readerRecordState';

describe('reader settings commands', () => {
  it('validates settings while preserving all record memberships', () => {
    const current = createEmptyReaderState();
    const next = projectReaderCommand(current, { type: 'settings', patch: { fontScale: 100, theme: 'dark' } });
    expect(next.settings.fontScale).toBe(1.4);
    expect(next.settings.theme).toBe('dark');
    expect(next.history).toBe(current.history);
    expect(next.favorites).toBe(current.favorites);
  });
  it('unchanged settings preserve the current state', () => {
    const current = createEmptyReaderState();
    expect(projectReaderCommand(current, { type: 'settings', patch: { theme: current.settings.theme } })).toBe(current);
  });
});
