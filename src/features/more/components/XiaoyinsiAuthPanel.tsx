import type { MoreScreenStyles } from '../styles';
import { Alert, Text, View } from 'react-native';
import type { XiaoyinsiAuthPhase } from '@/domain/session/accountCenter';
import type { XiaoyinsiPendingAuthorization } from '@/sources/xiaoyinsi/auth';
import type { SiteSessionViewModel } from '@/domain/session/siteSessionState';
import { AppButton } from '@/ui/controls/ButtonControls';
import type { ReaderTheme } from '@/ui/theme/tokens';

function countdownLabel(seconds: number) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const remainder = Math.max(0, seconds) % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export function XiaoyinsiAuthPanel({
  message,
  pending,
  phase,
  secondsRemaining,
  session,
  styles,
  theme,
  onBegin,
  onCancel,
  onOpenBrowser,
  onRevoke
}: {
  message: string;
  pending: XiaoyinsiPendingAuthorization | null;
  phase: XiaoyinsiAuthPhase;
  secondsRemaining: number;
  session: SiteSessionViewModel;
  styles: MoreScreenStyles;
  theme: ReaderTheme;
  onBegin: () => void;
  onCancel: () => void;
  onOpenBrowser: () => void;
  onRevoke: () => void;
}) {
  const waiting = phase === 'waiting' && pending;
  const showingAuthorizedAccount = session.isLoggedIn && !waiting && phase !== 'requesting' && phase !== 'cleanup';
  return (
    <View style={styles.stack}>
      {showingAuthorizedAccount ? (
        <View style={styles.stack}>
          <Text style={styles.panelTitle}>授权管理</Text>
          <Text style={styles.meta}>User API Key 仅保存在本机，不读取浏览器 Cookie。</Text>
        </View>
      ) : (
        <Text style={styles.meta}>
          系统浏览器只打开一次性小隐寺授权页；阅坛登录态只由独立 User API Key 维护，不读取浏览器 Cookie，也不打开登录
          WebView。
        </Text>
      )}
      {phase === 'requesting' ? <Text style={styles.meta}>正在创建安全授权请求…</Text> : null}
      {waiting ? (
        <>
          <View style={styles.stack}>
            <Text style={styles.panelTitle}>授权验证码</Text>
            <Text
              selectable
              accessibilityLabel={`小隐寺授权验证码 ${pending.userCode}`}
              style={{ color: theme.ink, fontSize: 28, fontWeight: '800', letterSpacing: 3 }}
            >
              {pending.userCode}
            </Text>
            <Text style={styles.meta}>剩余 {countdownLabel(secondsRemaining)} · 返回阅坛后会自动继续检测</Text>
          </View>
          <View style={styles.actions}>
            <AppButton label="复制验证码并前往授权页" variant="primary" onPress={onOpenBrowser} />
            <AppButton label="取消" variant="ghost" onPress={onCancel} />
          </View>
        </>
      ) : null}
      {phase === 'cleanup' ? (
        <AppButton label="重试本机清理" variant="primary" onPress={onBegin} />
      ) : session.isLoggedIn ? (
        <View style={styles.actions}>
          <AppButton tiny label="重新授权" variant="ghost" onPress={onBegin} />
          <AppButton
            tiny
            label="撤销授权"
            variant="danger"
            onPress={() =>
              Alert.alert('撤销小隐寺授权？', '服务器确认撤销后，阅坛才会删除本机 Token 和安全密钥。', [
                { text: '取消', style: 'cancel' },
                { text: '撤销授权', style: 'destructive', onPress: onRevoke }
              ])
            }
          />
        </View>
      ) : !waiting && phase !== 'requesting' ? (
        <AppButton
          label={
            phase === 'expired'
              ? '重新授权'
              : phase === 'unsupported'
                ? '重新检测'
                : phase === 'error'
                  ? '重试授权'
                  : '授权登录'
          }
          variant="primary"
          onPress={onBegin}
        />
      ) : null}
      {message ? <Text style={styles.meta}>{message}</Text> : null}
    </View>
  );
}
