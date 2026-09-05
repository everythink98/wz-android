import { Buffer } from 'node:buffer';
import { once } from 'node:events';
import { connect } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createUpdateProofServer } from '../../scripts/app-update-proof-server.mjs';

describe('local Android update fixture service', () => {
  it('drains a delayed binary response before closing the HTTP connection', async () => {
    const apk = Buffer.alloc(131072, 7);
    const server = createUpdateProofServer(apk, {}, 1);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    const socket = connect(address.port, '127.0.0.1');
    const received: Buffer[] = [];
    socket.on('data', (data) => received.push(data));
    try {
      socket.write(
        'GET http://update-proof.invalid/apk HTTP/1.1\r\nHost: update-proof.invalid\r\nConnection: close\r\n\r\n'
      );
      await once(socket, 'close');
      const response = Buffer.concat(received);
      expect(response.subarray(response.indexOf('\r\n\r\n') + 4)).toEqual(apk);
    } finally {
      socket.destroy();
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    }
  });

  it('counts only response body bytes and serves correct remaining, replacement and error responses', async () => {
    const apk = Buffer.from('0123456789');
    const server = createUpdateProofServer(apk, { size: apk.length }, 0);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const headers = { Range: 'bytes=4-' };
      const resume = await fetch(`${base}/apk`, { headers });
      expect(resume.status).toBe(206);
      expect(resume.headers.get('Content-Range')).toBe('bytes 4-9/10');
      expect(await resume.text()).toBe('456789');
      const full = await fetch(`${base}/200`, { headers });
      expect(full.status).toBe(200);
      expect(await full.text()).toBe('0123456789');
      const invalid = await fetch(`${base}/wrong-range`, { headers });
      expect(invalid.headers.get('Content-Range')).toBe('bytes 0-9/10');
      await invalid.text();
      const complete = await fetch(`${base}/apk`, { headers: { Range: 'bytes=10-' } });
      expect(complete.status).toBe(416);
      expect(await complete.text()).toBe('');
      const truncated = await fetch(`${base}/disconnect`, { headers });
      await expect(truncated.arrayBuffer()).rejects.toThrow();
      expect(await (await fetch(`${base}/stats`)).json()).toEqual([
        { route: '/apk', range: 'bytes=4-', status: 206, offset: 4, bodyBytes: 6 },
        { route: '/200', range: 'bytes=4-', status: 200, offset: 0, bodyBytes: 10 },
        { route: '/wrong-range', range: 'bytes=4-', status: 206, offset: 4, bodyBytes: 6 },
        { route: '/apk', range: 'bytes=10-', status: 416, offset: 10, bodyBytes: 0 },
        { route: '/disconnect', range: 'bytes=4-', status: 206, offset: 4, bodyBytes: 3 }
      ]);
    } finally {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    }
  });
});
