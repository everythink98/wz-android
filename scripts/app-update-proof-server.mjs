import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import signing from './apk-signing.cjs';

// Local fixture/proxy only: this server never forwards a request to the Internet.
export function createUpdateProofServer(apk, manifest, delayMs = 12) {
  const transfers = [];
  const server = createServer(async (request, response) => {
    const route = new URL(request.url, 'http://127.0.0.1').pathname;
    response.setHeader('Connection', 'close');
    if (route === '/manifest' || route === '/stats') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(route === '/manifest' ? manifest : transfers));
      return;
    }
    if (!['/apk', '/200', '/416', '/wrong-range', '/disconnect'].includes(route)) {
      response.writeHead(404).end();
      return;
    }
    const range = request.headers.range ?? null;
    const match = range?.match(/^bytes=(\d+)-$/u);
    const requestedOffset = match ? Number(match[1]) : 0;
    const offset = route === '/200' ? 0 : requestedOffset;
    const status =
      route === '/416' || (range && (!match || !Number.isSafeInteger(offset) || offset >= apk.length))
        ? 416
        : range && route !== '/200'
          ? 206
          : 200;
    const record = { route, range, status, offset, bodyBytes: 0 };
    transfers.push(record);
    if (status === 416) {
      response.writeHead(416, { 'Content-Range': `bytes */${apk.length}`, 'Content-Length': 0 }).end();
      return;
    }
    response.setHeader('Content-Length', apk.length - offset);
    response.setHeader('Content-Type', 'application/vnd.android.package-archive');
    if (status === 206)
      response.setHeader(
        'Content-Range',
        `bytes ${route === '/wrong-range' ? 0 : offset}-${apk.length - 1}/${apk.length}`
      );
    response.writeHead(status);
    const end = route === '/disconnect' ? offset + Math.floor((apk.length - offset) / 2) : apk.length;
    try {
      for (let position = offset; position < end && !response.destroyed; position += 65536) {
        const chunk = apk.subarray(position, Math.min(position + 65536, end));
        await new Promise((resolve, reject) => response.write(chunk, (error) => (error ? reject(error) : resolve())));
        record.bodyBytes += chunk.length;
        await delay(delayMs);
      }
      if (route === '/disconnect') response.destroy();
      else response.end();
    } catch {
      response.destroy();
    }
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [apkPath, buildTools] = process.argv.slice(2);
  if (!apkPath || !buildTools)
    throw new Error('Usage: node scripts/app-update-proof-server.mjs <fixture.apk> <Android build-tools directory>');
  const apk = readFileSync(apkPath);
  const badging = execFileSync(
    path.join(buildTools, process.platform === 'win32' ? 'aapt.exe' : 'aapt'),
    ['dump', 'badging', apkPath],
    { encoding: 'utf8' }
  );
  const pkg = badging.match(/package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/u);
  const signature = execFileSync(
    'java',
    ['-jar', path.join(buildTools, 'lib', 'apksigner.jar'), 'verify', '--print-certs', apkPath],
    { encoding: 'utf8' }
  );
  const signerSha256 = signing.singleApkSignerSha256(signature);
  if (!pkg || !signerSha256) throw new Error('Fixture must be an APK with one verified signer.');
  const manifest = {
    version: pkg[3],
    versionName: pkg[3],
    versionCode: Number(pkg[2]),
    packageName: pkg[1],
    signerSha256,
    sha256: createHash('sha256').update(apk).digest('hex'),
    apkUrl: 'http://update-proof.invalid/apk',
    notes: 'Local test fixture',
    size: apk.length
  };
  const server = createUpdateProofServer(apk, manifest);
  server.listen(39081, '127.0.0.1', () =>
    console.log(`Update proof fixture: ${apk.length} bytes; SHA-256 ${manifest.sha256}; localhost:39081`)
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      server.closeAllConnections();
      server.close();
    });
}
