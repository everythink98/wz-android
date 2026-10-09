import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Portal } from '@gorhom/portal';
import {
  Bold,
  ChartNoAxesColumn,
  Check,
  ChevronDown,
  Code,
  CodeXml,
  Ellipsis,
  ImagePlus,
  Italic,
  Keyboard,
  Link,
  List,
  Minus,
  Quote,
  SmilePlus,
  Strikethrough,
  Table,
  Type,
  Underline,
  Wallet,
  Wrench,
  LayoutTemplate,
  type LucideIcon
} from 'lucide-react-native';
import type { ComposerIntent, ComposerSite } from '@/domain/forum/structuredComposer';
import { recordUserInteraction } from '@/platform/network/userPresence';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { type ReaderStyleSettings, fontFamilyValue, type ReaderTheme } from '@/ui/theme/tokens';
import type { ComposerToolbarAction, ComposerToolbarState } from './structuredComposerBridge';

export type ComposerToolbarProps = {
  state: ComposerToolbarState | null;
  site: ComposerSite;
  intentKind: ComposerIntent['kind'];
  disabled: boolean;
  onAction: (action: ComposerToolbarAction) => void;
  viewportRef: RefObject<View | null>;
  hostRef: RefObject<View | null>;
  menuHostName: string;
};

type MenuKind = 'heading' | 'list';
type ToolbarButton = {
  action: ComposerToolbarAction | 'heading-menu' | 'list-menu';
  label: string;
  icon?: LucideIcon;
  text?: string;
  active?: boolean;
};
type Menu = { kind: MenuKind; left: number; top: number; width: number; height: number };

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  return StyleSheet.create({
    root: {
      height: 58,
      flexShrink: 0,
      backgroundColor: theme.surface2,
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      justifyContent: 'center'
    },
    topic: { height: 56, backgroundColor: theme.surface },
    row: { alignItems: 'center', paddingHorizontal: 8, gap: 8 },
    topicRow: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
    button: {
      minWidth: 48,
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      paddingHorizontal: 10,
      borderRadius: 8
    },
    topicButton: { flex: 1 },
    selected: { backgroundColor: theme.primarySoft },
    disabled: { opacity: 0.45 },
    text: {
      color: theme.ink,
      fontFamily: fontFamilyValue(settings.fontFamily),
      fontSize: Math.round(13 * Math.min(settings.fontScale, 1.15))
    },
    selectedText: { color: theme.primary },
    overlay: { ...StyleSheet.absoluteFill, zIndex: 20 },
    menu: {
      position: 'absolute',
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 10,
      elevation: 4,
      overflow: 'hidden'
    },
    menuItem: {
      minHeight: 48,
      paddingHorizontal: 14,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8
    }
  });
}

export function ComposerToolbar({
  state,
  site,
  intentKind,
  disabled,
  onAction,
  viewportRef,
  hostRef,
  menuHostName
}: ComposerToolbarProps) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
  const window = useWindowDimensions();
  const barRef = useRef<View>(null);
  const requestGeneration = useRef(0);
  const menuAnchor = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const [menu, setMenu] = useState<Menu | null>(null);
  const unavailable = disabled || !state;
  const rich = state?.mode === 'rich';
  const topic = intentKind === 'create-topic' || intentKind === 'edit-topic';
  const closeMenu = useCallback(() => {
    requestGeneration.current += 1;
    setMenu(null);
  }, []);

  useLayoutEffect(() => {
    closeMenu();
    return () => {
      requestGeneration.current += 1;
    };
  }, [
    closeMenu,
    unavailable,
    site,
    intentKind,
    state?.mode,
    state?.builder,
    menuHostName,
    window.width,
    window.height
  ]);

  useEffect(() => {
    if (!menu) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      closeMenu();
      return true;
    });
    return () => subscription.remove();
  }, [closeMenu, menu]);

  const openMenu = (kind: MenuKind) => {
    if (unavailable) return;
    if (menu?.kind === kind) {
      closeMenu();
      return;
    }
    const host = hostRef.current;
    const viewport = viewportRef.current;
    if (!host || !viewport || !barRef.current) return;
    const generation = ++requestGeneration.current;
    barRef.current.measureLayout(
      host,
      (x, y, width, barHeight) => {
        if (generation !== requestGeneration.current) return;
        viewport.measure((_x, _y, _width, availableHeight) => {
          if (generation !== requestGeneration.current) return;
          const height = Math.min(kind === 'heading' ? 240 : 144, availableHeight);
          if (height <= 0 || width <= 16) return;
          menuAnchor.current = { x, y, width, height: barHeight };
          setMenu({ kind, top: y - height, left: x + 8, width: Math.min(240, width - 16), height });
        });
      },
      () => {
        if (generation === requestGeneration.current) closeMenu();
      }
    );
  };

  const dispatch = (action: ComposerToolbarAction) => {
    if (unavailable || (action === 'upload-image' && state?.imageBusy)) return;
    closeMenu();
    onAction(action);
  };
  const image: ToolbarButton = {
    action: 'upload-image',
    label: state?.imageBusy ? '上传中…' : '图片',
    icon: ImagePlus
  };
  const emoji: ToolbarButton = {
    action: 'emoji',
    label: '表情',
    icon: SmilePlus,
    active: state?.builder === 'emoji' || state?.builder === 'stickers'
  };
  const buttons: ToolbarButton[] = topic
    ? [
        image,
        emoji,
        { action: 'format', label: '文字格式', icon: Type, active: state?.builder === 'format' },
        { action: 'focus-editor', label: '输入正文', icon: Keyboard },
        { action: 'more', label: '更多编辑工具', icon: Ellipsis, active: state?.builder === 'more' }
      ]
    : [
        emoji,
        image,
        { action: 'bold', label: '粗体', icon: Bold, active: rich && state?.bold },
        { action: 'italic', label: '斜体', icon: Italic, active: rich && state?.italic },
        {
          action: 'heading-menu',
          label: '段落与标题',
          text: rich && state?.heading ? `标题 ${state.heading}` : '正文'
        },
        { action: 'strike', label: '删除线', icon: Strikethrough, active: rich && state?.strike },
        ...(site === 'linuxdo'
          ? [{ action: 'underline' as const, label: '下划线', icon: Underline, active: rich && state?.underline }]
          : []),
        { action: 'link', label: '链接', icon: Link, active: rich && state?.link },
        { action: 'quote', label: '引用', icon: Quote, active: rich && state?.blockquote },
        { action: 'code', label: '代码', icon: Code, active: rich && state?.code },
        {
          action: 'list-menu',
          label: '列表选项',
          icon: List,
          active: rich && Boolean(state?.bulletList || state?.orderedList || state?.taskList)
        },
        { action: 'code-block', label: '代码块', icon: CodeXml, active: rich && state?.codeBlock },
        { action: 'divider', label: '分隔线', icon: Minus },
        { action: 'table', label: '表格', icon: Table, active: rich && state?.table },
        ...(site === 'nodeseek' && intentKind !== 'private-message'
          ? [
              { action: 'poll' as const, label: '投票', text: '投票', icon: ChartNoAxesColumn },
              { action: 'stardust' as const, label: 'Stardust 收款', text: 'Stardust 收款', icon: Wallet }
            ]
          : []),
        ...(site === 'linuxdo'
          ? [
              { action: 'poll' as const, label: '投票', text: '投票', icon: ChartNoAxesColumn },
              { action: 'private' as const, label: '正文工具', text: '正文工具', icon: Wrench },
              { action: 'templates' as const, label: '动态模板', text: '动态模板', icon: LayoutTemplate }
            ]
          : [])
      ];
  const renderedButtons = buttons.map(({ action, label, icon: Icon, text, active }) => {
    const menuKind = action === 'heading-menu' ? 'heading' : action === 'list-menu' ? 'list' : null;
    const busy = action === 'upload-image' && Boolean(state?.imageBusy);
    const blocked = unavailable || busy;
    return (
      <Pressable
        key={action}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{
          disabled: blocked,
          selected: Boolean(active),
          ...(menuKind ? { expanded: menu?.kind === menuKind } : {}),
          busy
        }}
        disabled={blocked}
        style={[styles.button, topic && styles.topicButton, active && styles.selected, blocked && styles.disabled]}
        onPress={() => {
          if (action === 'heading-menu' || action === 'list-menu')
            openMenu(action === 'heading-menu' ? 'heading' : 'list');
          else dispatch(action);
        }}
      >
        {Icon ? <Icon size={20} strokeWidth={1.8} color={active ? theme.primary : theme.ink} /> : null}
        {text ? <Text style={[styles.text, active && styles.selectedText]}>{text}</Text> : null}
        {menuKind ? <ChevronDown size={14} color={theme.muted} /> : null}
      </Pressable>
    );
  });
  const choices: { action: ComposerToolbarAction; label: string; selected: boolean }[] =
    menu?.kind === 'heading'
      ? ([0, 1, 2, 3, 4, 5, 6] as const).map((level) => ({
          action: `heading-${level}`,
          label: level ? `标题 ${level}` : '正文',
          selected: (rich ? state?.heading : 0) === level
        }))
      : [
          { action: 'list', label: '无序列表', selected: Boolean(rich && state?.bulletList) },
          { action: 'ordered-list', label: '有序列表', selected: Boolean(rich && state?.orderedList) },
          { action: 'task-list', label: '任务列表', selected: Boolean(rich && state?.taskList) }
        ];

  return (
    <>
      <View
        ref={barRef}
        collapsable={false}
        testID="composer-toolbar"
        accessibilityRole="toolbar"
        accessibilityLabel={topic ? '发帖常用工具栏' : '回复常用工具栏'}
        style={[styles.root, topic && styles.topic]}
        onTouchStart={recordUserInteraction}
        onLayout={
          menu
            ? ({ nativeEvent: { layout } }) => {
                const previous = menuAnchor.current;
                if (
                  Math.abs(layout.x - previous.x) > 1 ||
                  Math.abs(layout.y - previous.y) > 1 ||
                  Math.abs(layout.width - previous.width) > 1 ||
                  Math.abs(layout.height - previous.height) > 1
                )
                  closeMenu();
              }
            : undefined
        }
      >
        {topic ? (
          <View style={styles.topicRow}>{renderedButtons}</View>
        ) : (
          <ScrollView
            overScrollMode="never"
            horizontal
            keyboardShouldPersistTaps="always"
            keyboardDismissMode="none"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          >
            {renderedButtons}
          </ScrollView>
        )}
      </View>
      {menu && !unavailable ? (
        <Portal hostName={menuHostName}>
          <View style={styles.overlay} pointerEvents="box-none" onTouchStart={recordUserInteraction}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭工具栏菜单"
              style={StyleSheet.absoluteFill}
              onPress={closeMenu}
            />
            <View
              testID="composer-toolbar-menu"
              accessibilityRole="menu"
              accessibilityLabel={menu.kind === 'heading' ? '段落与标题选项' : '列表选项'}
              style={[styles.menu, { left: menu.left, top: menu.top, width: menu.width, height: menu.height }]}
            >
              <ScrollView overScrollMode="never" keyboardShouldPersistTaps="always" keyboardDismissMode="none">
                {choices.map((choice) => (
                  <Pressable
                    key={choice.action}
                    accessibilityRole="menuitem"
                    accessibilityLabel={choice.label}
                    accessibilityState={{ selected: choice.selected }}
                    style={[styles.menuItem, choice.selected && styles.selected]}
                    onPress={() => dispatch(choice.action)}
                  >
                    <Text style={[styles.text, choice.selected && styles.selectedText]}>{choice.label}</Text>
                    {choice.selected ? <Check size={18} color={theme.primary} /> : null}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </View>
        </Portal>
      ) : null}
    </>
  );
}
