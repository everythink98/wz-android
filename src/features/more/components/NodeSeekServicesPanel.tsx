import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import CheckCircle from 'lucide-react-native/icons/circle-check-big';
import ImageIcon from 'lucide-react-native/icons/image';
import type { SiteSessionViewModel } from '@/domain/session/siteSessionState';
import { AppButton } from '@/ui/controls/ButtonControls';
import { MenuButton } from '@/ui/controls/ExpandableControls';
import { SettingRail } from '@/ui/controls/SelectionControls';
import type { ReaderTheme } from '@/ui/theme/tokens';
import type { MoreScreenStyles } from '../styles';

export function NodeSeekServicesPanel({
  apiKeyBusy,
  apiKeySaved,
  recoveryThreshold,
  session,
  styles,
  theme,
  onAuthorizeApiKey,
  onCheckIn,
  onClearApiKey,
  onRecoveryThresholdChange,
  onSaveApiKey
}: {
  apiKeyBusy: boolean;
  apiKeySaved: boolean;
  recoveryThreshold: number;
  session: SiteSessionViewModel;
  styles: MoreScreenStyles;
  theme: ReaderTheme;
  onAuthorizeApiKey: () => void;
  onCheckIn: () => void;
  onClearApiKey: () => void;
  onRecoveryThresholdChange: (value: number) => void;
  onSaveApiKey: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [manualEntry, setManualEntry] = useState(false);
  const [draft, setDraft] = useState('');

  return (
    <>
      <View style={styles.stack}>
        <SettingRail
          title="读取通道自愈阈值"
          items={[1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: `${value} 次` }))}
          value={String(recoveryThreshold)}
          onChange={(value) => onRecoveryThresholdChange(Number(value))}
        />
        <Text style={styles.meta}>连续出现直连失败但 WebView 读取成功时，达到该次数后重建 NodeSeek 读取通道。</Text>
      </View>
      {session.canWrite ? (
        <MenuButton nested icon={CheckCircle} label="NodeSeek 签到" value="使用本机登录 Cookie" onPress={onCheckIn} />
      ) : null}
      <MenuButton
        nested
        icon={ImageIcon}
        label="NodeImage API Key"
        value={apiKeySaved ? '已保存，NodeSeek 图片上传可用' : '未保存，NodeSeek 图片上传不可用'}
        expanded={expanded}
        onPress={() => setExpanded((value) => !value)}
      />
      {expanded ? (
        <View style={styles.stack}>
          <Text style={styles.meta}>优先复用 NodeImage 登录态；明确失效时才连接 NodeSeek。手动粘贴只作备用。</Text>
          <View style={styles.actions}>
            <AppButton label="获取 / 恢复授权" disabled={apiKeyBusy} onPress={onAuthorizeApiKey} />
            <AppButton label="清除 Key" variant="ghost" disabled={apiKeyBusy || !apiKeySaved} onPress={onClearApiKey} />
            <AppButton
              label={manualEntry ? '收起手动备用' : '手动粘贴备用'}
              variant="ghost"
              onPress={() => setManualEntry((value) => !value)}
            />
          </View>
          {manualEntry ? (
            <>
              <TextInput
                accessibilityLabel="NodeImage API Key 输入"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="NodeImage API Key"
                placeholderTextColor={theme.muted}
                secureTextEntry
                style={styles.input}
                value={draft}
                onChangeText={setDraft}
              />
              <View style={styles.actions}>
                <AppButton
                  label={apiKeyBusy ? '保存中' : '保存 Key'}
                  disabled={apiKeyBusy || !draft.trim()}
                  onPress={() => {
                    onSaveApiKey(draft);
                    setDraft('');
                  }}
                />
              </View>
            </>
          ) : null}
        </View>
      ) : null}
    </>
  );
}
