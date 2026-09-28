import { readFileSync } from 'node:fs';
import { XMLParser } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';

const native = (file: string) => readFileSync(`modules/forum-platform/android/${file}`, 'utf8');
const xml = (file: string) => new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' }).parse(native(file));

describe('forum platform Android packaging', () => {
  it('declares the Custom Tabs query and its direct AndroidX dependency in the library', () => {
    const manifest = xml('src/main/AndroidManifest.xml').manifest;
    expect(manifest.queries.intent.action).toEqual({
      'android:name': 'android.support.customtabs.action.CustomTabsService'
    });
    expect(native('build.gradle').match(/androidx\.browser:browser:1\.10\.0/g)).toHaveLength(1);
  });

  it('limits APK URI grants to the private cache and files roots with an application-specific authority', () => {
    const manifest = xml('src/main/AndroidManifest.xml').manifest;
    expect(manifest['uses-permission']).toEqual({ 'android:name': 'android.permission.REQUEST_INSTALL_PACKAGES' });
    expect(manifest.application.provider).toEqual({
      'android:name': 'androidx.core.content.FileProvider',
      'android:authorities': '${applicationId}.apk_installer_provider',
      'android:exported': 'false',
      'android:grantUriPermissions': 'true',
      'meta-data': {
        'android:name': 'android.support.FILE_PROVIDER_PATHS',
        'android:resource': '@xml/apk_installer_paths'
      }
    });
    expect(xml('src/main/res/xml/apk_installer_paths.xml').paths).toEqual({
      'xmlns:android': 'http://schemas.android.com/apk/res/android',
      'cache-path': { name: 'cache', path: '.' },
      'files-path': { name: 'files', path: '.' }
    });
  });

  it('keeps the Custom Tab handoff explicit and mutable for the current URL', () => {
    const source = native('src/main/java/com/wz/reader/navigation/ForumSearchCustomTabModule.kt');
    expect(source).toContain('addMenuItem("在阅坛中打开当前主题", pendingIntent)');
    expect(source).toContain('PendingIntent.FLAG_MUTABLE');
    expect(source).toContain('Intent().setClassName(reactContext, reactContext.packageName + ".MainActivity")');
    expect(source).toContain('CustomTabsClient.getPackageName(activity, null)');
    expect(source).toContain('customTab.intent.setPackage(provider)');
    expect(source).not.toContain('addCategory(Intent.CATEGORY_BROWSABLE)');
  });
});
