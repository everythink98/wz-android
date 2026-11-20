import { recordUserInteraction } from '@/platform/network/userPresence';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, type TextInput as RNTextInput, View } from 'react-native';
import { CalendarCheck, Check, ChevronDown, Dices } from 'lucide-react-native';
import { Button, Divider, List, Menu } from 'react-native-paper';
import type { NodeSeekAttendanceBoard, NodeSeekCheckInState } from '@/domain/forum/accountData';
import { AppButton } from '@/ui/controls/ButtonControls';
import { AppTextInput } from '@/ui/controls/InputControls';
import { DisclosureChevron, ExpandableContent } from '@/ui/controls/ExpandableControls';
import type { ReaderTheme } from '@/ui/theme/tokens';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import type { MoreScreenStyles } from '../styles';
import { createMoreSiteSettingStyles } from '../accountStyles';
import { useCloseOnBack } from '../useCloseOnBack';

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
  apiKeyAuthorized,
  apiKeyBusy,
  apiKeySaved,
  recoveryThreshold,
  theme,
  onAuthorizeApiKey,
  onClearApiKey,
  onRecoveryThresholdChange,
  onSaveApiKey
}: {
  active?: boolean;
  apiKeyAuthorized: boolean;
  apiKeyBusy: boolean;
  apiKeySaved: boolean;
  recoveryThreshold: number;
  theme: ReaderTheme;
  onAuthorizeApiKey: () => void;
  onClearApiKey: () => void;
  onRecoveryThresholdChange: (value: number) => void;
  onSaveApiKey: (value: string) => void;
}) {
  const [expansion, setExpansion] = useState<DisclosureState>('unopened');
  const [manualExpansion, setManualExpansion] = useState<DisclosureState>('unopened');
  const [thresholdMenuOpen, setThresholdMenuOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const keyInput = useRef<RNTextInput>(null);
  const { styles: settingStyles } = useReaderThemeStyles(createMoreSiteSettingStyles);
  const expanded = expansion === 'expanded';
  const manualEntry = manualExpansion === 'expanded';
  const openThresholdMenu = () => {
    recordUserInteraction();
    keyInput.current?.blur();
    setThresholdMenuOpen(true);
  };
  const thresholdButton = (
    <Button
      mode="outlined"
      compact
      accessibilityLabel="读取通道自愈阈值"
      accessibilityState={{ expanded: thresholdMenuOpen }}
      accessibilityHint={`当前 ${recoveryThreshold} 次，点按选择`}
      icon={({ color, size }) => <ChevronDown color={color} size={size} />}
      style={settingStyles.button}
      contentStyle={settingStyles.buttonContent}
      labelStyle={settingStyles.buttonLabel}
      onPress={openThresholdMenu}
    >
      {recoveryThreshold} 次
    </Button>
  );

  // Paper's dismiss listener does not consume Android Back.
  useCloseOnBack(active && thresholdMenuOpen, setThresholdMenuOpen);

  useEffect(() => {
    if (!active) {
      keyInput.current?.blur();
      setExpansion('unopened');
      setManualExpansion('unopened');
      setThresholdMenuOpen(false);
      setDraft('');
    }
  }, [active]);

  return (
    <>
      <List.Item
        title="读取通道自愈阈值"
        accessible={false}
        onPress={openThresholdMenu}
        titleNumberOfLines={2}
        style={settingStyles.row}
        containerStyle={settingStyles.rowContainer}
        contentStyle={settingStyles.rowContent}
        titleStyle={settingStyles.title}
        right={() =>
          thresholdMenuOpen ? (
            <Menu
              visible
              onDismiss={() => setThresholdMenuOpen(false)}
              anchorPosition="bottom"
              statusBarHeight={0}
              overlayAccessibilityLabel="关闭次数选择"
              contentStyle={settingStyles.menu}
              anchor={thresholdButton}
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <Menu.Item
                  key={value}
                  title={`${value} 次`}
                  accessibilityLabel={`${value} 次`}
                  accessibilityState={{ selected: value === recoveryThreshold }}
                  trailingIcon={
                    value === recoveryThreshold ? ({ color, size }) => <Check color={color} size={size} /> : undefined
                  }
                  titleStyle={settingStyles.title}
                  onPress={() => {
                    recordUserInteraction();
                    setThresholdMenuOpen(false);
                    onRecoveryThresholdChange(value);
                  }}
                />
              ))}
            </Menu>
          ) : (
            thresholdButton
          )
        }
      />
      <Divider style={settingStyles.divider} />
      <List.Item
        title="NodeImage 授权"
        description={apiKeyAuthorized ? '已授权' : undefined}
        accessibilityRole="button"
        accessibilityLabel={`NodeImage 授权，${apiKeyAuthorized ? '已授权' : '未授权'}`}
        accessibilityState={{ expanded }}
        style={settingStyles.row}
        containerStyle={settingStyles.rowContainer}
        contentStyle={settingStyles.rowContent}
        titleStyle={settingStyles.title}
        descriptionStyle={settingStyles.description}
        right={() => <DisclosureChevron expanded={expanded} color={theme.muted} />}
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
        <ExpandableContent expanded={expanded} style={settingStyles.section}>
          <View style={settingStyles.actions}>
            <AppButton
              compact
              variant="primary"
              label={apiKeyBusy ? '授权处理中' : '获取 / 恢复授权'}
              accessibilityLabel="获取 / 恢复授权"
              loading={apiKeyBusy}
              disabled={apiKeyBusy}
              onPress={onAuthorizeApiKey}
            />
            {apiKeySaved ? (
              <AppButton
                compact
                variant="danger"
                label="清除 Key"
                accessibilityLabel="清除 Key"
                disabled={apiKeyBusy}
                onPress={onClearApiKey}
              />
            ) : null}
          </View>
          <List.Item
            title="手动粘贴 Key"
            accessibilityRole="button"
            accessibilityLabel={manualEntry ? '收起手动备用' : '手动粘贴备用'}
            accessibilityState={{ expanded: manualEntry }}
            style={settingStyles.row}
            containerStyle={settingStyles.rowContainer}
            contentStyle={settingStyles.rowContent}
            titleStyle={settingStyles.title}
            right={() => <DisclosureChevron expanded={manualEntry} color={theme.muted} />}
            onPress={() => {
              setManualExpansion((value) => (value === 'expanded' ? 'collapsed' : 'expanded'));
              if (manualEntry) {
                keyInput.current?.blur();
                setDraft('');
              }
            }}
          />
          {manualExpansion !== 'unopened' ? (
            <ExpandableContent expanded={manualEntry} style={settingStyles.section}>
              <AppTextInput
                ref={keyInput}
                variant="outlined"
                label="NodeImage API Key"
                accessibilityLabel="NodeImage API Key 输入"
                aria-label="NodeImage API Key 输入"
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect={false}
                placeholder="NodeImage API Key"
                placeholderTextColor={theme.muted}
                secureTextEntry
                style={settingStyles.input}
                value={draft}
                onChange={recordUserInteraction}
                onChangeText={setDraft}
              />
              <View style={settingStyles.actions}>
                <AppButton
                  compact
                  variant="primary"
                  label={apiKeyBusy ? '保存中' : '保存 Key'}
                  accessibilityLabel={apiKeyBusy ? '保存中' : '保存 Key'}
                  loading={apiKeyBusy}
                  disabled={apiKeyBusy || !draft.trim()}
                  onPress={() => onSaveApiKey(draft)}
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
  const [pendingMode, setPendingMode] = useState<'normal' | 'random'>('normal');
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
  const showCheckInActions = Boolean(board && board.record === null && !record && !pending && !error);
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
      {showCheckInActions ? (
        <View style={attendanceStyles.actions}>
          <View style={attendanceStyles.action}>
            <AppButton
              icon={CalendarCheck}
              label="普通签到"
              variant={canCheckIn ? 'solid' : 'default'}
              loading={busy && pendingMode === 'normal'}
              disabled={!canCheckIn}
              onPress={() => {
                setPendingMode('normal');
                onCheckIn(false);
              }}
            />
          </View>
          <View style={attendanceStyles.action}>
            <AppButton
              icon={Dices}
              label="随机签到"
              loading={busy && pendingMode === 'random'}
              disabled={!canCheckIn}
              onPress={() => {
                setPendingMode('random');
                onCheckIn(true);
              }}
            />
          </View>
        </View>
      ) : null}
      {error ? (
        <AppButton
          compact
          variant="ghost"
          label="重试签到状态"
          loading={loading}
          disabled={busy || loading}
          onPress={onRefresh}
        />
      ) : null}
    </View>
  );
}
