// AI-relay для CODE QR PRO: бесплатные модели Kilo нельзя звать с российского IP
// (403 от Cloudflare), поэтому новый сервер ходит к ним через старый (UK) по SSH-туннелю.
// Слушает только 127.0.0.1, требует токен, проксирует единственный путь.
import http from 'node:http';

const PORT = Number(process.env.RELAY_PORT || 3110);
const TOKEN = String(process.env.RELAY_TOKEN || '');
const UPSTREAM = 'https://api.kilo.ai/api/gateway';
const MAX_BODY = 512 * 1024;
const TIMEOUT_MS = 90_000;

if (!TOKEN) {
  console.error('AI relay: RELAY_TOKEN не задан');
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method !== 'POST' || url.pathname !== '/kilo/chat/completions') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    if (String(req.headers['x-relay-token'] || '') !== TOKEN) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'body too large' }));
        return;
      }
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    const upstream = await fetch(`${UPSTREAM}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'dsh-our-free-model',
        Accept: 'application/json'
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
      'Cache-Control': 'no-store'
    });
    res.end(text);
  } catch (e) {
    console.error('ai relay error:', String(e?.message || e).slice(0, 200));
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: 'relay failed' }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`ai relay listening on 127.0.0.1:${PORT}`);
});
