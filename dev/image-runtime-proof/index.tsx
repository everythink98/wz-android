import { registerRootComponent } from 'expo';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { applyNetworkProxy } from '@/platform/network/networkProxy';

// Keep the production RN/native initialization without starting Feed or account requests.
function ImageRuntimeProof() {
  const [status, setStatus] = useState('initializing');
  useEffect(() => {
    let mounted = true;
    void applyNetworkProxy(null).then(
      () => mounted && setStatus('ready'),
      (error: unknown) => mounted && setStatus(error instanceof Error ? error.message : 'proxy initialization failed')
    );
    return () => {
      mounted = false;
    };
  }, []);
  return (
    <View
      collapsable={false}
      testID={status === 'ready' ? 'image-runtime-proof' : 'image-runtime-pending'}
      style={{ flex: 1 }}
    >
      {status !== 'ready' && <Text>{status}</Text>}
    </View>
  );
}

registerRootComponent(ImageRuntimeProof);
