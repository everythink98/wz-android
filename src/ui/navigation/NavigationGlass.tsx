import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction
} from 'react';
import { StyleSheet, View } from 'react-native';
import { NavigationContext } from '@react-navigation/native';
import { BlurTargetView, BlurView } from 'expo-blur';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { alphaColor, readerRadii, type ReaderTheme } from '@/ui/theme/tokens';

const NavigationBackdropContext = createContext<{
  target: RefObject<View | null>;
  setTarget: Dispatch<SetStateAction<View | null>>;
} | null>(null);

export function NavigationBackdropProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<View | null>(null);
  const value = useMemo(() => ({ target: { current: target }, setTarget }), [target]);
  return <NavigationBackdropContext.Provider value={value}>{children}</NavigationBackdropContext.Provider>;
}

export function NavigationBackdropTarget({
  active,
  children,
  testID,
  topInset = 0
}: {
  active: boolean;
  children: ReactNode;
  testID?: string;
  topInset?: number;
}) {
  const target = useRef<View | null>(null);
  const navigation = useContext(NavigationContext);
  const setTarget = useContext(NavigationBackdropContext)?.setTarget;
  const { theme } = useReaderThemeStyles(createStyles);
  useLayoutEffect(() => {
    if (!setTarget) return;
    const view = target.current;
    return () => setTarget((current) => (current === view ? null : current));
  }, [setTarget]);
  useLayoutEffect(() => {
    if (!active || !setTarget) return;
    const view = target.current;
    const activate = () => setTarget(view);
    if (!navigation || navigation.isFocused()) activate();
    // Frozen tabs still emit focus events without rendering their children.
    const removeFocus = navigation?.addListener('focus', activate);
    // Blur precedes native transitions; a mounted page must keep its drawn backdrop.
    return () => removeFocus?.();
  }, [active, navigation, setTarget]);
  return (
    <BlurTargetView
      ref={target}
      style={[targetStyle, topInset ? { marginTop: -topInset, paddingTop: topInset } : undefined]}
      testID={testID}
    >
      {topInset ? (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, right: 0, left: 0, height: topInset, backgroundColor: theme.surface }}
        />
      ) : null}
      {children}
    </BlurTargetView>
  );
}

const targetStyle = { flex: 1 };

export function NavigationGlass({
  accent = false,
  variant = 'navigation'
}: {
  accent?: boolean;
  variant?: 'navigation' | 'toolbar' | 'surface' | 'media' | 'control';
}) {
  const backdrop = useContext(NavigationBackdropContext);
  const { styles, theme } = useReaderThemeStyles(createStyles);
  const testID = variant === 'navigation' ? 'navigation-glass' : `navigation-glass-${variant}`;
  const fill = (
    <View
      style={[
        styles.glass,
        variant === 'toolbar' && styles.toolbar,
        variant === 'surface' && styles.surface,
        variant === 'media' && styles.media,
        variant === 'control' && styles.control,
        accent && { backgroundColor: alphaColor(theme.primary, theme.dark ? 0.18 : 0.1) }
      ]}
    />
  );
  if (!backdrop?.target.current) {
    return (
      <View
        testID={testID}
        pointerEvents="none"
        accessible={false}
        style={[StyleSheet.absoluteFill, { backgroundColor: variant === 'media' ? '#101113' : theme.surface }]}
      >
        {fill}
      </View>
    );
  }
  return (
    <BlurView
      testID={testID}
      pointerEvents="none"
      accessible={false}
      blurTarget={backdrop?.target}
      blurMethod="dimezisBlurViewSdk31Plus"
      intensity={40}
      tint={variant === 'media' || theme.dark ? 'dark' : 'light'}
      style={StyleSheet.absoluteFill}
    >
      {fill}
    </BlurView>
  );
}

export function NavigationGlassGroup({ children, round = false }: { children: ReactNode; round?: boolean }) {
  const { styles } = useReaderThemeStyles(createStyles);
  return (
    <View style={[styles.group, round && styles.round]}>
      <NavigationGlass variant="control" />
      {children}
    </View>
  );
}

function createStyles(theme: ReaderTheme) {
  return StyleSheet.create({
    glass: {
      ...StyleSheet.absoluteFill,
      backgroundColor: alphaColor(theme.surface, theme.dark ? 0.52 : 0.34)
    },
    toolbar: { backgroundColor: alphaColor(theme.surface, theme.dark ? 0.72 : 0.65) },
    surface: { backgroundColor: alphaColor(theme.surface, theme.dark ? 0.82 : 0.72) },
    media: { backgroundColor: 'rgba(16, 17, 19, 0.52)' },
    control: { backgroundColor: alphaColor(theme.surface, theme.dark ? 0.5 : 0.38) },
    group: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      minHeight: 44,
      minWidth: 44,
      borderRadius: readerRadii.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: alphaColor(theme.ink, theme.dark ? 0.2 : 0.12),
      borderTopColor: alphaColor('#FFFFFF', theme.dark ? 0.28 : 0.9),
      overflow: 'hidden',
      elevation: 2,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 3
    },
    round: { borderRadius: readerRadii.pill }
  });
}
