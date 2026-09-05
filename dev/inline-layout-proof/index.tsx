import 'expo-dev-client';
import { registerRootComponent } from 'expo';
import { useRef, useState } from 'react';
import { PixelRatio, ScrollView, Text, View, useWindowDimensions } from 'react-native';

type CaseProps = {
  name: string;
  prefix: string;
  width: number;
  wraps: boolean;
  lineHeight?: number;
  suffix?: string;
};

function LayoutCase({ name, prefix, width, wraps, lineHeight, suffix = '' }: CaseProps) {
  const parent = useRef<Text>(null);
  const child = useRef<View>(null);
  const [result, setResult] = useState('WAITING');

  function measure() {
    requestAnimationFrame(() => {
      parent.current?.measureInWindow((x, _y, parentWidth) => {
        child.current?.measureInWindow((childX, _childY, childWidth) => {
          const density = PixelRatio.get();
          const offset = (childX - x) * density;
          const overflow = (childX + childWidth - x - parentWidth) * density;
          const pass = overflow <= 1 && (wraps ? Math.abs(offset) <= 1 : offset > 1);
          setResult(`${pass ? 'PASS' : 'FAIL'} dx=${offset.toFixed(2)}px overflow=${overflow.toFixed(2)}px`);
        });
      });
    });
  }

  return (
    <View style={{ marginBottom: 16 }}>
      <Text testID={`inline-proof-result-${name}`}>
        {name}: {result}
      </Text>
      <Text
        ref={parent}
        testID={`inline-proof-parent-${name}`}
        onLayout={measure}
        style={{ fontSize: 16, lineHeight, backgroundColor: '#eeeeee' }}
      >
        {prefix}
        <View
          ref={child}
          testID={`inline-proof-child-${name}`}
          onLayout={measure}
          style={{ width, height: 48, backgroundColor: '#de977a' }}
        />
        {suffix}
      </Text>
    </View>
  );
}

function InlineLayoutProof() {
  const { width, fontScale } = useWindowDimensions();
  const contentWidth = width - 40;
  const attachmentWidth = Math.round(contentWidth);
  const cases: CaseProps[] = [
    { name: 'full', prefix: '我的个人站 ', width: attachmentWidth, wraps: true, lineHeight: 26 },
    {
      name: 'long-prefix',
      prefix: 'Hermes Agent 中文社区网页布局 ',
      width: attachmentWidth,
      wraps: true,
      lineHeight: 26
    },
    { name: 'natural-line-height', prefix: '我的个人站 ', width: attachmentWidth, wraps: true },
    { name: 'suffix', prefix: '我的个人站 ', width: attachmentWidth, wraps: true, lineHeight: 26, suffix: ' 后文' },
    { name: 'small-inline', prefix: '文字 ', width: 24, wraps: false, lineHeight: 26 }
  ];

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 56, paddingBottom: 30 }}>
      <Text>
        Inline layout proof: density={PixelRatio.get()}, fontScale={fontScale}, content={contentWidth.toFixed(6)}dp
      </Text>
      {cases.map((item) => (
        <LayoutCase key={`${item.name}:${width}:${fontScale}`} {...item} />
      ))}
    </ScrollView>
  );
}

registerRootComponent(InlineLayoutProof);
