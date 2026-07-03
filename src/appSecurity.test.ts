import { describe, expect, it } from 'vitest';
import { exportReaderBackupJson, importReaderBackupJson } from './readerBackup';
import { createEmptyReaderData } from './readerData';
import { isYaohuoRequestUrl, requireYaohuoRequestUrl } from './localYaohuoHelpers';
import { isLinuxDoBrowserFetchUrl, isLinuxDoRequestUrl } from './linuxdoFetchFallback';
import { isNodeSeekBrowserFetchUrl, isNodeSeekRequestUrl } from './nodeseekFetchFallback';

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
    expect(isLinuxDoRequestUrl('https://linux.do/search?q=test')).toBe(true);
    expect(isLinuxDoBrowserFetchUrl('https://www.google.com/search?q=site%3Alinux.do+codex')).toBe(true);
    expect(isLinuxDoBrowserFetchUrl('https://www.google.com/search?q=site%3Alinux.do.evil+codex')).toBe(false);
    expect(isLinuxDoBrowserFetchUrl('https://www.google.com/search?q=codex')).toBe(false);
    expect(isLinuxDoBrowserFetchUrl('https://example.com/search?q=site%3Alinux.do+codex')).toBe(false);

    expect(isYaohuoRequestUrl('https://yaohuo.me/bbs/book_view.aspx?id=1')).toBe(true);
    expect(isYaohuoRequestUrl('https://www.yaohuo.me/bbs/book_view.aspx?id=1')).toBe(true);
    expect(requireYaohuoRequestUrl('https://www.yaohuo.me/bbs/book_view.aspx?id=1')).toBe('https://yaohuo.me/bbs/book_view.aspx?id=1');
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
    expect(exported).toContain('ok=1');
  });

  it('does not import sensitive fields from Android backup JSON', () => {
    const merged = importReaderBackupJson(createEmptyReaderData(), JSON.stringify({
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
    }));

    const imported = JSON.stringify(merged);

    expect(imported).not.toContain(fakeSecret);
    expect(imported).not.toContain('authorization');
    expect(imported).not.toContain('session=');
    expect(imported).toContain('safe=1');
  });
});
