import 'expo-dev-client';
import { registerRootComponent } from 'expo';
import { Directory, DownloadTask, File, Paths } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import { Button, NativeModules, ScrollView, Text, View } from 'react-native';
import { applyNetworkProxy } from '@/platform/network/networkProxy';
import {
  type ApkInstaller,
  type AppUpdateInfo,
  openApkInstaller,
  verifyDownloadedApk
} from '@/platform/update/appUpdate';

// Separate Metro entry. No production imports this file, and no production URL/signer policy is changed.
// Only this fixture directory is written; proxy changes are in-memory and normal bootstrap restores the saved profile.
const folder = new Directory(Paths.document, 'wz-update-proof');
const partial = new File(folder, 'fixture.part');
const complete = new File(folder, 'fixture.apk');
const metadata = new File(folder, 'fixture.json');
const installer = NativeModules.ApkInstallerModule as ApkInstaller | undefined;
type Fixture = AppUpdateInfo & { size: number };

function UpdateDownloadProof() {
  const [fixture, setFixture] = useState<Fixture | null>(null);
  const [message, setMessage] = useState('恢复测试文件');
  const [bytes, setBytes] = useState(0);
  const [busy, setBusy] = useState(false);
  const task = useRef<DownloadTask | null>(null);
  const running = useRef(false);

  useEffect(() => {
    folder.create({ intermediates: true, idempotent: true });
    if (metadata.exists) {
      setFixture(JSON.parse(metadata.textSync()));
      setBytes(complete.exists ? complete.size : partial.exists ? partial.size : 0);
    }
    setMessage('测试文件已恢复；先启用测试代理再传输，已有完整包可离线安装');
  }, []);

  async function run(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'ERROR';
      setMessage(`测试操作失败：${code} ${error instanceof Error ? error.message : ''}`);
    } finally {
      setBytes(complete.exists ? complete.size : partial.exists ? partial.size : 0);
      running.current = false;
      setBusy(false);
    }
  }

  async function loadFixture() {
    const response = await fetch('http://127.0.0.1:39081/manifest');
    if (!response.ok) throw new Error('Fixture service unavailable');
    const value: Fixture = await response.json();
    if (fixture && fixture.sha256 !== value.sha256 && (partial.exists || complete.exists))
      throw new Error('Clear the old proof files before changing fixture');
    metadata.write(JSON.stringify(value));
    setFixture(value);
    setMessage(`测试 APK ${value.version} / ${value.size} 字节`);
  }

  async function transfer(route: string) {
    if (!fixture || complete.exists) return;
    const offset = partial.exists ? partial.size : 0;
    const url = `http://update-proof.invalid/${route}`;
    const options = {
      headers: { 'Accept-Encoding': 'identity' },
      onProgress: (progress: { bytesWritten: number }) => setBytes(progress.bytesWritten)
    };
    const active =
      offset > 0
        ? DownloadTask.fromSavable(
            { url, fileUri: partial.uri, isDirectory: false, resumeData: String(offset) },
            options
          )
        : File.createDownloadTask(url, partial, options);
    task.current = active;
    setMessage(`请求偏移 ${offset}`);
    try {
      const result = await (offset > 0 ? active.resumeAsync() : active.downloadAsync());
      if (!result) {
        setMessage(`已暂停，磁盘偏移 ${partial.size}`);
        return;
      }
      await verifyDownloadedApk(installer, partial.uri, fixture);
      await new File(partial.uri).move(complete);
      setMessage(`SHA-256 校验通过 ${fixture.sha256}`);
    } finally {
      active.release();
      task.current = null;
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 50, gap: 12 }}>
      <Text accessibilityRole="header">MORE-04 Android 下载证据</Text>
      <Text selectable>{message}</Text>
      <Text testID="update-proof-bytes">磁盘/传输字节：{bytes}</Text>
      <Button title="载入测试 APK" disabled={busy} onPress={() => void run(loadFixture)} />
      <Button
        title="启用测试代理"
        disabled={busy}
        onPress={() =>
          void run(async () => {
            await applyNetworkProxy({
              id: 'update-proof',
              name: 'Update proof',
              protocol: 'http',
              host: '10.0.2.2',
              port: 39081
            });
            setMessage('已启用本机测试代理；公网下载只会到达受控服务');
          })
        }
      />
      <Button
        title="阻断测试代理"
        disabled={busy}
        onPress={() =>
          void run(async () => {
            await applyNetworkProxy({
              id: 'update-proof-blocked',
              name: 'Update proof blocked',
              protocol: 'http',
              host: '10.0.2.2',
              port: 1
            });
            setMessage('测试代理已阻断；下一次下载必须失败且服务端零新增传输');
          })
        }
      />
      {['apk', '200', '416', 'wrong-range', 'disconnect'].map((route) => (
        <View key={route}>
          <Button
            title={`下载/续传 ${route}`}
            disabled={busy || !fixture || complete.exists}
            onPress={() => void run(() => transfer(route))}
          />
        </View>
      ))}
      <Button
        title="暂停"
        disabled={!busy}
        onPress={() => {
          void task.current?.pauseAsync().catch(() => undefined);
        }}
      />
      <Button
        title="校验并打开安装确认"
        disabled={busy || !fixture || !complete.exists}
        onPress={() =>
          void run(async () => {
            await verifyDownloadedApk(installer, complete.uri, fixture!);
            await openApkInstaller(installer, complete.uri);
            setMessage('已打开安装确认；返回或取消后文件保持完整');
          })
        }
      />
      <Button
        title="清理本测试文件"
        disabled={busy}
        onPress={() =>
          void run(async () => {
            for (const file of [partial, complete, metadata]) if (file.exists) file.delete();
            setFixture(null);
            setMessage('仅清理 wz-update-proof 测试文件');
          })
        }
      />
    </ScrollView>
  );
}

registerRootComponent(UpdateDownloadProof);
