import { useCallback } from 'react';
import type { WebViewMessageEvent } from 'react-native-webview';
import { ACCESS_REQUIREMENT_NOTICE_PATTERN_SOURCE } from '../localHtml';

export const NODESEEK_BROWSER_FETCH_SCRIPT = `
(() => {
  const requestId = __NODESEEK_BROWSER_FETCH_ID__;
  const challengePattern = /just a moment|请稍候|正在进行安全验证|安全服务防护恶意自动程序|cf-turnstile|challenge-platform/i;
  const isChallengePage = () => {
    const challengeText = [document.title || "", document.documentElement?.innerHTML || ""].join(" ");
    return challengePattern.test(challengeText) || Boolean(document.querySelector(".cf-turnstile, [name='cf-turnstile-response'], script[src*='challenge-platform']"));
  };
  const pageText = () => (document.body?.innerText || document.documentElement?.innerText || document.body?.textContent || document.documentElement?.textContent || "").trim();
  const restrictedNoticePattern = new RegExp(${JSON.stringify(ACCESS_REQUIREMENT_NOTICE_PATTERN_SOURCE)}, "i");
  const hasRestrictedNotice = () => restrictedNoticePattern.test(pageText());
  const hasReadableContent = () => Boolean(document.querySelector(".post-list-item, .content-item .post-content, article.post-content, .post-detail .post-content, pre"))
    || /^\\s*[{[]/.test(pageText());
  const hasSearchPageContent = () => /\\/search\\/?$/i.test(location.pathname || "")
    && (Boolean(document.querySelector(".post-list-item"))
      || /没有找到|没有结果|暂无|未找到|no results|nothing found/i.test(pageText()));
  const hasPendingVotePanel = () => {
    const visibleMasks = Array.from(document.querySelectorAll(".embed-vote .form-mask")).some((element) => {
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") !== 0;
    });
    if (visibleMasks) {
      return true;
    }
    return Array.from(document.querySelectorAll('input[name="vote-item"]')).some((input) => {
      const inputId = input.getAttribute("id") || "";
      const label = inputId ? document.querySelector('label[for="' + inputId.replace(/"/g, '\\"') + '"]') : null;
      const labelText = (label?.querySelector(".vote-item-text")?.textContent || label?.textContent || "").trim();
      return !(input.getAttribute("value") || "").trim() || !labelText;
    });
  };
  const postResult = () => {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'nodeseek-browser-fetch',
      id: requestId,
      url: location.href,
      title: document.title || "",
      challenge: isChallengePage(),
      html: document.documentElement ? document.documentElement.outerHTML : "",
      userAgent: navigator.userAgent || "",
      cookie: document.cookie || ""
    }));
    try {
      window.stop();
    } catch {}
  };
  const deadline = Date.now() + 15000;
  const waitForReadablePage = () => {
    if ((!isChallengePage() && (hasReadableContent() || hasRestrictedNotice() || hasSearchPageContent()) && !hasPendingVotePanel()) || Date.now() >= deadline) {
      postResult();
      return;
    }
    setTimeout(waitForReadablePage, 500);
  };
  waitForReadablePage();
})();
true;
`;

export const LINUXDO_BROWSER_FETCH_SCRIPT = `
(() => {
  const requestId = __LINUXDO_BROWSER_FETCH_ID__;
  const challengePattern = /just a moment|checking your browser|cf-browser-verification|challenge-running|challenge-platform|cf-turnstile|cf_chl_|attention required|enable javascript and cookies|请稍候|正在检查/i;
  const pageText = () => (document.body?.innerText || document.documentElement?.innerText || "").trim();
  const pageHtml = () => document.documentElement ? document.documentElement.outerHTML : "";
  const isChallengePage = () => {
    const challengeText = [document.title || "", pageText(), pageHtml()].join(" ");
    return challengePattern.test(challengeText) || Boolean(document.querySelector(".cf-turnstile, [name='cf-turnstile-response'], script[src*='challenge-platform']"));
  };
  const isInteractiveChallengePage = () => {
    const challengeText = [document.title || "", pageText(), pageHtml()].join(" ");
    return Boolean(document.querySelector(".cf-turnstile, [name='cf-turnstile-response']"))
      || /cf-turnstile|attention required|verify you are human|请完成验证|正在进行安全验证/i.test(challengeText);
  };
  const jsonText = () => {
    const text = pageText();
    return /^\\s*[{[]/.test(text) ? text : "";
  };
  const postResult = () => {
    const json = jsonText();
    const challenge = isChallengePage() || isInteractiveChallengePage();
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'linuxdo-browser-fetch',
      id: requestId,
      url: location.href,
      title: document.title || "",
      challenge,
      body: json || pageHtml(),
      userAgent: navigator.userAgent || "",
      cookie: document.cookie || ""
    }));
  };
  const deadline = Date.now() + 8000;
  const waitForReadablePage = () => {
    if (isInteractiveChallengePage() || (!isChallengePage() && jsonText()) || Date.now() >= deadline) {
      postResult();
      return;
    }
    setTimeout(waitForReadablePage, 500);
  };
  waitForReadablePage();
})();
true;
`;

export function useHiddenBrowserFetchController({
  completeLinuxDoBrowserFetch,
  completeNodeSeekBrowserFetch
}: {
  completeLinuxDoBrowserFetch: (data: {
    type?: string;
    id?: number;
    url?: string;
    body?: string;
    cookie?: string;
    userAgent?: string;
    challenge?: boolean;
  }) => void;
  completeNodeSeekBrowserFetch: (data: {
    type?: string;
    id?: number;
    url?: string;
    html?: string;
    cookie?: string;
    userAgent?: string;
    challenge?: boolean;
  }) => void;
}) {
  const handleNodeSeekBrowserFetchMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as {
        type?: string;
        id?: number;
        url?: string;
        html?: string;
        cookie?: string;
        userAgent?: string;
        challenge?: boolean;
      };
      if (data.type === 'nodeseek-browser-fetch') {
        completeNodeSeekBrowserFetch(data);
      }
    } catch {
      // Ignore unrelated messages from the page.
    }
  }, [completeNodeSeekBrowserFetch]);

  const handleLinuxDoBrowserFetchMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as {
        type?: string;
        id?: number;
        url?: string;
        body?: string;
        cookie?: string;
        userAgent?: string;
        challenge?: boolean;
      };
      if (data.type === 'linuxdo-browser-fetch') {
        completeLinuxDoBrowserFetch(data);
      }
    } catch {
      // Ignore unrelated messages from the page.
    }
  }, [completeLinuxDoBrowserFetch]);

  return {
    handleLinuxDoBrowserFetchMessage,
    handleNodeSeekBrowserFetchMessage
  };
}
