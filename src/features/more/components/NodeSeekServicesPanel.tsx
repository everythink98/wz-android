import { recordUserInteraction } from '@/platform/network/userPresence';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { CalendarCheck, Image as ImageIcon } from 'lucide-react-native';
import type { NodeSeekAttendanceBoard, NodeSeekCheckInState } from '@/domain/forum/accountData';
import { AppButton } from '@/ui/controls/ButtonControls';
import { ExpandableContent, MenuButton } from '@/ui/controls/ExpandableControls';
import { SettingRail } from '@/ui/controls/SelectionControls';
import type { ReaderTheme } from '@/ui/theme/tokens';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import type { MoreScreenStyles } from '../styles';

function createAttendanceStyles(theme: ReaderTheme) {
  return StyleSheet.create({
    section: { gap: 4, paddingVertical: 4 },
    statusRow: { alignItems: 'center', flexDirection: 'row', gap: 6, minHeight: 24 },
    status: { flex: 1, minWidth: 0 },
    signed: { color: theme.ink },
    actions: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
    action: { flex: 1, minWidth: 0 }
  });
}

type DisclosureState = 'unopened' | 'expanded' | 'collapsed';

export function NodeSeekServicesPanel({
  active = true,
  apiKeyBusy,
  apiKeySaved,
  recoveryThreshold,
  styles,
  theme,
  onAuthorizeApiKey,
  onClearApiKey,
  onRecoveryThresholdChange,
  onSaveApiKey
}: {
  active?: boolean;
  apiKeyBusy: boolean;
  apiKeySaved: boolean;
  recoveryThreshold: number;
  styles: MoreScreenStyles;
  theme: ReaderTheme;
  onAuthorizeApiKey: () => void;
  onClearApiKey: () => void;
  onRecoveryThresholdChange: (value: number) => void;
  onSaveApiKey: (value: string) => void;
}) {
  const [expansion, setExpansion] = useState<DisclosureState>('unopened');
  const [manualExpansion, setManualExpansion] = useState<DisclosureState>('unopened');
  const [draft, setDraft] = useState('');
  const keyInput = useRef<TextInput>(null);
  const expanded = expansion === 'expanded';
  const manualEntry = manualExpansion === 'expanded';

  useEffect(() => {
    if (!active) {
      keyInput.current?.blur();
      setExpansion('unopened');
      setManualExpansion('unopened');
      setDraft('');
    }
  }, [active]);

  return (
    <>
      <View style={styles.stack}>
        <SettingRail
          title="读取通道自愈阈值"
          items={[1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: `${value} 次` }))}
          value={String(recoveryThreshold)}
          onChange={(value) => onRecoveryThresholdChange(Number(value))}
        />
        <Text style={styles.meta}>直连失败但 WebView 成功时，累计到阈值后重建通道。</Text>
      </View>
      <MenuButton
        nested
        icon={ImageIcon}
        label="NodeImage 授权"
        value={apiKeySaved ? '已授权' : '未授权'}
        expanded={expanded}
        onPress={() => {
          setExpansion((value) => (value === 'expanded' ? 'collapsed' : 'expanded'));
          if (expanded) {
            keyInput.current?.blur();
            setManualExpansion((value) => (value === 'unopened' ? value : 'collapsed'));
            setDraft('');
          }
        }}
      />
      {expansion !== 'unopened' ? (
        <ExpandableContent expanded={expanded} style={styles.stack}>
          <Text style={styles.meta}>用于 NodeSeek 图片上传，可自动授权或手动填入 Key。</Text>
          <View style={styles.actions}>
            <AppButton label="获取 / 恢复授权" disabled={apiKeyBusy} onPress={onAuthorizeApiKey} />
            <AppButton label="清除 Key" variant="ghost" disabled={apiKeyBusy || !apiKeySaved} onPress={onClearApiKey} />
            <AppButton
              label={manualEntry ? '收起手动备用' : '手动粘贴备用'}
              variant="ghost"
              onPress={() => {
                setManualExpansion((value) => (value === 'expanded' ? 'collapsed' : 'expanded'));
                if (manualEntry) {
                  keyInput.current?.blur();
                  setDraft('');
                }
              }}
            />
          </View>
          {manualExpansion !== 'unopened' ? (
            <ExpandableContent expanded={manualEntry} style={styles.stack}>
              <TextInput
                ref={keyInput}
                accessibilityLabel="NodeImage API Key 输入"
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect={false}
                placeholder="NodeImage API Key"
                placeholderTextColor={theme.muted}
                secureTextEntry
                style={styles.input}
                value={draft}
                onChange={recordUserInteraction}
                onChangeText={setDraft}
              />
              <View style={styles.actions}>
                <AppButton
                  label={apiKeyBusy ? '保存中' : '保存 Key'}
                  disabled={apiKeyBusy || !draft.trim()}
                  onPress={() => {
                    onSaveApiKey(draft);
                  }}
                />
              </View>
            </ExpandableContent>
          ) : null}
        </ExpandableContent>
      ) : null}
    </>
  );
}

export function NodeSeekAttendancePanel({
  board,
  busy,
  loading,
  error,
  state,
  styles,
  onCheckIn,
  onRefresh
}: {
  board?: NodeSeekAttendanceBoard;
  busy: boolean;
  loading: boolean;
  error: unknown;
  state: NodeSeekCheckInState;
  styles: MoreScreenStyles;
  onCheckIn: (random: boolean) => void;
  onRefresh: () => void;
}) {
  const { styles: attendanceStyles, theme } = useReaderThemeStyles(createAttendanceStyles);
  const record = board?.record || (state.kind === 'signed' ? state.record : null);
  const pending = state.kind === 'confirmed-pending' || state.kind === 'result-unknown';
  const canCheckIn = Boolean(board && board.record === null && !record && !pending && !busy && !loading && !error);
  const status = record
    ? `今日已签到 · 获得 ${record.gain} 鸡腿`
    : state.kind === 'confirmed-pending'
      ? busy || loading
        ? '签到成功，正在读取收益…'
        : '签到成功，收益暂时无法读取'
      : state.kind === 'result-unknown'
        ? busy || loading
          ? '正在确认签到结果…'
          : '签到结果暂未确认，请稍后查看'
        : busy
          ? '签到处理中…'
          : loading
            ? '正在读取签到状态…'
            : error
              ? '签到状态读取失败，请重试'
              : board
                ? '今日未签到'
                : '签到状态尚未读取';
  return (
    <View style={attendanceStyles.section}>
      <View style={attendanceStyles.statusRow}>
        {record ? <CalendarCheck size={16} color={theme.success} strokeWidth={1.8} /> : null}
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.meta, attendanceStyles.status, record && attendanceStyles.signed]}
        >
          {status}
        </Text>
      </View>
      {!record ? (
        <View style={attendanceStyles.actions}>
          <View style={attendanceStyles.action}>
            <AppButton
              label="普通签到"
              variant={canCheckIn ? 'primary' : 'default'}
              disabled={!canCheckIn}
              onPress={() => onCheckIn(false)}
            />
          </View>
          <View style={attendanceStyles.action}>
            <AppButton label="随机签到" disabled={!canCheckIn} onPress={() => onCheckIn(true)} />
          </View>
        </View>
      ) : null}
      {error ? (
        <AppButton compact variant="ghost" label="重试签到状态" disabled={busy || loading} onPress={onRefresh} />
      ) : null}
    </View>
  );
}
