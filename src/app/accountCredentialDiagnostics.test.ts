import { afterEach, describe, expect, it } from 'vitest';
import type { CredentialSite, CredentialSummary } from '../credentialVault';
import { beginDiagnosticTrace, setDiagnosticWriter, type DiagnosticEvent } from '../diagnostics';
import {
  finishCredentialFillTraceForWebViewFailure,
  loadCredentialSummariesWithTrace
} from './accountCredentialDiagnostics';

const summaries: Record<CredentialSite, CredentialSummary> = {
  nodeseek: { site: 'nodeseek', state: 'saved', hasCredential: true, protection: 'biometric' },
  linuxdo: { site: 'linuxdo', state: 'missing', hasCredential: false, protection: null },
  yaohuo: { site: 'yaohuo', state: 'invalidated', hasCredential: false, protection: null }
};

afterEach(() => setDiagnosticWriter(null));

describe('account credential diagnostics', () => {
  it('records per-site summary results under a distinct operation without secrets', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });

    const result = await loadCredentialSummariesWithTrace(async (site) => summaries[site]);

    expect(result).toEqual({ ok: true, summaries });
    const events = lines.map((line) => JSON.parse(line) as DiagnosticEvent);
    expect(events.filter((event) => event.operation === 'load-summary')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: 'credential', site: 'nodeseek', hasCredential: true }),
        expect.objectContaining({ phase: 'credential', site: 'yaohuo', isInvalidated: true }),
        expect.objectContaining({ phase: 'finish', outcome: 'success', count: 3, validCount: 1 })
      ])
    );
    expect(lines.join('')).not.toMatch(/account|password|cookie|key/i);
  });

  it('returns a handled failure and identifies the failing site without logging its error', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const privateError = new Error('PRIVATE_STORAGE_ERROR_WITH_ACCOUNT');

    const result = await loadCredentialSummariesWithTrace(async (site) => {
      if (site === 'linuxdo') {
        throw privateError;
      }
      return summaries[site];
    });

    expect(result).toEqual({
      ok: false,
      error: privateError,
      summaries: {
        nodeseek: summaries.nodeseek,
        yaohuo: summaries.yaohuo
      }
    });
    const events = lines.map((line) => JSON.parse(line) as DiagnosticEvent);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'load-summary',
          phase: 'credential',
          site: 'linuxdo',
          reason: 'storage_error'
        }),
        expect.objectContaining({
          operation: 'load-summary',
          phase: 'finish',
          outcome: 'partial',
          partialErrorCount: 1
        })
      ])
    );
    expect(lines.join('')).not.toContain('PRIVATE_STORAGE_ERROR_WITH_ACCOUNT');
  });

  it('REG-ACCOUNT-006 returns successful credential summaries when one site fails', async () => {
    const privateError = new Error('one site unavailable');

    const result = await loadCredentialSummariesWithTrace(async (site) => {
      if (site === 'linuxdo') {
        throw privateError;
      }
      return summaries[site];
    });

    expect(result).toEqual({
      ok: false,
      error: privateError,
      summaries: {
        nodeseek: summaries.nodeseek,
        yaohuo: summaries.yaohuo
      }
    });
  });

  it('finishes only the matching automatic-fill trace on WebView failure', () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const trace = beginDiagnosticTrace('credential', 'load', { site: 'nodeseek' });

    expect(
      finishCredentialFillTraceForWebViewFailure({ site: 'nodeseek', attempt: 1, trace }, 'yaohuo', 1, 'network_error')
    ).toBe(false);
    expect(
      finishCredentialFillTraceForWebViewFailure(
        { site: 'nodeseek', attempt: 1, trace },
        'nodeseek',
        1,
        'renderer_gone'
      )
    ).toBe(true);

    const events = lines.map((line) => JSON.parse(line) as DiagnosticEvent);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: 'transport', site: 'nodeseek', reason: 'renderer_gone' }),
        expect.objectContaining({ phase: 'finish', outcome: 'failure', site: 'nodeseek', reason: 'renderer_gone' })
      ])
    );
  });

  it('does not let an older same-site attempt finish the current trace', () => {
    const trace = beginDiagnosticTrace('credential', 'load', { site: 'nodeseek' });
    const finishForAttempt = finishCredentialFillTraceForWebViewFailure as unknown as (
      current: { site: CredentialSite; attempt: number; trace: typeof trace } | null,
      site: CredentialSite,
      attempt: number,
      reason: 'timeout'
    ) => boolean;

    expect(finishForAttempt({ site: 'nodeseek', attempt: 2, trace }, 'nodeseek', 1, 'timeout')).toBe(false);
  });

  it('marks a superseded summary read stale instead of returning data to apply', async () => {
    const loadWithGeneration = loadCredentialSummariesWithTrace as unknown as (
      loadSummary: (site: CredentialSite) => Promise<CredentialSummary>,
      options: { generation: number; isCurrent: () => boolean }
    ) => ReturnType<typeof loadCredentialSummariesWithTrace>;

    const result = await loadWithGeneration(
      async (site) => {
        if (site === 'linuxdo') {
          throw new Error('superseded failure');
        }
        return summaries[site];
      },
      {
        generation: 1,
        isCurrent: () => false
      }
    );

    expect(result).toEqual({ ok: false, stale: true });
  });
});
