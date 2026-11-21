import { ActivityIndicator } from 'react-native-paper';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Copy, Image, Share2, ChevronRight } from 'lucide-react-native';
import type { Topic } from '@/domain/forum/models';
import { sourceLabel } from '@/domain/forum/presentation';
import { errorMessage } from '@/platform/network/errors';
import { ModalSheetFrame, ModalSheetHeader } from '@/ui/controls/ModalSheetFrame';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import {
  createReaderFontSizer,
  fontFamilyValue,
  readerRadii,
  type ReaderStyleSettings,
  type ReaderTheme
} from '@/ui/theme/tokens';

type ShareActivity =
  { phase: 'idle' } | { phase: 'acquiring-controller' } | { phase: 'in-flight'; controller: AbortController };

type ShareOwner = { lifetime: 'current' | 'retired'; activity: ShareActivity };

export function TopicShareOptions({
  topic,
  onClose,
  onShareLink,
  onCopyLink,
  onShareImage
}: {
  topic: Topic;
  onClose: () => void;
  onShareLink: (signal: AbortSignal) => Promise<unknown>;
  onCopyLink: () => Promise<void>;
  onShareImage?: () => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
  const owner = useRef<ShareOwner>({ lifetime: 'current', activity: { phase: 'idle' } });
  const [busy, setBusy] = useState<'idle' | 'link' | 'copy'>('idle');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    owner.current = { ...owner.current, lifetime: 'current' };
    return () => {
      owner.current = { ...owner.current, lifetime: 'retired' };
      const activity = owner.current.activity;
      if (activity.phase === 'in-flight') activity.controller.abort();
    };
  }, []);
  const close = () => {
    owner.current = { ...owner.current, lifetime: 'retired' };
    const activity = owner.current.activity;
    if (activity.phase === 'in-flight') activity.controller.abort();
    onClose();
  };
  const run = async (action: 'link' | 'copy') => {
    if (owner.current.activity.phase !== 'idle' || owner.current.lifetime !== 'current') return;
    owner.current = { ...owner.current, activity: { phase: 'acquiring-controller' } };
    const abort = new AbortController();
    owner.current = { ...owner.current, activity: { phase: 'in-flight', controller: abort } };
    setBusy(action);
    setError('');
    setFeedback('');
    try {
      if (action === 'link') await onShareLink(abort.signal);
      else {
        await onCopyLink();
        if (owner.current.lifetime === 'current') setFeedback('链接已复制');
      }
    } catch (cause) {
      if (owner.current.lifetime === 'current') setError(errorMessage(cause));
    } finally {
      owner.current = { ...owner.current, activity: { phase: 'idle' } };
      if (owner.current.lifetime === 'current') setBusy('idle');
    }
  };
  const actions = [
    {
      key: 'link',
      label: '分享链接',
      description: '',
      icon: Share2,
      disabled: false,
      onPress: () => void run('link')
    },
    {
      key: 'copy',
      label: '复制链接',
      description: '',
      icon: Copy,
      disabled: false,
      onPress: () => void run('copy')
    },
    {
      key: 'image',
      label: '生成长图',
      description: onShareImage ? '' : '正文加载后可生成',
      icon: Image,
      disabled: !onShareImage,
      onPress: () => {
        if (owner.current.lifetime === 'current' && owner.current.activity.phase === 'idle') onShareImage?.();
      }
    }
  ];
  return (
    <ModalSheetFrame visible keyboardAvoiding={false} backdropLabel="关闭分享" onRequestClose={close}>
      <ModalSheetHeader title="分享帖子" closeLabel="关闭分享" onClose={close} />
      <ScrollView overScrollMode="never" style={styles.content}>
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
            accessibilityState={{ disabled: disabled || busy !== 'idle', busy: busy === key }}
            disabled={disabled || busy !== 'idle'}
            onPress={onPress}
            style={[styles.action, busy !== key && (disabled || busy !== 'idle') && styles.disabled]}
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
              {description ? <Text style={styles.description}>{description}</Text> : null}
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
  const font = createReaderFontSizer(settings);
  const fontFamily = fontFamilyValue(settings.fontFamily);
  return StyleSheet.create({
    content: { flexShrink: 1 },
    topic: {
      paddingBottom: 14,
      marginBottom: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
      gap: 6
    },
    title: { fontFamily, fontSize: font(15), lineHeight: font(22), color: theme.ink, fontWeight: '500' },
    source: { fontFamily, fontSize: font(12), color: theme.muted },
    action: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      paddingHorizontal: 2,
      minHeight: 56,
      borderRadius: readerRadii.control
    },
    disabled: { opacity: 0.45 },
    icon: {
      width: 38,
      height: 38,
      borderRadius: readerRadii.control,
      backgroundColor: theme.primarySoft,
      alignItems: 'center',
      justifyContent: 'center'
    },
    labelGroup: { flex: 1, gap: 3 },
    label: { fontFamily, fontSize: font(15), fontWeight: '600', color: theme.ink },
    description: { fontFamily, fontSize: font(12), lineHeight: font(18), color: theme.muted },
    feedback: { fontFamily, color: theme.success, fontSize: font(13), paddingVertical: 8 },
    error: { fontFamily, color: theme.danger, fontSize: font(13), paddingVertical: 8 }
  });
}
