import { sourceCatalog, type Source } from '@/domain/forum/sourceCatalog';
import { readDiagnosticJournal } from './nativeDiagnosticJournal';

export type NetworkLogEntry = { time: number; site: string; stage: string; result: string; failed: boolean };

const nativeStages = new Map([
  ['dns-end', 'DNS 解析'],
  ['tls-end', 'TLS 握手'],
  ['response-headers', 'HTTP 响应'],
  ['connect-failed', '建立连接'],
  ['call-failed', '网络请求'],
  ['request-failed', '发送请求'],
  ['response-failed', '接收响应']
]);
const failures = new Map([
  ['reset', '连接被重置'],
  ['closed', '连接已关闭'],
  ['refused', '连接被拒绝'],
  ['timeout', '超时'],
  ['unreachable', '网络不可达'],
  ['aborted', '连接中断'],
  ['invalid_response', '响应格式不符'],
  ['parse_empty', '资料解析为空'],
  ['verification_required', '网站要求验证'],
  ['network_error', '连接失败'],
  ['login_required', '需要登录'],
  ['identity_changed', '账号身份不匹配'],
  ['permission_denied', '访问被拒绝'],
  ['dns_error', 'DNS 解析失败'],
  ['tls_error', 'TLS 握手失败'],
  ['renderer_gone', '网页进程已停止'],
  ['http_error', 'HTTP 错误']
]);

const accountStages = new Map([
  ['getAccountOverview', '我的资料'],
  ['getAccountLedger', '账户流水'],
  ['attendance', '签到榜'],
  ['getUserProfile', '账号资料']
]);

function networkLogEntries(nativeLines: string, jsLines: string): NetworkLogEntry[] {
  const entries: NetworkLogEntry[] = [];
  function collect(lines: string, native: boolean) {
    for (const line of lines.split('\n')) {
      if (!line) continue;
      try {
        const event = JSON.parse(line);
        if (!event || typeof event.source !== 'string' || !Object.hasOwn(sourceCatalog, event.source)) continue;
        const site = sourceCatalog[event.source as Source].label;
        if (native) {
          if (event.diagnosticKind !== 'network' || event.operation !== 'request' || event.outcome === 'canceled')
            continue;
          let stage = nativeStages.get(event.phase);
          if (!stage || !Number.isSafeInteger(event.timeMs) || event.timeMs <= 0 || event.timeMs > 8.64e15) continue;
          const status =
            Number.isInteger(event.status) && event.status >= 100 && event.status <= 599 ? event.status : 0;
          const failed = event.phase.endsWith('failed') || status >= 400;
          if (failed && event.errorType === 'UnknownHostException') stage = 'DNS 解析';
          if (failed && ['SSLHandshakeException', 'SSLPeerUnverifiedException'].includes(event.errorType))
            stage = 'TLS 握手';
          const result = status
            ? `HTTP ${status}`
            : failed
              ? (failures.get(event.socketFailure) ?? '失败')
              : event.phase === 'tls-end' && ['TLSv1.3', 'TLSv1.2'].includes(event.tlsVersion)
                ? event.tlsVersion
                : '成功';
          entries.push({ time: event.timeMs, site, stage, result, failed });
        } else {
          const time = typeof event.time === 'string' ? Date.parse(event.time) : NaN;
          if (!Number.isFinite(time)) continue;
          if (
            event.area === 'network' &&
            event.operation === 'test' &&
            event.phase === 'finish' &&
            ['success', 'blocked', 'failure'].includes(event.outcome)
          ) {
            const http =
              Number.isInteger(event.status) && event.status >= 100 && event.status <= 599
                ? `HTTP ${event.status}`
                : '';
            const detail = event.outcome === 'success' ? '可访问' : (failures.get(event.reason) ?? '连接失败');
            entries.push({
              time,
              site,
              stage: '站点连通性',
              result: [detail, http].filter(Boolean).join(' · '),
              failed: event.outcome === 'failure'
            });
            continue;
          }
          const accountStage =
            event.area === 'source' && event.phase === 'finish' && accountStages.get(event.operation);
          if (accountStage && ['success', 'failure', 'blocked', 'partial'].includes(event.outcome)) {
            const failed = event.outcome !== 'success';
            entries.push({
              time,
              site,
              stage: accountStage,
              result: failed ? (failures.get(event.reason) ?? '读取失败') : '已读取',
              failed
            });
          } else if (
            event.source === 'linuxdo' &&
            event.area === 'credential' &&
            event.operation === 'check' &&
            event.phase === 'transport' &&
            event.isCurrent === true &&
            ['alternate', 'alternate-login', 'challenge'].includes(event.verificationPage) &&
            ['load-end', 'http-error', 'load-error', 'load-timeout', 'renderer-gone'].includes(event.verificationAction)
          ) {
            if (event.verificationAction === 'load-end' && event.hasLoadError === true) continue;
            const failed = event.verificationAction !== 'load-end';
            const result =
              event.verificationAction === 'http-error' &&
              Number.isInteger(event.status) &&
              event.status >= 400 &&
              event.status <= 599
                ? `HTTP ${event.status}`
                : event.verificationAction === 'load-timeout'
                  ? '页面加载超时'
                  : failed
                    ? (failures.get(event.reason) ?? '页面加载失败')
                    : '页面已加载';
            entries.push({ time, site, stage: '网站验证页', result, failed });
          }
        }
      } catch {
        // A damaged line does not invalidate the remaining entries.
      }
    }
  }
  collect(nativeLines, true);
  collect(jsLines, false);
  return entries.sort((a, b) => b.time - a.time);
}

export async function readNetworkLog() {
  const journal = await readDiagnosticJournal();
  if (journal.status !== 'available') throw new Error('暂时无法读取网络日志');
  return networkLogEntries(journal.nativeLines, journal.jsLines);
}
