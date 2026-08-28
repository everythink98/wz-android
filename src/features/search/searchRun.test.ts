import { describe, expect, it } from 'vitest';
import { DEFAULT_SEARCH_FILTERS } from '@/domain/forum/searchFilters';
import { snapshotSearchFilters } from './searchRun';

describe('submitted search model', () => {
  it('keeps submitted filters independent from later drafts', () => {
    const filters = snapshotSearchFilters(DEFAULT_SEARCH_FILTERS);
    filters.linuxdo.tags.push('人工智能');
    filters.linuxdo.visited.push('seen');
    const submitted = snapshotSearchFilters(filters);

    filters.linuxdo.tags.push('快问快答');
    filters.linuxdo.visited.push('likes');

    expect(submitted.linuxdo.tags).toEqual(['人工智能']);
    expect(submitted.linuxdo.visited).toEqual(['seen']);
  });
});
