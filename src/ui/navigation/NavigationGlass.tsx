import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction
} from 'react';
import { Platform, StyleSheet, View } from 'react-native';
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
  setLocalTarget,
  testID,
  topInset = 0
}: {
  active: boolean;
  children: ReactNode;
  setLocalTarget?: Dispatch<SetStateAction<View | null>>;
  testID?: string;
  topInset?: number;
}) {
  const target = useRef<View | null>(null);
  const navigation = useContext(NavigationContext);
  const setTarget = useContext(NavigationBackdropContext)?.setTarget;
  const { theme } = useReaderThemeStyles(createStyles);
  // Suspense disconnects layout effects while a frozen route still owns its native blur target.
  useEffect(() => {
    if (!setTarget && !setLocalTarget) return;
    const view = target.current;
    const clearIfCurrent = (current: View | null) => (current === view ? null : current);
    return () => {
      setTarget?.(clearIfCurrent);
      setLocalTarget?.(clearIfCurrent);
    };
  }, [setLocalTarget, setTarget]);
  useLayoutEffect(() => {
    if (!active || (!setTarget && !setLocalTarget)) return;
    const view = target.current;
    const activate = () => {
      setTarget?.(view);
      setLocalTarget?.(view);
    };
    if (!navigation || navigation.isFocused()) activate();
    // Frozen tabs still emit focus events without rendering their children.
    const removeFocus = navigation?.addListener('focus', activate);
    // Blur precedes native transitions; a mounted page must keep its drawn backdrop.
    return () => removeFocus?.();
  }, [active, navigation, setLocalTarget, setTarget]);
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
  backdropView,
  cropToViewport = false,
  pauseWhenHidden,
  sampleBackdrop = true,
  variant = 'navigation'
}: {
  accent?: boolean;
  backdropView?: View | null;
  cropToViewport?: boolean;
  pauseWhenHidden?: boolean;
  sampleBackdrop?: boolean;
  variant?: 'navigation' | 'toolbar' | 'surface' | 'media' | 'control';
}) {
  const backdrop = useContext(NavigationBackdropContext);
  const localBlurTarget = useMemo(() => ({ current: backdropView ?? null }), [backdropView]);
  const blurTarget = backdropView === undefined ? backdrop?.target : localBlurTarget;
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
  if (!sampleBackdrop || !blurTarget?.current) {
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
      blurTarget={blurTarget}
      pauseWhenHidden={Platform.OS === 'android' ? pauseWhenHidden : undefined}
      blurMethod={cropToViewport ? 'dimezisViewport' : 'dimezisBlurViewSdk31Plus'}
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
