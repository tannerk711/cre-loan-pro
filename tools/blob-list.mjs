// Lists every file in the project's Vercel Blob store with its upload time.
// Forensics for "did the broker's submit reach the server": a logo or
// headshot in Blob means the request passed validation and the honeypot.
// Reads BLOB_READ_WRITE_TOKEN from .env.prod-tmp (vercel env pull) or .env.
// The token never prints.
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { list } from '@vercel/blob';

// the pulled env file is a secret dump; it never outlives this script
process.on('exit', () => {
  try { unlinkSync('.env.prod-tmp'); } catch {}
});

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv('.env.prod-tmp');
loadEnv('.env');

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.error('BLOB_READ_WRITE_TOKEN not found in .env.prod-tmp or .env');
  process.exit(1);
}

let cursor;
const rows = [];
do {
  const page = await list({ token, cursor, limit: 1000 });
  for (const b of page.blobs) rows.push(b);
  cursor = page.hasMore ? page.cursor : undefined;
} while (cursor);

rows.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
console.log(`${rows.length} blob(s)`);
for (const b of rows) {
  const kb = Math.round(b.size / 1024);
  console.log(`${b.uploadedAt}  ${String(kb).padStart(6)} KB  ${b.pathname}`);
}
