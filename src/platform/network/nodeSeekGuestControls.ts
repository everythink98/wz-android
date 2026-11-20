const navigation = ':is(header, nav, .header, .navbar, .topbar, [role="banner"], [role="navigation"]) a[href]';
const navigationLinks = `${navigation}, body > a.btn[href], :scope > a.btn[href]`;
const accountPageLinks = `${navigationLinks}, a.btn[href], form a[href]`;
const excluded =
  'article, [role="article"], blockquote, pre, code, .post-list-item, .post-content, .content-item, template, noscript, [hidden], [inert], [aria-hidden="true" i]';
const origin = String.raw`(?:https:\/\/(?:[\w-]+\.)*nodeseek\.com(?::443)?)?`;
const loginPath = String.raw`(?:login|signin|sign-in)(?:\.html?)?\/?`;
const registerPath = String.raw`(?:register|signup|sign-up)(?:\.html?)?\/?`;
const suffix = String.raw`(?:[?#][^\n]*)?`;
const accountPage = new RegExp(`^${origin}/(?:${loginPath}|${registerPath})${suffix}$`, 'i');
const login = new RegExp(`^${origin}/${loginPath}${suffix}\n(?:登录|sign in|log in)$`, 'i');
const register = new RegExp(`^${origin}/${registerPath}${suffix}\n(?:注册|sign up|register)$`, 'i');

export const nodeSeekGuestControls = { accountPage, accountPageLinks, excluded, login, navigationLinks, register };

// The native HTML parser shares the selectors and exact link/label pairs with both WebViews.
export const NODESEEK_BROWSER_GUEST_CONTROLS = String.raw`
  const hasVisibleNodeSeekGuestControls = () => {
    const selector = ${accountPage}.test(location.pathname) ? ${JSON.stringify(accountPageLinks)} : ${JSON.stringify(navigationLinks)};
    let login = false;
    let register = false;
    for (const link of document.querySelectorAll(selector)) {
      const href = link.getAttribute('href')?.trim();
      if (!href) continue;
      let target;
      try { target = new URL(href, location.href).href; } catch { continue; }
      const key = target + '\n' + String(link.textContent || '').trim();
      const loginLink = ${login}.test(key);
      const registerLink = ${register}.test(key);
      if ((!loginLink && !registerLink) || link.closest(${JSON.stringify(excluded)})) continue;
      let node = link;
      while (node) {
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
          || (style.opacity !== '' && Number(style.opacity) === 0)) break;
        node = node.parentElement;
      }
      if (node) continue;
      login ||= loginLink;
      register ||= registerLink;
      if (login && register) return true;
    }
    return false;
  };`;
