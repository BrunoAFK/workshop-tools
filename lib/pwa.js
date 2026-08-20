/**
 * Sve što od statičnog sajta radi instalabilnu aplikaciju.
 *
 * Ikone se ne uzimaju iz datoteka nego se crtaju u kodu — i kao SVG i
 * kao PNG. Razlog je isti kao za ostatak generatora: build mora proći
 * na Cloudflareu, gdje nema ni preglednika ni alata za slike, a jedini
 * PNG koji nam treba je ploha, šesterokut i rupa. To Node zna sam,
 * `zlib` je u standardnoj biblioteci.
 */

import { deflateSync } from 'node:zlib';

/* ═══════════════════════════════════════════════════════════
   Boje
   ═══════════════════════════════════════════════════════════ */

/** `#abc` i `#aabbcc` → [r, g, b]. Sve ostalo je greška u dokumentu. */
export function parseHex(value, fallback = [0, 0, 0]) {
  const text = String(value || '').trim().replace(/^#/, '');
  const full = text.length === 3 ? text.replace(/./g, (c) => c + c) : text;
  if (!/^[0-9a-f]{6}$/i.test(full)) return fallback;
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16));
}

export const toHex = ([r, g, b]) =>
  `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`;

/** Relativna svjetlina po WCAG — po njoj se bira rub oko ikone. */
export function luminance([r, g, b]) {
  const channel = (n) => {
    const c = n / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/* ═══════════════════════════════════════════════════════════
   Geometrija znaka

   Isti šesterokut s probušenom rupom kao u zaglavlju kataloga i u
   `favicon.svg` — jedna obitelj oblika, a razlikuju ih boje alata.
   ═══════════════════════════════════════════════════════════ */

/** Vrhovi šesterokuta upisanog u kvadrat 0…1, s tjemenom gore. */
const HEX = [
  [0.5, 0.0], [1.0, 0.25], [1.0, 0.75],
  [0.5, 1.0], [0.0, 0.75], [0.0, 0.25]
];

const HOLE_R = 0.19;   // polumjer rupe, u dijelovima stranice kvadrata

function insideHex(x, y) {
  // Konveksan poligon: točka je unutra ako je sa iste strane svih bridova.
  for (let i = 0; i < HEX.length; i++) {
    const [ax, ay] = HEX[i];
    const [bx, by] = HEX[(i + 1) % HEX.length];
    if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) < 0) return false;
  }
  return true;
}

const insideHole = (x, y) => (x - 0.5) ** 2 + (y - 0.5) ** 2 <= HOLE_R ** 2;

/**
 * Je li točka u znaku.
 *
 * `mark` je udio stranice koji znak zauzima. Za maskirane ikone se drži
 * ispod 0.6, jer Android reže sve izvan središnjeg kruga.
 */
function insideMark(x, y, mark) {
  const u = (x - 0.5) / mark + 0.5;
  const v = (y - 0.5) / mark + 0.5;
  if (u < 0 || u > 1 || v < 0 || v > 1) return false;
  return insideHex(u, v) && !insideHole(u, v);
}

/* ═══════════════════════════════════════════════════════════
   SVG ikona
   ═══════════════════════════════════════════════════════════ */

const hexPath = (mark) => {
  const at = ([x, y]) => {
    const u = ((x - 0.5) * mark + 0.5) * 512;
    const v = ((y - 0.5) * mark + 0.5) * 512;
    return `${u.toFixed(1)} ${v.toFixed(1)}`;
  };
  const outline = HEX.map((point, i) => (i ? 'L' : 'M') + at(point)).join('') + 'Z';
  const r = (HOLE_R * mark * 512).toFixed(1);
  const hole = `M256 ${(256 - HOLE_R * mark * 512).toFixed(1)}a${r} ${r} 0 1 0 0 ${(2 * HOLE_R * mark * 512).toFixed(1)}a${r} ${r} 0 1 0 0 -${(2 * HOLE_R * mark * 512).toFixed(1)}Z`;
  return outline + hole;
};

export function iconSvg({ bg, fg, mark = 0.56, rounded = false }) {
  const shape = rounded
    ? '<rect width="512" height="512" rx="114" fill="' + bg + '"/>'
    : '<rect width="512" height="512" fill="' + bg + '"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">`
    + shape
    + `<path fill="${fg}" fill-rule="evenodd" d="${hexPath(mark)}"/>`
    + `</svg>\n`;
}

/* ═══════════════════════════════════════════════════════════
   PNG ikona

   Rasterizira se sa četverostrukim uzorkovanjem po osi, pa se
   uprosječuje — bez toga bi kosi bridovi šesterokuta bili stepenasti
   na 192 px, gdje se ikona najčešće i vidi.
   ═══════════════════════════════════════════════════════════ */

const SAMPLES = 4;

export function iconPixels(size, { bg, fg, mark = 0.56 }) {
  const back = parseHex(bg);
  const front = parseHex(fg);
  const pixels = Buffer.alloc(size * size * 4);
  const step = 1 / (size * SAMPLES);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const u = (x * SAMPLES + sx + 0.5) * step;
          const v = (y * SAMPLES + sy + 0.5) * step;
          if (insideMark(u, v, mark)) hits++;
        }
      }
      const share = hits / (SAMPLES * SAMPLES);
      const at = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        pixels[at + c] = Math.round(back[c] + (front[c] - back[c]) * share);
      }
      pixels[at + 3] = 255;
    }
  }
  return pixels;
}

/* ── PNG zapis ──────────────────────────────────────────────
   Osam bita po kanalu, RGBA, bez filtriranja redaka. Za plohu s
   jednim oblikom deflate ionako sve pojede: ikona od 512 px stane
   u nekoliko kilobajta. */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

export function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;        // bita po kanalu
  header[9] = 6;        // RGBA
  header[10] = 0;       // deflate
  header[11] = 0;       // zadano filtriranje
  header[12] = 0;       // bez preplitanja

  // Svaki redak nosi vodeći bajt filtra; 0 znači „bez filtra".
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

export const iconPng = (size, colors) => encodePng(size, iconPixels(size, colors));

/* ═══════════════════════════════════════════════════════════
   Manifest
   ═══════════════════════════════════════════════════════════ */

/**
 * Kratko ime za početni zaslon.
 *
 * Naslovi alata su rečenice („Timer za vježbanje — odmor, serije i
 * odbrojavanje"), a ispod ikone stane desetak znakova. Uzima se dio
 * prije crte, pa prije dvotočke; alat koji želi svoje upisuje
 * `<meta name="application-name">`.
 */
export function shortName(title, declared) {
  const source = declared || String(title || '').split(/\s+[—–-]\s+|:\s/)[0];
  const text = source.trim();
  return text.length <= 24 ? text : `${text.slice(0, 23).replace(/\s+\S*$/, '')}…`;
}

export function manifestFor({ name, short, description, startUrl, scope, theme, background, iconBase }) {
  return `${JSON.stringify({
    name,
    short_name: short,
    description,
    start_url: startUrl,
    scope,
    display: 'standalone',
    orientation: 'any',
    theme_color: theme,
    background_color: background,
    icons: [
      { src: `${iconBase}.svg`, sizes: 'any', type: 'image/svg+xml' },
      { src: `${iconBase}-192.png`, sizes: '192x192', type: 'image/png' },
      { src: `${iconBase}-512.png`, sizes: '512x512', type: 'image/png' },
      { src: `${iconBase}-mask.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  }, null, 2)}\n`;
}

/* ═══════════════════════════════════════════════════════════
   Service worker

   Posluži iz predmemorije, a u pozadini povuci novo — pa je stranica
   odmah tu i bez mreže, a nova verzija se primijeni kad je idući put
   otvoriš. Sprema se ono što si posjetio; ništa se ne povlači unaprijed.
   ═══════════════════════════════════════════════════════════ */

/** Stranica za slučaj da si bez mreže, a taj alat nikad nisi otvorio. */
const OFFLINE_PAGE = `<!doctype html>
<html lang="hr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#15140e">
<title>Bez mreže</title>
<style>
  :root { color-scheme: dark light }
  body {
    display: grid; place-items: center; min-height: 100svh; margin: 0; padding: 0 6vw;
    background: #15140e; color: #f2efe6; text-align: center;
    font: 400 15px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  h1 { margin: 0 0 10px; font-size: 1.05rem; font-weight: 600 }
  p { margin: 0; max-width: 40ch; color: #a09a8b; font-size: .88rem }
  a { display: inline-block; margin-top: 22px; padding: 9px 15px;
      border: 1px solid #d9a441; border-radius: 8px; color: #d9a441;
      font-size: .84rem; font-weight: 600; text-decoration: none }
</style>
</head>
<body>
<main>
  <h1>Ovaj alat nije spremljen za offline</h1>
  <p>Spremaju se samo alati koje si već otvorio. Otvori ga jednom dok imaš mrežu i poslije radi i bez nje.</p>
  <a href="/">Natrag na katalog</a>
</main>
</body>
</html>`;

export const SERVICE_WORKER = `/* Generirano iz lib/pwa.js — ne uređuj ovdje. */
const OFFLINE_PAGE = ${JSON.stringify(OFFLINE_PAGE)};
const CACHE = 'workshop';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Imena predmemorija iz ranijih inačica ovog workera.
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Kanal za live-reload u dev-u je beskonačan tok; spremanje bi ga
  // zadržalo u predmemoriji kao mrtvu vezu.
  if (request.headers.get('accept') === 'text/event-stream') return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(request);

    // Mreža ide i kad postoji pogodak: tako se sprema ono što je novo,
    // a korisnik i dalje ne čeka.
    const fresh = fetch(request).then((response) => {
      if (response && response.ok && response.type === 'basic') cache.put(request, response.clone());
      return response;
    }).catch(() => null);

    if (hit) return hit;

    const response = await fresh;
    if (response) return response;

    // Bez mreže i bez pogotka. Katalog se ne podmeće umjesto alata —
    // adresa bi tvrdila jedno, a stranica pokazivala drugo.
    if (request.mode === 'navigate') {
      return new Response(OFFLINE_PAGE, {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    return new Response('', { status: 504, statusText: 'Offline' });
  })());
});
`;

/* ═══════════════════════════════════════════════════════════
   Ubacivanje u dokument
   ═══════════════════════════════════════════════════════════ */

const REGISTER = `<script>if('serviceWorker'in navigator)addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})});</script>`;

/**
 * Dodaje dokumentu ono što ga čini instalabilnim.
 *
 * `theme-color` se dira samo ako ga dokument nema — alat s više tema
 * ga sam mijenja pri promjeni teme, i to je mjerodavno.
 */
export function injectPwa(html, { manifestHref, iconHref, theme, hasThemeColor }) {
  const tags = [
    `<link rel="manifest" href="${manifestHref}">`,
    hasThemeColor ? '' : `<meta name="theme-color" content="${theme}">`,
    `<link rel="apple-touch-icon" href="${iconHref}">`,
    `<meta name="apple-mobile-web-app-capable" content="yes">`,
    `<meta name="apple-mobile-web-app-title" content="">`,
    REGISTER
  ].filter(Boolean);

  const block = `\n${tags.join('\n')}\n`;
  return html.includes('</head>')
    ? html.replace('</head>', `${block}</head>`)
    : html + block;
}
