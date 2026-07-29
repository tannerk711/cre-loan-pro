// Local stand-in for the Zapier catch hook. Dumps every POST body to
// tools/webhook-received.json so tests can assert what the Zap would see.
// Usage: node tools/webhook-catcher.mjs   (listens on http://localhost:5321/)

import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), 'webhook-received.json');

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    writeFileSync(out, body);
    console.log(`caught ${body.length} bytes -> ${out}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"status":"success"}');
  });
}).listen(5321, () => console.log('webhook catcher on http://localhost:5321/'));
