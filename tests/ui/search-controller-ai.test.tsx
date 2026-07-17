import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useSearchController } from '../../src/app/useSearchController';
import { setDiagnosticWriter } from '../../src/diagnostics';
import { DEFAULT_SEARCH_FILTERS, type SearchFilterState } from '../../src/searchFilters';
import { createSiteSessionStates, createSiteSessionViewModels } from '../../src/siteSessionState';
import type { SourceGateway } from '../../src/sources/sourceGateway';
import type { SearchResponse, Topic } from '../../src/types';

const mockStorageGetItem = jest.fn<(key: string) => Promise<string | null>>(async () => null);
const mockStorageSetItem = jest.fn<(key: string, value: string) => Promise<void>>(async () => undefined);

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (key: string) => mockStorageGetItem(key),
    setItem: (key: string, value: string) => mockStorageSetItem(key, value)
  }
}));

const standardTopic: Topic = {
  source: 'linuxdo',
  id: '1',
  title: '普通结果',
  author: 'alice',
  url: 'https://linux.do/t/1',
  createdAt: '2026-07-17T00:00:00.000Z',
  replyCount: 1
};

const aiOnlyTopic: Topic = {
  ...standardTopic,
  id: 'ai-2',
  title: 'AI 独有结果',
  url: 'https://linux.do/t/ai-2',
  isAiGenerated: true
};

const loggedInSessions = createSiteSessionViewModels(createSiteSessionStates({
  linuxdo: {
    site: 'linuxdo',
    status: 'logged-in',
    cookieSummary: ['session-present'],
    isVerifying: false
  }
}));

function createGateway({
  searchSemanticTopics,
  searchTopics
}: {
  searchSemanticTopics: SourceGateway['searchSemanticTopics'];
  searchTopics: SourceGateway['searchTopics'];
}) {
  return {
    searchSemanticTopics,
    searchTagOptions: jest.fn(async () => []),
    searchUserOptions: jest.fn(async () => []),
    searchTopics
  } as unknown as SourceGateway;
}

function renderSearchController(sourceGateway: SourceGateway) {
  return renderHook(() => useSearchController({
    categories: [{ source: 'linuxdo', id: '4', name: '开发调优', slug: 'dev' }],
    notify: jest.fn(),
    sessionViewModels: loggedInSessions,
    showNodeSeekVerification: jest.fn(),
    showYaohuoLogin: jest.fn(),
    sourceGateway
  }));
}

async function prepareLinuxDoSearch(hook: Awaited<ReturnType<typeof renderSearchController>>, query: string) {
  await act(async () => {
    hook.result.current.setSearchSource('linuxdo');
    hook.result.current.setSearchQuery(query);
  });
  await waitFor(() => {
    expect(hook.result.current.searchSource).toBe('linuxdo');
    expect(hook.result.current.searchQuery).toBe(query);
  });
}

describe('linux.do AI search controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    setDiagnosticWriter(null);
  });

  it('runs AI in parallel, caches it behind the switch, and keeps it after standard pagination', async () => {
    const diagnosticLines: string[] = [];
    setDiagnosticWriter((line) => { diagnosticLines.push(line); });
    const firstStandard = Promise.withResolvers<SearchResponse>();
    const ai = Promise.withResolvers<SearchResponse>();
    const searchTopics = jest.fn<SourceGateway['searchTopics']>()
      .mockImplementationOnce(async () => firstStandard.promise)
      .mockResolvedValueOnce({
        items: [{ ...standardTopic, id: '2', title: '普通第二页', url: 'https://linux.do/t/2' }],
        errors: {},
        hasMore: false,
        nextPage: null
      });
    const searchSemanticTopics = jest.fn<SourceGateway['searchSemanticTopics']>(async () => ai.promise);
    const hook = await renderSearchController(createGateway({ searchSemanticTopics, searchTopics }));
    await prepareLinuxDoSearch(hook, 'codex');
    const filters: SearchFilterState = {
      ...DEFAULT_SEARCH_FILTERS,
      linuxdo: {
        ...DEFAULT_SEARCH_FILTERS.linuxdo,
        category: '4',
        tags: ['人工智能', '快问快答'],
        tagMatch: 'all',
        expertResponse: true
      }
    };

    let searchPromise!: Promise<void>;
    await act(async () => {
      searchPromise = hook.result.current.runSearch({ query: 'codex', source: 'linuxdo', filters });
      await Promise.resolve();
    });
    await waitFor(() => expect(searchSemanticTopics).toHaveBeenCalledTimes(1));
    expect(searchSemanticTopics.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      source: 'linuxdo',
      query: 'codex category:4 tags:人工智能+快问快答 with:category_expert_response'
    }));
    await waitFor(() => expect(hook.result.current.searchBusy).toBe(true));

    await act(async () => {
      ai.resolve({ items: [{ ...standardTopic, isAiGenerated: true }, aiOnlyTopic], errors: {}, hasMore: false, nextPage: null });
      await ai.promise;
    });
    await waitFor(() => expect(hook.result.current.linuxDoAiState.status).toBe('ready'));
    expect(hook.result.current.searchBusy).toBe(true);

    await act(async () => {
      firstStandard.resolve({ items: [standardTopic], errors: {}, hasMore: true, nextPage: 2 });
      await searchPromise;
    });
    expect(hook.result.current.searchGroups[0]?.items.map((topic) => topic.id)).toEqual(['1']);

    await act(async () => hook.result.current.toggleLinuxDoAiSearch());
    expect(hook.result.current.searchGroups[0]?.items.map((topic) => topic.id)).toEqual(['1', 'ai-2']);
    expect(hook.result.current.searchGroups[0]?.items[1]?.isAiGenerated).toBe(true);

    await act(async () => {
      await hook.result.current.loadMoreSearchSource('linuxdo', 2);
    });
    expect(hook.result.current.searchGroups[0]?.items.map((topic) => topic.id)).toEqual(['1', '2', 'ai-2']);

    await act(async () => hook.result.current.toggleLinuxDoAiSearch());
    expect(hook.result.current.searchGroups[0]?.items.map((topic) => topic.id)).toEqual(['1', '2']);
    await act(async () => hook.result.current.toggleLinuxDoAiSearch());
    expect(searchSemanticTopics).toHaveBeenCalledTimes(1);
    const semanticEvents = diagnosticLines
      .map((line) => JSON.parse(line))
      .filter(({ operation }) => operation === 'searchSemanticTopics');
    expect(semanticEvents.map(({ phase }) => phase)).toEqual(['intent', 'guard', 'apply', 'finish']);
    expect(searchSemanticTopics.mock.calls[0]?.[1]?.trace?.traceId).toBe(semanticEvents[0]?.traceId);
    expect(new Set(semanticEvents.map(({ traceId }) => traceId))).toHaveProperty('size', 1);
    expect(diagnosticLines.join('')).not.toContain('人工智能');
    expect(diagnosticLines.join('')).not.toContain('快问快答');
  });

  it('passes one safe controller trace into each generic candidate gateway read', async () => {
    const diagnosticLines: string[] = [];
    setDiagnosticWriter((line) => { diagnosticLines.push(line); });
    const searchTopics = jest.fn<SourceGateway['searchTopics']>().mockResolvedValue({
      items: [standardTopic],
      errors: {},
      hasMore: false,
      nextPage: null
    });
    const searchSemanticTopics = jest.fn<SourceGateway['searchSemanticTopics']>();
    const gateway = createGateway({ searchSemanticTopics, searchTopics });
    const searchTagOptions = jest.fn<SourceGateway['searchTagOptions']>(async () => [{ name: 'private-tag' }]);
    const searchUserOptions = jest.fn<SourceGateway['searchUserOptions']>(async () => [{ id: '7', username: 'private-user' }]);
    gateway.searchTagOptions = searchTagOptions;
    gateway.searchUserOptions = searchUserOptions;
    const hook = await renderSearchController(gateway);

    await act(async () => {
      await hook.result.current.searchLinuxDoTags({ query: 'private-tag', selectedTags: [] });
      await hook.result.current.searchLinuxDoUsers({ term: 'private-user' });
    });

    for (const [operation, mock] of [
      ['searchTagOptions', searchTagOptions],
      ['searchUserOptions', searchUserOptions]
    ] as const) {
      const events = diagnosticLines.map((line) => JSON.parse(line)).filter((event) => event.operation === operation);
      expect(events.map(({ phase }) => phase)).toEqual(['intent', 'guard', 'apply', 'finish']);
      expect(mock.mock.calls[0]?.[1]?.trace?.traceId).toBe(events[0]?.traceId);
      expect(new Set(events.map(({ traceId }) => traceId))).toHaveProperty('size', 1);
    }
    expect(diagnosticLines.join('')).not.toContain('private-tag');
    expect(diagnosticLines.join('')).not.toContain('private-user');
  });

  it('ignores an old AI response after a new query and retries only retryable failures', async () => {
    const diagnosticLines: string[] = [];
    setDiagnosticWriter((line) => { diagnosticLines.push(line); });
    const firstAi = Promise.withResolvers<SearchResponse>();
    const secondAi = Promise.withResolvers<SearchResponse>();
    const searchTopics = jest.fn<SourceGateway['searchTopics']>().mockResolvedValue({
      items: [standardTopic],
      errors: {},
      hasMore: false,
      nextPage: null
    });
    const searchSemanticTopics = jest.fn<SourceGateway['searchSemanticTopics']>()
      .mockImplementationOnce(async () => firstAi.promise)
      .mockImplementationOnce(async () => secondAi.promise)
      .mockRejectedValueOnce(Object.assign(new Error('limited'), { status: 429 }))
      .mockResolvedValueOnce({ items: [aiOnlyTopic], errors: {}, hasMore: false, nextPage: null });
    const hook = await renderSearchController(createGateway({ searchSemanticTopics, searchTopics }));
    await prepareLinuxDoSearch(hook, 'first');

    await act(async () => {
      await hook.result.current.runSearch();
    });
    await act(async () => {
      hook.result.current.setSearchQuery('second');
    });
    await act(async () => {
      await hook.result.current.runSearch({ query: 'second', source: 'linuxdo', filters: DEFAULT_SEARCH_FILTERS });
    });
    expect(hook.result.current.linuxDoAiState.status).toBe('loading');

    await act(async () => {
      firstAi.resolve({ items: [{ ...aiOnlyTopic, id: 'stale' }], errors: {}, hasMore: false, nextPage: null });
      await firstAi.promise;
    });
    expect(hook.result.current.linuxDoAiState.status).toBe('loading');

    await act(async () => {
      secondAi.resolve({ items: [{ ...aiOnlyTopic, id: 'fresh' }], errors: {}, hasMore: false, nextPage: null });
      await secondAi.promise;
    });
    await waitFor(() => expect(hook.result.current.linuxDoAiState.status).toBe('ready'));

    await act(async () => {
      hook.result.current.setSearchQuery('third');
    });
    await act(async () => {
      await hook.result.current.runSearch({ query: 'third', source: 'linuxdo', filters: DEFAULT_SEARCH_FILTERS });
    });
    await waitFor(() => expect(hook.result.current.linuxDoAiState.status).toBe('error'));
    await act(async () => hook.result.current.retryLinuxDoAiSearch());
    await waitFor(() => expect(hook.result.current.linuxDoAiState.status).toBe('ready'));
    expect(searchSemanticTopics).toHaveBeenCalledTimes(4);
    expect(diagnosticLines
      .map((line) => JSON.parse(line))
      .filter(({ operation, phase }) => operation === 'searchSemanticTopics' && phase === 'finish')
      .map(({ outcome }) => outcome)).toEqual(['canceled', 'success', 'failure', 'success']);
  });

  it('does not expose or request AI search for latest-order results', async () => {
    const searchTopics = jest.fn<SourceGateway['searchTopics']>().mockResolvedValue({
      items: [standardTopic],
      errors: {},
      hasMore: false,
      nextPage: null
    });
    const searchSemanticTopics = jest.fn<SourceGateway['searchSemanticTopics']>();
    const hook = await renderSearchController(createGateway({ searchSemanticTopics, searchTopics }));
    await prepareLinuxDoSearch(hook, 'latest only');

    await act(async () => {
      hook.result.current.applySearchFilter('linuxdo', { ...DEFAULT_SEARCH_FILTERS.linuxdo, order: 'latest' });
    });
    await waitFor(() => expect(searchTopics).toHaveBeenCalledTimes(1));

    expect(searchSemanticTopics).not.toHaveBeenCalled();
    expect(hook.result.current.linuxDoAiVisible).toBe(false);
    expect(hook.result.current.linuxDoAiState.status).toBe('idle');
  });
});
