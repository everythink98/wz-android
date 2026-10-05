import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Copy, Image, Share2, ChevronRight, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Topic } from '@/domain/forum/models';
import { sourceLabel } from '@/domain/forum/presentation';
import { errorMessage } from '@/platform/network/errors';
import { IconButton } from '@/ui/controls/ButtonControls';
import { ModalSheetFrame } from '@/ui/controls/ModalSheetFrame';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import type { ReaderStyleSettings, ReaderTheme } from '@/ui/theme/tokens';

export function TopicShareOptions({
  topic,
  onClose,
  onShareLink,
  onCopyLink,
  onShareImage
}: {
  topic: Topic;
  onClose: () => void;
  onShareLink: () => Promise<unknown>;
  onCopyLink: () => Promise<void>;
  onShareImage?: () => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
  const insets = useSafeAreaInsets();
  const current = useRef(true);
  const running = useRef(false);
  const [busy, setBusy] = useState<'link' | 'copy' | null>(null);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    current.current = true;
    return () => {
      current.current = false;
    };
  }, []);
  const close = () => {
    current.current = false;
    onClose();
  };
  const run = async (action: 'link' | 'copy') => {
    if (running.current || !current.current) return;
    running.current = true;
    setBusy(action);
    setError('');
    setFeedback('');
    try {
      if (action === 'link') await onShareLink();
      else {
        await onCopyLink();
        if (current.current) setFeedback('链接已复制');
      }
    } catch (cause) {
      if (current.current) setError(errorMessage(cause));
    } finally {
      running.current = false;
      if (current.current) setBusy(null);
    }
  };
  const actions = [
    {
      key: 'link',
      label: '分享链接',
      description: '发送标题和原帖链接',
      icon: Share2,
      disabled: false,
      onPress: () => void run('link')
    },
    {
      key: 'copy',
      label: '复制链接',
      description: '复制原帖地址',
      icon: Copy,
      disabled: false,
      onPress: () => void run('copy')
    },
    {
      key: 'image',
      label: '生成长图',
      description: onShareImage ? '保留主帖的完整文字和图片' : '正文加载后可生成',
      icon: Image,
      disabled: !onShareImage,
      onPress: () => {
        if (current.current && !running.current) onShareImage?.();
      }
    }
  ];
  return (
    <ModalSheetFrame visible keyboardAvoiding={false} backdropLabel="关闭分享" onRequestClose={close}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.heading}>
          分享帖子
        </Text>
        <IconButton icon={X} label="关闭分享" iconOnly onPress={close} />
      </View>
      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 4 + insets.bottom }}>
        <View style={styles.topic}>
          <Text numberOfLines={2} style={styles.title}>
            {topic.title}
          </Text>
          <Text style={styles.source}>
            {sourceLabel(topic.source)}
            {topic.author ? ` · ${topic.author}` : ''}
          </Text>
        </View>
        {actions.map(({ key, label, description, icon: Icon, disabled, onPress }) => (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled: disabled || busy !== null, busy: busy === key }}
            disabled={disabled || busy !== null}
            onPress={onPress}
            style={[styles.action, (disabled || busy !== null) && styles.disabled]}
          >
            <View style={styles.icon}>
              {busy === key ? (
                <ActivityIndicator color={theme.primary} />
              ) : (
                <Icon size={22} color={theme.primary} strokeWidth={1.8} />
              )}
            </View>
            <View style={styles.labelGroup}>
              <Text style={styles.label}>{label}</Text>
              <Text style={styles.description}>{description}</Text>
            </View>
            <ChevronRight size={18} color={theme.muted} />
          </Pressable>
        ))}
        {feedback ? (
          <Text accessibilityLiveRegion="polite" style={styles.feedback}>
            {feedback}
          </Text>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
      </ScrollView>
    </ModalSheetFrame>
  );
}

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const font = (size: number) => Math.round(size * settings.fontScale);
  return StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    heading: { fontSize: font(18), color: theme.ink, fontWeight: '700' },
    content: { flexShrink: 1 },
    topic: {
      paddingBottom: 16,
      marginBottom: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
      gap: 6
    },
    title: { fontSize: font(15), lineHeight: font(22), color: theme.ink, fontWeight: '500' },
    source: { fontSize: font(12), color: theme.muted },
    action: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 14,
      paddingHorizontal: 4,
      minHeight: 76,
      borderRadius: 10
    },
    disabled: { opacity: 0.45 },
    icon: {
      width: 44,
      height: 44,
      borderRadius: 12,
      backgroundColor: theme.primarySoft,
      alignItems: 'center',
      justifyContent: 'center'
    },
    labelGroup: { flex: 1, gap: 4 },
    label: { fontSize: font(15), fontWeight: '600', color: theme.ink },
    description: { fontSize: font(12), lineHeight: font(18), color: theme.muted },
    feedback: { color: theme.success, fontSize: font(13), paddingVertical: 8 },
    error: { color: theme.danger, fontSize: font(13), paddingVertical: 8 }
  });
}
