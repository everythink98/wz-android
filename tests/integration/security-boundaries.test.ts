import { describe, expect, it } from 'vitest';
import { exportReaderBackupJson, importReaderBackupJson } from '@/domain/reader/readerBackup';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { isGoogleSiteSearchAccessTroubleUrl } from '@/sources/searchFallback';
import { isYaohuoRequestUrl, requireYaohuoRequestUrl } from '@/sources/yaohuo/protocol';
import {
  isLinuxDoBrowserFetchUrl,
  isLinuxDoBrowserNavigationUrl,
  isLinuxDoBrowserResultUrl,
  isLinuxDoRequestUrl
} from '@/sources/linuxdo/browserFallback';
import {
  isNodeSeekBrowserFetchUrl,
  isNodeSeekBrowserNavigationUrl,
  isNodeSeekBrowserResultUrl,
  isNodeSeekRequestUrl
} from '@/sources/nodeseek/browserFallback';

const fakeSecret = 'fixed-fake-secret-do-not-leak';

describe('Android App security review guards', () => {
  it('allows authenticated source requests only over HTTPS on expected hosts', () => {
    expect(isNodeSeekRequestUrl('https://www.nodeseek.com/search?q=test')).toBe(true);
    expect(isNodeSeekRequestUrl('http://www.nodeseek.com/search?q=test')).toBe(false);
    expect(isNodeSeekRequestUrl('https://www.nodeseek.com.evil.example/search')).toBe(false);
    expect(isNodeSeekRequestUrl('https://evil.example@www.nodeseek.com/search')).toBe(false);
    expect(isNodeSeekRequestUrl('https://www.nodeseek.com@evil.example/search')).toBe(false);
    expect(isNodeSeekBrowserFetchUrl('https://www.google.com/search?q=site%3Anodeseek.com+codex')).toBe(true);
    expect(isNodeSeekBrowserFetchUrl('https://www.google.com/search?q=site%3Anodeseek.com.evil+codex')).toBe(false);
    expect(isNodeSeekBrowserFetchUrl('https://www.google.com/search?q=codex')).toBe(false);
    expect(isNodeSeekBrowserFetchUrl('https://example.com/search?q=site%3Anodeseek.com+codex')).toBe(false);
    expect(isNodeSeekBrowserFetchUrl('https://evil.google.com/search?q=site%3Anodeseek.com+codex')).toBe(false);
    expect(isNodeSeekBrowserFetchUrl('https://www.google.com/search?q=site%3Anodeseek.com+site%3Alinux.do+codex')).toBe(
      false
    );
    expect(
      isNodeSeekBrowserFetchUrl(
        'https://www.google.com/search?q=site%3Anodeseek.com+codex&next=https%3A%2F%2Fevil.example'
      )
    ).toBe(false);
    expect(isNodeSeekBrowserFetchUrl('https://@www.google.com/search?q=site%3Anodeseek.com+codex')).toBe(false);
    expect(isNodeSeekBrowserFetchUrl(' https://www.google.com/search?q=site%3Anodeseek.com+codex')).toBe(false);
    const nodeSeekGoogleSearch = 'https://www.google.com/search?q=site%3Anodeseek.com+codex';
    const googleJavaScriptGate = 'https://www.google.com/httpservice/retry/enablejs?sei=Abc_123-xy';
    const nodeSeekGoogleAccessTrouble =
      'https://www.google.com/search?q=site%3Anodeseek.com+codex&sca_esv=Abc_123&emsg=SG_REL&sei=Abc_123-xy';
    expect(isNodeSeekBrowserFetchUrl(googleJavaScriptGate)).toBe(false);
    expect(isNodeSeekBrowserNavigationUrl(googleJavaScriptGate, nodeSeekGoogleSearch)).toBe(true);
    expect(isNodeSeekBrowserNavigationUrl(nodeSeekGoogleSearch, nodeSeekGoogleSearch)).toBe(true);
    expect(isGoogleSiteSearchAccessTroubleUrl(nodeSeekGoogleAccessTrouble, 'nodeseek.com', nodeSeekGoogleSearch)).toBe(
      true
    );
    expect(isNodeSeekBrowserNavigationUrl(nodeSeekGoogleAccessTrouble, nodeSeekGoogleSearch)).toBe(false);
    expect(isNodeSeekBrowserResultUrl(nodeSeekGoogleAccessTrouble, nodeSeekGoogleSearch)).toBe(false);
    expect(
      isGoogleSiteSearchAccessTroubleUrl(
        `${nodeSeekGoogleAccessTrouble}&next=https%3A%2F%2Fevil.example`,
        'nodeseek.com',
        nodeSeekGoogleSearch
      )
    ).toBe(false);
    expect(
      isGoogleSiteSearchAccessTroubleUrl(
        nodeSeekGoogleAccessTrouble.replace('emsg=SG_REL', 'emsg=OTHER'),
        'nodeseek.com',
        nodeSeekGoogleSearch
      )
    ).toBe(false);
    expect(
      isGoogleSiteSearchAccessTroubleUrl(
        nodeSeekGoogleAccessTrouble.replace('codex', 'different'),
        'nodeseek.com',
        nodeSeekGoogleSearch
      )
    ).toBe(false);
    const nodeSeekGooglePageTwo = `${nodeSeekGoogleSearch}&start=10`;
    expect(
      isGoogleSiteSearchAccessTroubleUrl(
        `${nodeSeekGooglePageTwo}&sca_esv=Abc_123&emsg=SG_REL&sei=Abc_123-xy`,
        'nodeseek.com',
        nodeSeekGooglePageTwo
      )
    ).toBe(true);
    expect(isGoogleSiteSearchAccessTroubleUrl(nodeSeekGoogleAccessTrouble, 'nodeseek.com', nodeSeekGooglePageTwo)).toBe(
      false
    );
    expect(
      isNodeSeekBrowserNavigationUrl(
        'https://www.google.com/search?q=site%3Anodeseek.com+different',
        nodeSeekGoogleSearch
      )
    ).toBe(false);
    expect(isNodeSeekBrowserNavigationUrl('https://www.nodeseek.com/search?q=codex', nodeSeekGoogleSearch)).toBe(false);
    expect(isNodeSeekBrowserNavigationUrl(nodeSeekGoogleSearch, 'https://www.nodeseek.com/search?q=codex')).toBe(false);
    expect(isNodeSeekBrowserResultUrl(nodeSeekGoogleSearch, nodeSeekGoogleSearch)).toBe(true);
    expect(isNodeSeekBrowserResultUrl('https://www.nodeseek.com/search?q=codex', nodeSeekGoogleSearch)).toBe(false);
    expect(isNodeSeekBrowserResultUrl(nodeSeekGoogleSearch, 'https://www.nodeseek.com/search?q=codex')).toBe(false);
    expect(isNodeSeekBrowserResultUrl(googleJavaScriptGate, nodeSeekGoogleSearch)).toBe(false);
    expect(
      isNodeSeekBrowserNavigationUrl(googleJavaScriptGate, 'https://www.google.com/search?q=site%3Alinux.do+codex')
    ).toBe(false);
    expect(
      isNodeSeekBrowserNavigationUrl(
        'https://www.google.com/httpservice/retry/enablejs?sei=Abc_123-xy&next=https%3A%2F%2Fevil.example',
        nodeSeekGoogleSearch
      )
    ).toBe(false);
    expect(
      isNodeSeekBrowserNavigationUrl(
        'https://www.google.com:444/httpservice/retry/enablejs?sei=Abc_123-xy',
        nodeSeekGoogleSearch
      )
    ).toBe(false);
    expect(
      isNodeSeekBrowserNavigationUrl(
        'https://www.google.com/httpservice/retry/enablejs?sei=Abc_123-xy#done',
        nodeSeekGoogleSearch
      )
    ).toBe(false);
    expect(isLinuxDoRequestUrl('https://linux.do/search?q=test')).toBe(true);
    expect(isLinuxDoBrowserFetchUrl('https://www.google.com/search?q=site%3Alinux.do+codex')).toBe(true);
    expect(isLinuxDoBrowserFetchUrl('https://www.google.com/search?q=site%3Alinux.do.evil+codex')).toBe(false);
    expect(isLinuxDoBrowserFetchUrl('https://www.google.com/search?q=codex')).toBe(false);
    expect(isLinuxDoBrowserFetchUrl('https://example.com/search?q=site%3Alinux.do+codex')).toBe(false);
    const linuxDoGoogleSearch = 'https://www.google.com/search?q=site%3Alinux.do+codex';
    const linuxDoGoogleAccessTrouble =
      'https://www.google.com/search?q=site%3Alinux.do+codex&sca_esv=Abc_123&emsg=SG_REL&sei=Abc_123-xy';
    expect(isLinuxDoBrowserFetchUrl(googleJavaScriptGate)).toBe(false);
    expect(isLinuxDoBrowserNavigationUrl(googleJavaScriptGate, linuxDoGoogleSearch)).toBe(true);
    expect(isGoogleSiteSearchAccessTroubleUrl(linuxDoGoogleAccessTrouble, 'linux.do', linuxDoGoogleSearch)).toBe(true);
    expect(isLinuxDoBrowserNavigationUrl('https://linux.do/search?q=codex', linuxDoGoogleSearch)).toBe(false);
    expect(isLinuxDoBrowserNavigationUrl(linuxDoGoogleSearch, 'https://linux.do/search?q=codex')).toBe(false);
    expect(isLinuxDoBrowserResultUrl(linuxDoGoogleSearch, linuxDoGoogleSearch)).toBe(true);
    expect(isLinuxDoBrowserResultUrl('https://linux.do/search?q=codex', linuxDoGoogleSearch)).toBe(false);
    expect(isLinuxDoBrowserResultUrl(linuxDoGoogleSearch, 'https://linux.do/search?q=codex')).toBe(false);
    expect(isLinuxDoBrowserResultUrl(googleJavaScriptGate, linuxDoGoogleSearch)).toBe(false);
    expect(isLinuxDoBrowserNavigationUrl(googleJavaScriptGate, nodeSeekGoogleSearch)).toBe(false);

    expect(isYaohuoRequestUrl('https://yaohuo.me/bbs/book_view.aspx?id=1')).toBe(false);
    expect(isYaohuoRequestUrl('https://www.yaohuo.me/bbs/book_view.aspx?id=1')).toBe(true);
    expect(requireYaohuoRequestUrl('https://www.yaohuo.me/bbs/book_view.aspx?id=1')).toBe(
      'https://www.yaohuo.me/bbs/book_view.aspx?id=1'
    );
    expect(isYaohuoRequestUrl('http://yaohuo.me/bbs/book_view.aspx?id=1')).toBe(false);
    expect(isYaohuoRequestUrl('https://yaohuo.me.evil.example/bbs/book_view.aspx?id=1')).toBe(false);
    expect(isYaohuoRequestUrl('https://evil.example@yaohuo.me/bbs/book_view.aspx?id=1')).toBe(false);
  });

  it('removes sensitive keys and URL parameters from Android backup JSON', () => {
    const exported = exportReaderBackupJson({
      version: 2,
      favorites: {
        one: {
          savedAt: '2026-06-06T00:00:00.000Z',
          topic: {
            source: 'nodeseek',
            id: '1',
            title: '安全测试',
            url: `https://www.nodeseek.com/post-1-1?token=${fakeSecret}&authToken=${fakeSecret}&sessionId=${fakeSecret}&csrfToken=${fakeSecret}&access-token=${fakeSecret}&connect.sid=${fakeSecret}&ok=1`,
            createdAt: '2026-06-06T00:00:00.000Z',
            cookie: fakeSecret,
            session: fakeSecret,
            csrf: fakeSecret
          }
        }
      },
      history: {},
      followedUsers: {},
      deletedRecords: {
        favorites: {},
        history: {},
        followedUsers: {}
      },
      settings: {},
      token: fakeSecret,
      password: fakeSecret,
      sid: fakeSecret,
      sidyaohuo: fakeSecret,
      csrf: fakeSecret
    });

    expect(exported).not.toContain(fakeSecret);
    expect(exported).not.toContain('token');
    expect(exported).not.toContain('authToken');
    expect(exported).not.toContain('sessionId');
    expect(exported).not.toContain('csrfToken');
    expect(exported).not.toContain('access-token');
    expect(exported).not.toContain('connect.sid');
    expect(exported).not.toContain('password');
    expect(exported).not.toContain('sidyaohuo');
    expect(exported).toContain('https://www.nodeseek.com/post-1-1');
  });

  it('does not export server proxy settings in Android backup JSON', () => {
    const exported = exportReaderBackupJson({
      ...createEmptyReaderData(),
      networkProxy: {
        enabled: true,
        activeId: 'tg',
        profiles: [
          {
            id: 'tg',
            name: 'TG',
            protocol: 'socks5',
            host: 'proxy.example.com',
            port: 1080,
            username: 'demo-user',
            password: fakeSecret
          }
        ]
      },
      'network-proxy-settings': fakeSecret
    });

    expect(exported).not.toContain('networkProxy');
    expect(exported).not.toContain('network-proxy-settings');
    expect(exported).not.toContain('proxy.example.com');
    expect(exported).not.toContain('1080');
    expect(exported).not.toContain('demo-user');
    expect(exported).not.toContain(fakeSecret);
  });

  it('does not import sensitive fields from Android backup JSON', () => {
    const merged = importReaderBackupJson(
      createEmptyReaderData(),
      JSON.stringify({
        version: 2,
        favorites: {
          one: {
            savedAt: '2026-06-06T00:00:00.000Z',
            topic: {
              source: 'linuxdo',
              id: '1',
              title: '导入安全测试',
              url: `https://linux.do/t/slug/1?session=${fakeSecret}&safe=1`,
              createdAt: '2026-06-06T00:00:00.000Z',
              authorization: fakeSecret
            }
          }
        },
        history: {},
        followedUsers: {},
        deletedRecords: {
          favorites: {},
          history: {},
          followedUsers: {}
        },
        settings: {},
        secret: fakeSecret
      })
    );

    const imported = JSON.stringify(merged);

    expect(imported).not.toContain(fakeSecret);
    expect(imported).not.toContain('authorization');
    expect(imported).not.toContain('session=');
    expect(imported).toContain('https://linux.do/t/1');
  });
});
