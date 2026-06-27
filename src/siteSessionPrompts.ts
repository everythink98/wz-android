import type { FeedSource, Source } from './types';
import type { SiteSessionViewModels } from './siteSessionState';

export type AuthPromptSurface = 'search' | 'read' | 'action';
export type AuthNoticeTone = 'neutral' | 'warning' | 'danger';
export type AuthNotice = {
  message: string;
  tone: AuthNoticeTone;
};
export type SearchSessionNoticeItem = {
  source: Source;
  label: string;
  notice: AuthNotice;
};
export type SearchSessionNoticeLightTone = AuthNoticeTone | 'success';

const searchSessionSources: Array<{ source: Source; label: string }> = [
  { source: 'nodeseek', label: 'NodeSeek' },
  { source: 'linuxdo', label: 'linux.do' },
  { source: 'yaohuo', label: '妖火' }
];

function notice(message: string, tone: AuthNoticeTone): AuthNotice {
  return { message, tone };
}

export function authNoticeForSource(source: FeedSource, sessions: SiteSessionViewModels, surface: AuthPromptSurface): AuthNotice | null {
  if (source === 'all' || source === 'v2ex') {
    return null;
  }
  const session = sessions[source];
  if (source === 'nodeseek') {
    if (session.status === 'logged-in') {
      return notice(surface === 'search' ? '已登录搜索。' : 'NodeSeek 已登录。', 'neutral');
    }
    if (session.status === 'verified') {
      return notice('已通过访问验证，登录后可使用完整能力。', 'neutral');
    }
    if (session.status === 'verification-required' || session.status === 'verifying') {
      return notice('需要完成 NodeSeek 验证后继续。', 'warning');
    }
    if (session.status === 'expired') {
      return notice('NodeSeek 登录已失效，请重新登录。', 'danger');
    }
    return notice(surface === 'search' ? '未登录搜索，结果可能不完整。' : '请先在“更多”里登录并检测 NodeSeek Cookie。', 'warning');
  }
  if (source === 'yaohuo') {
    if (session.status === 'logged-in') {
      return notice('妖火已登录。', 'neutral');
    }
    if (session.status === 'expired') {
      return notice('妖火登录已失效，请重新登录。', 'danger');
    }
    if (session.status === 'verification-required' || session.status === 'verifying') {
      return notice('妖火需要完成访问验证。', 'warning');
    }
    return notice('妖火需要登录后使用此功能。', 'warning');
  }
  if (session.status === 'logged-in') {
    return notice('linux.do 已登录。', 'neutral');
  }
  if (session.status === 'verified') {
    return notice('已通过访问验证，登录后可互动。', 'neutral');
  }
  if (session.status === 'verification-required' || session.status === 'verifying') {
    return notice('linux.do 需要完成验证后继续。', 'warning');
  }
  if (session.status === 'expired') {
    return notice('linux.do 登录已失效，请重新登录。', 'danger');
  }
  return notice('匿名可阅读，登录后才能互动。', 'neutral');
}

export function authHintForSource(source: FeedSource, sessions: SiteSessionViewModels, surface: AuthPromptSurface) {
  return authNoticeForSource(source, sessions, surface)?.message || '';
}

export function searchSessionNoticeItems(source: FeedSource, sessions: SiteSessionViewModels): SearchSessionNoticeItem[] {
  const sources = source === 'all'
    ? searchSessionSources
    : searchSessionSources.filter((item) => item.source === source);
  return sources.flatMap((item) => {
    const notice = authNoticeForSource(item.source, sessions, 'search');
    return notice ? [{ ...item, notice }] : [];
  });
}

export function searchSessionNoticeLightTone(notice: AuthNotice): SearchSessionNoticeLightTone {
  if (notice.message.includes('已登录')) {
    return 'success';
  }
  if (notice.message.includes('登录已失效') || notice.message.includes('需要登录')) {
    return 'danger';
  }
  return notice.tone;
}

export function authNoticeForMessage(message: string): AuthNotice | null {
  if (!message) {
    return null;
  }
  if (message.includes('登录已失效') || message.includes('已失效')) {
    return notice(message, 'danger');
  }
  if (
    message.includes('需要登录')
    || message.includes('未登录')
    || message.includes('需要完成')
    || message.includes('需要验证')
    || message.includes('Cloudflare 验证')
  ) {
    return notice(message, 'warning');
  }
  if (message.includes('匿名可阅读') || message.includes('已登录') || message.includes('已通过访问验证')) {
    return notice(message, 'neutral');
  }
  return null;
}

export function authActionMessageForSource(source: FeedSource, sessions: SiteSessionViewModels) {
  return authHintForSource(source, sessions, 'action');
}
