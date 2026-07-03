import { useCallback } from 'react';
import type { WebViewMessageEvent } from 'react-native-webview';
import { ACCESS_REQUIREMENT_NOTICE_PATTERN_SOURCE } from '../localHtml';

export const NODESEEK_BROWSER_FETCH_SCRIPT = `
(() => {
  const requestId = __NODESEEK_BROWSER_FETCH_ID__;
  const bridgeMessageLimit = 900000;
  const challengePattern = /just a moment|请稍候|正在进行安全验证|安全服务防护恶意自动程序|cf-turnstile|challenge-platform/i;
  const pageText = (limit = 12000) => (document.body?.innerText || document.documentElement?.innerText || document.body?.textContent || document.documentElement?.textContent || "").trim().slice(0, limit);
  const jsonText = () => {
    const text = pageText();
    return /^\\s*[{[]/.test(text) ? text : "";
  };
  const isChallengePage = () => {
    const challengeText = [document.title || "", pageText(3000)].join(" ");
    return challengePattern.test(challengeText) || Boolean(document.querySelector(".cf-turnstile, [name='cf-turnstile-response'], script[src*='challenge-platform']"));
  };
  const isInteractiveChallengePage = () => {
    const challengeText = [document.title || "", pageText(3000)].join(" ");
    return Boolean(document.querySelector(".cf-turnstile, [name='cf-turnstile-response']"))
      || /cf-turnstile|attention required|verify you are human|请完成验证|正在进行安全验证/i.test(challengeText);
  };
  const restrictedNoticePattern = new RegExp(${JSON.stringify(ACCESS_REQUIREMENT_NOTICE_PATTERN_SOURCE)}, "i");
  const hasRestrictedNotice = () => restrictedNoticePattern.test(pageText());
  const isNodeSeekSearchPage = () => !/(^|\\.)google\\./i.test(location.hostname || "") && /\\/search\\/?$/i.test(location.pathname || "");
  const hasReadableContent = () => Boolean(document.querySelector(".post-list-item, .content-item .post-content, article.post-content, .post-detail .post-content, pre"))
    || /^\\s*[{[]/.test(pageText());
  const hasSearchPageContent = () => isNodeSeekSearchPage()
    && (Boolean(document.querySelector(".post-list-item"))
      || /没有找到|没有结果|暂无|未找到|no results|nothing found/i.test(pageText()));
  const hasNodeSeekSearchResultLinks = () => /\\/search\\/?$/i.test(location.pathname || "")
    && Array.from(document.querySelectorAll('a[href*="post-"]')).some((link) => /nodeseek\\.com|post-\\d+-\\d+/i.test(link.href || ""));
  const isNodeSeekPostPage = () => /\\/post-\\d+-\\d+\\/?$/i.test(location.pathname || "");
  const base64Json = (value) => {
    const json = JSON.stringify(value);
    if (typeof TextEncoder === "function") {
      const bytes = new TextEncoder().encode(json);
      let binary = "";
      for (let index = 0; index < bytes.length; index += 8192) {
        binary += String.fromCharCode(...bytes.slice(index, index + 8192));
      }
      return btoa(binary);
    }
    return btoa(unescape(encodeURIComponent(json)));
  };
  const windowConfigPostDataHtml = () => {
    const config = window.__config__;
    if (!config || typeof config !== "object" || !config.postData) {
      return "";
    }
    const clonePostData = (value) => {
      try {
        return JSON.parse(JSON.stringify(value));
      } catch {
        return value;
      }
    };
    const childMarkup = (element) => Array.from(element?.childNodes || []).map((node) => {
      if (node.nodeType === 3) {
        return node.textContent || "";
      }
      return node.outerHTML || node.textContent || "";
    }).join("").trim();
    const renderedRows = () => Array.from(document.querySelectorAll(".content-item, .comment-item, .comment-list > li, .comments > li, [id^='comment-']")).map((row) => {
      const content = row.querySelector(".post-content, .comment-content, .reply-content, .content");
      if (!content) {
        return null;
      }
      const rowId = row.getAttribute("data-comment-id") || (String(row.id || "").match(/comment[-_]?(\\d+)/i) || [])[1] || "";
      const floorText = row.getAttribute("id") || row.querySelector(".floor-link, .floor, .no")?.textContent || "";
      const floorIndex = Number((String(floorText).match(/#?(\\d+)/) || [])[1] || 0);
      const signature = row.querySelector(".signature, .post-signature, .content-signature");
      return {
        commentId: String(rowId).trim(),
        floorIndex,
        content: childMarkup(content),
        signature: signature ? childMarkup(signature) : ""
      };
    }).filter(Boolean);
    const renderedRowForComment = (rows, comment, index) => {
      const commentId = String(comment?.commentId || "").trim();
      const floorIndex = Number(comment?.floorIndex || comment?.floor || 0);
      return (commentId && rows.find((row) => row.commentId === commentId))
        || (floorIndex && rows.find((row) => row.floorIndex === floorIndex))
        || rows[index];
    };
    const postData = clonePostData(config.postData);
    if (postData && typeof postData === "object" && Array.isArray(postData.comments)) {
      const rows = renderedRows();
      postData.comments.forEach((comment, index) => {
        if (!comment || typeof comment !== "object") {
          return;
        }
        const row = renderedRowForComment(rows, comment, index);
        if (row?.content) {
          comment.content = row.content;
        }
        if (row?.signature && !comment.signature) {
          comment.signature = row.signature;
        }
      });
    }
    const payload = {
      postData
    };
    if (config.user) {
      payload.user = config.user;
    }
    if (config.allCategory) {
      payload.allCategory = config.allCategory;
    }
    return '<html><body><script id="temp-script" type="application/json">' + base64Json(payload) + "</script></body></html>";
  };
  const embeddedPostDataHtml = () => {
    if (!isNodeSeekPostPage()) {
      return "";
    }
    const script = document.querySelector("#temp-script");
    if (script && (script.textContent || "").trim()) {
      return "<html><body>" + script.outerHTML + "</body></html>";
    }
    return windowConfigPostDataHtml();
  };
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
  const postBridgeMessage = (payload) => {
    const message = JSON.stringify(payload);
    if (message.length <= bridgeMessageLimit) {
      window.ReactNativeWebView.postMessage(message);
      return;
    }
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'nodeseek-browser-fetch',
      id: requestId,
      url: location.href,
      title: document.title || "",
      challenge: true,
      error: 'NodeSeek 页面内容过大，已停止读取',
      userAgent: navigator.userAgent || "",
      cookie: document.cookie || ""
    }));
  };
  const postError = (error) => {
    postBridgeMessage({
      type: 'nodeseek-browser-fetch',
      id: requestId,
      url: location.href,
      title: document.title || "",
      challenge: isChallengePage(),
      error,
      userAgent: navigator.userAgent || "",
      cookie: document.cookie || ""
    });
    try {
      window.stop();
    } catch {}
  };
  const postResult = () => {
    const challenge = isChallengePage();
    const json = jsonText();
    const compactHtml = challenge ? "" : embeddedPostDataHtml();
    postBridgeMessage({
      type: 'nodeseek-browser-fetch',
      id: requestId,
      url: location.href,
      title: document.title || "",
      challenge,
      html: challenge ? "" : (json || compactHtml || (document.documentElement ? document.documentElement.outerHTML : "")),
      userAgent: navigator.userAgent || "",
      cookie: document.cookie || ""
    });
    try {
      window.stop();
    } catch {}
  };
  const deadline = Date.now() + 15000;
  const waitForReadablePage = () => {
    if (isInteractiveChallengePage()) {
      postResult();
      return;
    }
    if (!isChallengePage() && jsonText()) {
      postResult();
      return;
    }
    if (!isChallengePage() && embeddedPostDataHtml()) {
      postResult();
      return;
    }
    if (!isChallengePage() && (hasReadableContent() || hasRestrictedNotice() || hasSearchPageContent() || hasNodeSeekSearchResultLinks()) && !hasPendingVotePanel()) {
      postResult();
      return;
    }
    if (Date.now() >= deadline) {
      if (!isChallengePage() && isNodeSeekSearchPage() && !hasSearchPageContent() && !hasNodeSeekSearchResultLinks()) {
        postError('NodeSeek 搜索页结果没有加载完成，请重试');
        return;
      }
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
  const bridgeMessageLimit = 900000;
  const challengePattern = /just a moment|checking your browser|cf-browser-verification|challenge-running|challenge-platform|cf-turnstile|cf_chl_|attention required|enable javascript and cookies|请稍候|正在检查/i;
  const pageText = (limit = 12000) => (document.body?.innerText || document.documentElement?.innerText || "").trim().slice(0, limit);
  const pageHtml = () => document.documentElement ? document.documentElement.outerHTML : "";
  const isChallengePage = () => {
    const challengeText = [document.title || "", pageText(3000)].join(" ");
    return challengePattern.test(challengeText) || Boolean(document.querySelector(".cf-turnstile, [name='cf-turnstile-response'], script[src*='challenge-platform']"));
  };
  const isInteractiveChallengePage = () => {
    const challengeText = [document.title || "", pageText(3000)].join(" ");
    return Boolean(document.querySelector(".cf-turnstile, [name='cf-turnstile-response']"))
      || /cf-turnstile|attention required|verify you are human|请完成验证|正在进行安全验证/i.test(challengeText);
  };
  const jsonText = () => {
    const text = pageText();
    return /^\\s*[{[]/.test(text) ? text : "";
  };
  const isGoogleSearchPage = () => /\\/search\\/?$/i.test(location.pathname || "")
    && (/(^|\\.)google\\./i.test(location.hostname || "") || /site(?::|%3A)linux\\.do/i.test(location.href || ""));
  const hasLinuxDoSearchResultLinks = () => isGoogleSearchPage()
    && Array.from(document.querySelectorAll('a[href]')).some((link) => {
      const href = link.href || "";
      try {
        return /(^https?:\\/\\/([^/]+\\.)?linux\\.do\\/t\\/)|(^\\/t\\/)|linux\\.do\\/t\\//i.test(decodeURIComponent(href));
      } catch {
        return /linux\\.do\\/t\\//i.test(href);
      }
    });
  const postBridgeMessage = (payload) => {
    const message = JSON.stringify(payload);
    if (message.length <= bridgeMessageLimit) {
      window.ReactNativeWebView.postMessage(message);
      return;
    }
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'linuxdo-browser-fetch',
      id: requestId,
      url: location.href,
      title: document.title || "",
      challenge: true,
      error: 'linux.do 页面内容过大，已停止读取',
      userAgent: navigator.userAgent || "",
      cookie: document.cookie || ""
    }));
  };
  const postResult = () => {
    const json = jsonText();
    const challenge = isChallengePage() || isInteractiveChallengePage();
    postBridgeMessage({
      type: 'linuxdo-browser-fetch',
      id: requestId,
      url: location.href,
      title: document.title || "",
      challenge,
      body: challenge ? "" : (json || pageHtml()),
      userAgent: navigator.userAgent || "",
      cookie: document.cookie || ""
    });
  };
  const deadline = Date.now() + 8000;
  const waitForReadablePage = () => {
    if (isInteractiveChallengePage() || (!isChallengePage() && (jsonText() || hasLinuxDoSearchResultLinks())) || Date.now() >= deadline) {
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
    error?: string;
    httpErrorStatus?: number;
  }) => void;
  completeNodeSeekBrowserFetch: (data: {
    type?: string;
    id?: number;
    url?: string;
    html?: string;
    cookie?: string;
    userAgent?: string;
    challenge?: boolean;
    error?: string;
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
        error?: string;
        httpErrorStatus?: number;
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
        error?: string;
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
