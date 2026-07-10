import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = path.resolve(__dirname, '..');

function readSource(...parts: string[]) {
  return readFileSync(path.join(rootDir, ...parts), 'utf8');
}

describe('account proxy guard', () => {
  it('keeps the Yaohuo login check callback bound to the current proxy fetcher', () => {
    const source = readSource('src', 'app', 'useAccountController.ts');

    expect(source).toContain('yaohuoFetcher: forumFetchWithWebViewFallback');
    expect(source).toContain('}, [checkingRequestIdRef, clearYaohuoLoginState, currentYaohuoCredentialGeneration, currentYaohuoLoginTrace, finishYaohuoLoginTrace, forumFetchWithWebViewFallback, notify, saveYaohuoCookieHeader, setChecking, updateYaohuoSession]);');
  });
});
