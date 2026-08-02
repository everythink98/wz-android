import type { HTMLElement } from 'node-html-parser';
import type { UserProfile } from '@/domain/forum/models';
import { elementText, parseHtml, textContentFromHtml } from '@/domain/forum/html';
import {
  YAOHUO_BASE_URL as BASE_URL,
  YAOHUO_LOGIN_URL,
  extractYaohuoUserIdFromHref as extractUserIdFromHref,
  yaohuoUserUrl as userUrl
} from './protocol';
import { safeYaohuoCurrentUserName } from './normalization';

function hasYaohuoContentSurface(html: string) {
  return (
    /class=["'][^"']*\b(?:bbscontent|listdata|line1|line2)\b/i.test(html) ||
    /href=["'][^"']*(?:\/bbs-|book_view)/i.test(html)
  );
}

export function isYaohuoLoginFormHtml(html: string, responseUrl = '') {
  try {
    const expected = new URL(YAOHUO_LOGIN_URL);
    const actual = new URL(responseUrl);
    if (
      actual.username ||
      actual.password ||
      actual.origin !== expected.origin ||
      actual.pathname !== expected.pathname ||
      actual.search !== expected.search
    ) {
      return false;
    }
  } catch {
    return false;
  }
  const form = parseHtml(html).querySelector('form[name="login"]');
  return (
    String(form?.getAttribute('method') || '').toLowerCase() === 'post' &&
    Boolean(form?.querySelector('#logname[name="logname"]')) &&
    Boolean(form?.querySelector('#password[name="logpass"]'))
  );
}

export function isYaohuoLoginRequiredHtml(html: string, responseUrl = '') {
  const visibleText = textContentFromHtml(html);
  return (
    isYaohuoLoginFormHtml(html, responseUrl) ||
    isYaohuoVerificationRequiredHtml(html) ||
    (!hasYaohuoContentSurface(html) &&
      (/身份失效了，请重新登录网站|请先登录网站/.test(html) || /请先\s+登录/.test(visibleText)))
  );
}

export function isYaohuoVerificationRequiredHtml(html: string) {
  return (
    /<title\b[^>]*>[^<]*(?:访问验证|请开启JavaScript并刷新该页)[^<]*<\/title>/i.test(html) ||
    /<script\b[^>]*(?:ImageCaptcha|Gocaptcha|CAPTCHA_CONFIG)[^>]*>/i.test(html) ||
    /<script\b[^>]*>[\s\S]*?(?:ImageCaptcha|Gocaptcha|CAPTCHA_CONFIG)[\s\S]*?<\/script>/i.test(html) ||
    /<(?:form|input|img|iframe|div)\b[^>]*(?:id|class|name|src)=["'][^"']*(?:captcha|Gocaptcha|ImageCaptcha)[^"']*["'][^>]*>/i.test(
      html
    )
  );
}

export function yaohuoLoginRequirementReason(html: string, responseUrl = '') {
  if (!isYaohuoLoginRequiredHtml(html, responseUrl)) {
    return undefined;
  }
  return isYaohuoLoginFormHtml(html, responseUrl) || !isYaohuoVerificationRequiredHtml(html)
    ? ('expired' as const)
    : ('verification' as const);
}

function loginRequiredError(reason = 'expired') {
  const error = new Error(
    reason === 'missing_cookie'
      ? '请先登录妖火'
      : reason === 'verification'
        ? '妖火需要完成访问验证，请在登录页完成验证后重试'
        : '妖火登录已失效，请重新登录'
  );
  Object.assign(error, {
    source: 'yaohuo',
    loginRequired: true,
    reason,
    loginUrl: YAOHUO_LOGIN_URL
  });
  return error;
}

export function ensureYaohuoHtmlLoggedIn(html: string, responseUrl = '') {
  const reason = yaohuoLoginRequirementReason(html, responseUrl);
  if (reason) {
    throw loginRequiredError(reason);
  }
}

function hasYaohuoSelfAccountNavigation(contextNode: HTMLElement) {
  const links = contextNode.querySelectorAll('a[href]').map((link) => {
    const href = link.getAttribute('href') || '';
    try {
      return {
        path: new URL(href.replace(/&amp;/gi, '&'), BASE_URL).pathname.toLowerCase(),
        text: elementText(link),
        userId: extractUserIdFromHref(href)
      };
    } catch {
      return { path: '', text: elementText(link), userId: undefined };
    }
  });
  const fixedDestinations = [
    ['/myfile.aspx', '我的地盘'],
    ['/bbs/book_list_search.aspx', '帖子'],
    ['/bbs/messagelist.aspx', '信箱']
  ];
  const hasFixedDestinations = fixedDestinations.every(([path, text]) =>
    links.some((link) => link.path === path && link.text === text)
  );
  const hasSelfProfile = links.some(
    (link) =>
      link.path === '/bbs/userinfo.aspx' &&
      Boolean(link.userId) &&
      (link.text === '空间' || Boolean(safeYaohuoCurrentUserName(link.text)))
  );
  return hasFixedDestinations && hasSelfProfile;
}

export function parseYaohuoCurrentUserHtml(html: string, url?: string): UserProfile | null {
  if (isYaohuoLoginRequiredHtml(html, url)) {
    return null;
  }
  const root = parseHtml(html);
  const accountContainers = root.querySelectorAll('div.top2').filter(hasYaohuoSelfAccountNavigation);
  for (const contextNode of accountContainers) {
    const link = contextNode
      .querySelectorAll('a[href*="userinfo"], a[href*="touserid"]')
      .find((candidate) => Boolean(extractUserIdFromHref(candidate.getAttribute('href'))));
    const id = extractUserIdFromHref(link?.getAttribute('href'));
    const linkUsername = safeYaohuoCurrentUserName(link ? elementText(link) : '');
    const username = linkUsername || id;
    if (!id || !username) {
      continue;
    }
    return {
      source: 'yaohuo',
      id,
      username,
      displayName: username,
      url: userUrl(id),
      topics: []
    };
  }
  return null;
}

export function checkYaohuoLoginHtml(html: string, url?: string) {
  const loginReason = yaohuoLoginRequirementReason(html, url);
  const loginRequired = Boolean(loginReason);
  const currentUser = loginRequired ? null : parseYaohuoCurrentUserHtml(html, url);
  const reason = loginReason || (currentUser ? undefined : 'unknown');
  return {
    source: 'yaohuo' as const,
    ok: Boolean(currentUser),
    loginRequired,
    reason,
    ...(currentUser ? { currentUser } : {}),
    loginUrl: YAOHUO_LOGIN_URL,
    message: loginRequired
      ? loginReason === 'verification'
        ? '妖火需要完成访问验证，请在登录页完成验证后重试'
        : '妖火登录已失效，请重新登录。'
      : currentUser
        ? undefined
        : '妖火登录状态暂时无法确认。'
  };
}
