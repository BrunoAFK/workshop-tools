import { createReadStream, watch } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex } from './build-index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// `.env` učitava build-index.mjs pri importu — mora prije, jer se dio
// varijabli čita već na razini tog modula. Ovdje je samo napomena.
const dist = path.join(root, 'dist');
const sourcesRoot = path.join(root, 'sources');
const watched = [sourcesRoot, path.join(root, 'app')];
const port = Number(process.env.PORT) || 4173;

/**
 * Na koje sučelje server sluša.
 *
 * Zadano je `0.0.0.0` — sva sučelja, da se katalog otvori s mobitela
 * bez dodatnog prekidača. Server samo poslužuje `dist/` i ne prima
 * nikakav upis, pa je izloženost ograničena na čitanje sadržaja.
 *
 * Na tuđoj mreži se vrati na loopback:
 *
 *   HOST=127.0.0.1 npm run dev
 */
const host = process.env.HOST || '0.0.0.0';
const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';

/** Adrese ovog računala na lokalnoj mreži — za upisivanje na mobitelu. */
function lanAddresses() {
  const found = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) found.push(net.address);
    }
  }
  return found;
}
const clients = new Set();
const watchers = new Map();
let rebuildTimer;

const mimeTypes = {
  '.avif': 'image/avif', '.css': 'text/css; charset=utf-8', '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp'
};

function notify() {
  for (const response of clients) response.write('event: index-updated\ndata: updated\n\n');
}

function scheduleBuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(async () => {
    try {
      const data = await buildIndex({ quiet: true, dev: true });
      console.log(`[${new Date().toLocaleTimeString('hr-HR')}] Indeks osvježen · ${data.items.length} dokumenata`);
      await syncWatchers();
      notify();
    } catch (error) {
      console.error('Indeksiranje nije uspjelo:', error instanceof Error ? error.message : error);
    }
  }, 180);
}

async function directories(directory) {
  const result = [directory];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) result.push(...await directories(path.join(directory, entry.name)));
  }
  return result;
}

async function syncWatchers() {
  const current = new Set((await Promise.all(watched.map(directories))).flat());
  for (const [directory, watcher] of watchers) {
    if (!current.has(directory)) {
      watcher.close();
      watchers.delete(directory);
    }
  }
  for (const directory of current) {
    if (!watchers.has(directory)) watchers.set(directory, watch(directory, scheduleBuild));
  }
}

/** Servira se isključivo dist/ — isto što Cloudflare Pages objavljuje. */
function safeFilePath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
  const resolved = path.resolve(dist, pathname.replace(/^\/+/, ''));
  return resolved === dist || resolved.startsWith(`${dist}${path.sep}`) ? resolved : null;
}

async function resolveTarget(filePath) {
  try {
    if ((await stat(filePath)).isDirectory()) return path.join(filePath, 'index.html');
  } catch { /* ne postoji — pusti da createReadStream javi 404 */ }
  return filePath;
}

await buildIndex({ dev: true });
await syncWatchers();

const server = createServer(async (request, response) => {
  const url = request.url || '/';

  if (url === '/__workshop_events') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    });
    response.write(': connected\n\n');
    clients.add(response);
    request.on('close', () => clients.delete(response));
    return;
  }

  const filePath = safeFilePath(url);
  if (!filePath) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  const target = await resolveTarget(filePath);
  const stream = createReadStream(target);
  stream.once('open', () => {
    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow'
    });
    stream.pipe(response);
  });
  stream.once('error', () => {
    const notFound = createReadStream(path.join(dist, '404.html'));
    notFound.once('open', () => {
      response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      notFound.pipe(response);
    });
    notFound.once('error', () => response.writeHead(404).end('Not found'));
  });
});

server.listen(port, host, () => {
  const base = `http://127.0.0.1:${port}`;
  console.log(`Katalog: ${base}/`);
  console.log('Promjene u sources/ i app/ automatski osvježavaju katalog.');

  if (loopback) {
    console.log('');
    console.log('Server sluša samo na ovom računalu (HOST=127.0.0.1).');
  } else {
    const addresses = lanAddresses();
    console.log('');
    if (addresses.length) {
      console.log('S mobitela na istoj mreži:');
      for (const address of addresses) console.log(`  http://${address}:${port}/`);
    } else {
      console.log('Nema mrežne adrese — računalo nije spojeno na mrežu.');
    }
  }
});

function shutdown() {
  for (const watcher of watchers.values()) watcher.close();
  for (const client of clients) client.end();
  server.close();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
