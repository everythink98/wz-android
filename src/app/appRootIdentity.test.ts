import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(...parts: string[]) {
  return readFileSync(path.join(process.cwd(), ...parts), 'utf8');
}

describe('AppRoot render identity guards', () => {
  it('passes a stable credential-fill callback to the memoized linux.do verification modal', () => {
    const appRoot = source('src', 'app', 'AppRoot.tsx');

    expect(appRoot).toContain('const requestLinuxDoCredentialFill = useCallback');
    expect(appRoot).toContain('requestLinuxDoCredentialFill={requestLinuxDoCredentialFill}');
    expect(appRoot).not.toContain("requestLinuxDoCredentialFill={() => openAccountLogin('linuxdo', true)}");
  });

  it('does not subscribe AppRoot or global styles to keyboard-driven window height', () => {
    const appRoot = source('src', 'app', 'AppRoot.tsx');
    const themeStyles = source('src', 'themeStyles.ts');

    expect(appRoot).toContain('const width = useAppWindowWidth();');
    expect(appRoot).not.toContain('useWindowDimensions');
    expect(appRoot).not.toContain('KeyboardAvoidingView');
    expect(themeStyles).toContain('createStyles(theme: ReaderTheme, settings: ReaderSettings)');
    expect(themeStyles).not.toContain('windowHeight');
  });

  it('updates callback and state mirror refs only after React commits', () => {
    const appRoot = source('src', 'app', 'AppRoot.tsx');

    for (const refName of [
      'showLoginPanelRef',
      'showLinuxDoPanelRef',
      'yaohuoCredentialSuppressedRef',
      'openImagePreviewRef',
      'openUserRef',
      'openTopicRef',
      'credentialFailureHandlerRef',
      'credentialClearIntentHandlerRef'
    ]) {
      expect(appRoot).not.toMatch(new RegExp(`^  ${refName}\\.current =`, 'm'));
    }
    expect(appRoot).toContain('useLayoutEffect');
  });
});
