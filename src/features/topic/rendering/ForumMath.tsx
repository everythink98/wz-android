import { useEffect, useState } from 'react';
import { Text, View, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { renderMathJaxSvg, type MathJaxSvgResult } from './mathJaxSvg';

export type ForumMathProps = {
  boundarySpacing?: Pick<ViewStyle, 'marginBottom' | 'marginTop'>;
  color: string;
  contentWidth: number;
  display: 'block' | 'inline';
  fontScale: number;
  source: string;
};

export function ForumMath({ boundarySpacing, color, contentWidth, display, fontScale, source }: ForumMathProps) {
  const key = `${display}\0${source}`;
  const [rendered, setRendered] = useState<{ key: string; svg: MathJaxSvgResult } | null>(null);
  useEffect(() => {
    let active = true;
    renderMathJaxSvg(source, display === 'block')
      .then((svg) => {
        if (active) setRendered({ key, svg });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [display, key, source]);

  const svg = rendered?.key === key ? rendered.svg : null;
  const fontSize = Math.round((display === 'block' ? 16 : 15) * fontScale);
  if (!svg) {
    return (
      <Text
        accessibilityLabel={`公式：${source}`}
        selectable={false}
        style={[
          {
            color,
            fontSize,
            ...(display === 'block' ? { marginVertical: 8, textAlign: 'center' as const } : {})
          },
          display === 'block' ? boundarySpacing : undefined
        ]}
      >
        {source}
      </Text>
    );
  }

  const ex = fontSize / 2;
  const naturalWidth = svg.widthEx * ex;
  const scale = Math.min(1, Math.max(1, contentWidth) / naturalWidth);
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(svg.heightEx * ex * scale));
  const formula = (
    <SvgXml
      accessibilityLabel={`公式：${source}`}
      accessibilityRole="image"
      accessible
      color={color}
      height={height}
      style={
        display === 'inline'
          ? {
              marginHorizontal: 1,
              transform: [{ translateY: Math.max(0, -svg.verticalAlignEx * ex * scale) }]
            }
          : undefined
      }
      width={width}
      xml={svg.xml}
    />
  );
  return display === 'block' ? (
    <View style={[{ alignItems: 'center', alignSelf: 'stretch', marginVertical: 8 }, boundarySpacing]}>{formula}</View>
  ) : (
    formula
  );
}
