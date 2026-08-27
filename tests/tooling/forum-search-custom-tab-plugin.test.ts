import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('forum search Custom Tab plugin', () => {
  it('[REG-SEARCH-028] generates a scoped current-URL handoff to MainActivity', () => {
    const { forumSearchCustomTabModuleSource } = require('../../plugins/withForumSearchCustomTab') as {
      forumSearchCustomTabModuleSource: (packageName: string) => string;
    };
    const source = forumSearchCustomTabModuleSource('com.wz.reader');

    expect(source).toContain('class ForumSearchCustomTabModule');
    expect(source).toContain('addMenuItem("在阅坛中打开当前主题", pendingIntent)');
    expect(source).toContain('PendingIntent.FLAG_MUTABLE');
    expect(source).toContain('Intent(reactContext, MainActivity::class.java)');
    expect(source).toContain('CustomTabsClient.getPackageName(activity, null)');
    expect(source).toContain('customTab.intent.setPackage(provider)');
    expect(source).toContain('url.host == "www.google.com"');
    expect(source).toContain('url.rawPath == "/search"');
    expect(source).not.toContain('addCategory(Intent.CATEGORY_BROWSABLE)');
  });

  it('adds the Android 11 Custom Tabs service visibility query exactly once', () => {
    const { ensureCustomTabsQuery } = require('../../plugins/withForumSearchCustomTab') as {
      ensureCustomTabsQuery: (manifest: Record<string, any>) => void;
    };
    const manifest = { manifest: {} };

    ensureCustomTabsQuery(manifest);
    ensureCustomTabsQuery(manifest);

    expect(manifest.manifest).toEqual({
      queries: [
        {
          intent: [
            {
              action: [{ $: { 'android:name': 'android.support.customtabs.action.CustomTabsService' } }]
            }
          ]
        }
      ]
    });
  });
});
