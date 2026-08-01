import type { FeedSource, Source, SourceErrorInfo } from './types';
import type { SiteSessionViewModels } from './siteSessionState';

export type AuthPromptSurface = 'search' | 'read' | 'action';
export type AuthNoticeTone = 'neutral' | 'warning' | 'danger';
export type AuthNoticeKind =
  'anonymous' | 'logged-in' | 'verified' | 'login-required' | 'login-expired' | 'verification-required';
export type AuthNotice = {
  kind: AuthNoticeKind;
  message: string;
  tone: AuthNoticeTone;
};
export type SearchSessionNoticeItem = {
  source: Source;
  label: string;
  notice: AuthNotice;
};
export type SearchSessionNoticeLightTone = AuthNoticeTone | 'success';

const searchSessionSources: { source: Source; label: string }[] = [
  { source: 'nodeseek', label: 'NodeSeek' },
  { source: 'linuxdo', label: 'linux.do' },
  { source: 'yaohuo', label: '妖火' },
  { source: 'xiaoyinsi', label: '小隐寺' }
];

function notice(kind: AuthNoticeKind, message: string, tone: AuthNoticeTone): AuthNotice {
  return { kind, message, tone };
}

export function authNoticeForSource(
  source: FeedSource,
  sessions: SiteSessionViewModels,
  surface: AuthPromptSurface
): AuthNotice | null {
  if (source === 'all' || source === 'v2ex') {
    return null;
  }
  const session = sessions[source];
  if (session.identityTrust === 'pending') {
    const label =
      source === 'nodeseek' ? 'NodeSeek' : source === 'linuxdo' ? 'linux.do' : source === 'yaohuo' ? '妖火' : '小隐寺';
    return notice(
      'verification-required',
      `${label} 登录状态待确认，已暂停${surface === 'action' ? '写入' : '新请求和写入'}。`,
      'warning'
    );
  }
  if (source === 'xiaoyinsi') {
    if (session.status === 'logged-in') {
      return notice('logged-in', '小隐寺已授权。', 'neutral');
    }
    if (session.status === 'authorizing') {
      return notice('verification-required', '正在等待小隐寺授权。', 'warning');
    }
    if (session.status === 'expired') {
      return notice('login-expired', '小隐寺授权已失效，请重新授权。', 'danger');
    }
    return notice(
      'anonymous',
      surface === 'action' ? '请先授权小隐寺后再互动。' : '匿名可阅读，授权后才能互动。',
      'neutral'
    );
  }
  if (source === 'nodeseek') {
    if (session.status === 'logged-in') {
      return notice('logged-in', surface === 'search' ? '已登录搜索。' : 'NodeSeek 已登录。', 'neutral');
    }
    if (session.status === 'verified') {
      return notice(
        'verified',
        surface === 'search' ? '未登录搜索使用 Google，结果可能不完整。' : '已通过访问验证，登录后可使用完整能力。',
        'neutral'
      );
    }
    if (session.status === 'verification-required' || session.status === 'verifying') {
      return notice('verification-required', '需要完成 NodeSeek 验证后继续。', 'warning');
    }
    if (session.status === 'expired') {
      return notice(
        'login-expired',
        surface === 'search'
          ? 'NodeSeek 登录已失效；未登录搜索使用 Google，结果可能不完整。'
          : 'NodeSeek 登录已失效，请重新登录。',
        'danger'
      );
    }
    return notice(
      'login-required',
      surface === 'search' ? '未登录搜索使用 Google，结果可能不完整。' : '请先在“更多”里登录并检测 NodeSeek Cookie。',
      'warning'
    );
  }
  if (source === 'yaohuo') {
    if (session.status === 'logged-in') {
      return notice('logged-in', '妖火已登录。', 'neutral');
    }
    if (session.status === 'expired') {
      return notice('login-expired', '妖火登录已失效，请重新登录。', 'danger');
    }
    if (session.status === 'verification-required' || session.status === 'verifying') {
      return notice('verification-required', '妖火需要完成访问验证。', 'warning');
    }
    return notice('login-required', '妖火需要登录后使用此功能。', 'warning');
  }
  if (session.status === 'logged-in') {
    return notice('logged-in', 'linux.do 已登录。', 'neutral');
  }
  if (session.status === 'verified') {
    return notice(
      'verified',
      surface === 'search' ? '未登录搜索使用 Google，结果可能不完整。' : '已通过访问验证，登录后可互动。',
      'neutral'
    );
  }
  if (session.status === 'verification-required' || session.status === 'verifying') {
    return notice('verification-required', 'linux.do 需要完成验证后继续。', 'warning');
  }
  if (session.status === 'expired') {
    return notice('login-expired', 'linux.do 登录已失效，请重新登录。', 'danger');
  }
  return notice(
    'anonymous',
    surface === 'search' ? '未登录搜索使用 Google，结果可能不完整。' : '匿名可阅读，登录后才能互动。',
    'neutral'
  );
}

export function authHintForSource(source: FeedSource, sessions: SiteSessionViewModels, surface: AuthPromptSurface) {
  return authNoticeForSource(source, sessions, surface)?.message || '';
}

export function searchSessionNoticeItems(
  source: FeedSource,
  sessions: SiteSessionViewModels
): SearchSessionNoticeItem[] {
  const sources =
    source === 'all' ? searchSessionSources : searchSessionSources.filter((item) => item.source === source);
  return sources.flatMap((item) => {
    const notice = authNoticeForSource(item.source, sessions, 'search');
    return notice ? [{ ...item, notice }] : [];
  });
}

export function searchSessionNoticeLightTone(notice: AuthNotice): SearchSessionNoticeLightTone {
  if (notice.kind === 'logged-in') {
    return 'success';
  }
  if (notice.kind === 'login-expired' || notice.kind === 'login-required') {
    return 'danger';
  }
  return notice.tone;
}

export function authNoticeForSourceError(error: SourceErrorInfo): AuthNotice | null {
  if (error.kind === 'login-expired') {
    return notice('login-expired', error.message, 'danger');
  }
  if (error.kind === 'login-required') {
    return notice('login-required', error.message, 'warning');
  }
  if (error.kind === 'verification-required') {
    return notice('verification-required', error.message, 'warning');
  }
  return null;
}

export function authActionMessageForSource(source: FeedSource, sessions: SiteSessionViewModels) {
  return authHintForSource(source, sessions, 'action');
}
