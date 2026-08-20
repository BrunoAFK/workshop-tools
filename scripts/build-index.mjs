import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DELETED_DIR, lineageOf, stateOf } from '../lib/paths.js';
import { INSTALL_BAR, SERVICE_WORKER, iconPng, iconSvg, injectPwa, manifestFor, shortName } from '../lib/pwa.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcesRoot = path.join(projectRoot, 'sources');
const appRoot = path.join(projectRoot, 'app');
const distRoot = path.join(projectRoot, 'dist');

/* ═══════════════════════════════════════════════════════════
   Rute
   `sources/` se nikad ne servira. Katalog stoji na korijenu, a
   svaki dokument dobije kopiju pod čitljivom adresom u `/alat/`.
   Ništa nije skriveno — adrese su pogodive i namijenjene dijeljenju.
   ═══════════════════════════════════════════════════════════ */

// `.env` se učitava ovdje, a ne u dev.mjs: ESM importi se izvrše prije
// tijela modula koji ih uvozi, pa bi svako čitanje process.env na razini
// ovog modula vidjelo praznu vrijednost. Ovo je najranija točka koju
// dijele i `npm run dev` i `npm run build`.
try { process.loadEnvFile(path.join(projectRoot, '.env')); } catch { /* nema .env */ }

/**
 * Javna adresa dokumenta.
 *
 * Alati nisu tajni, pa im adresa nije heš nego čitljiv naziv:
 *
 *   sources/timer.html                    → /alat/timer.html
 *   sources/archive/timer-2026-08-18.html → /alat/v/archive/timer-2026-08-18.html
 *
 * Glava loze ide po **ključu loze**, ne po putanji datoteke — zato
 * podijeljen link preživi i zamjenu novom verzijom i arhiviranje i
 * vraćanje. Da ide po putanji, arhiviranje bi promijenilo adresu i
 * svaki prije podijeljen link bi pukao.
 *
 * Starije verzije idu pod `/alat/v/`, po punoj putanji — njima adresa
 * treba biti samo jedinstvena, dostupne su iz vremenske crte.
 */
export const PUBLIC_DIR = 'alat';
export const VERSION_DIR = 'v';

export function urlFor(item, isHead) {
  return isHead
    ? `/${PUBLIC_DIR}/${item.lineage}.html`
    : `/${PUBLIC_DIR}/${VERSION_DIR}/${item.path}`;
}

/**
 * Nazivi mapa u `sources/` koji bi se sudarili s putanjama builda.
 *
 * Jedini stvarni sudarač je `v`: starije verzije žive pod
 * `/alat/v/<putanja>`, pa bi aktivni `sources/v/archive/foo-2026-08-18.html`
 * i arhivirani `sources/archive/foo-2026-08-18.html` ciljali istu adresu.
 * Provjera kolizija u `buildIndex` to i uhvati, ali tek nabrajanjem —
 * ovdje se kaže koja je mapa kriva i zašto.
 */
const RESERVED_DIRS = new Set([VERSION_DIR]);

/* Boje aplikacije: podloga iz `<meta name="theme-color">`, znak iz
   `<meta name="accent-color">`. Alat koji ih ne prijavi dobiva boje
   kataloga — ikona je i dalje njegova, samo u obiteljskim bojama. */
const DEFAULT_THEME = '#15140e';
const DEFAULT_ACCENT = '#d9a441';

/** Podloga kataloga u svijetloj temi — ista vrijednost kao `--bg`. */
const CATALOGUE_THEME = '#fbfaf7';

export function safeName(relativePath) {
  const head = relativePath.split('/')[0];
  if (RESERVED_DIRS.has(head) && relativePath.includes('/')) {
    throw new Error(`„${head}/" je rezerviran naziv mape — sudara se s /${PUBLIC_DIR}/${VERSION_DIR}/. Preimenuj je.`);
  }
  return relativePath;
}

const TOPICS = [
  { tag: 'Kalkulator', terms: ['kalkulator', 'izračun', 'izračunaj', 'formula', 'računica'] },
  { tag: 'Konverter', terms: ['konverter', 'pretvorba', 'pretvori', 'jedinica', 'mjerna'] },
  { tag: 'Generator', terms: ['generator', 'generiraj', 'nasumičn', 'lozinka', 'predložak'] },
  { tag: 'Tablica', terms: ['tablica', 'popis', 'usporedba', 'pregled', 'stupac'] },
  { tag: 'Referenca', terms: ['referenca', 'priručnik', 'šalabahter', 'sintaksa', 'naredba'] },
  { tag: 'Tekst', terms: ['tekst', 'string', 'regex', 'formatiranje', 'json'] },
  { tag: 'Vrijeme', terms: ['vrijeme', 'datum', 'sat', 'tajmer', 'odbrojavanje'] },
  { tag: 'Mjere', terms: ['duljina', 'težina', 'površina', 'volumen', 'brzina'] },
  { tag: 'Novac', terms: ['cijena', 'valuta', 'tečaj', 'porez', 'kamata'] },
  { tag: 'Boje', terms: ['boja', 'hex', 'rgb', 'paleta', 'kontrast'] },
  { tag: 'Slike', terms: ['slika', 'format', 'kompresija', 'rezolucija', 'piksel'] },
  { tag: 'Web', terms: ['url', 'domena', 'http', 'html', 'css'] }
];

const ENTITY_MAP = new Map([
  ['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"], ['nbsp', ' '],
  ['ndash', '–'], ['mdash', '—'], ['hellip', '…'], ['copy', '©'], ['reg', '®']
]);

function decodeEntities(value = '') {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z][\da-z]+);?/gi, (match, entity) => {
    if (entity[0] === '#') {
      const radix = entity[1].toLowerCase() === 'x' ? 16 : 10;
      const number = Number.parseInt(entity.slice(radix === 16 ? 2 : 1), radix);
      return Number.isFinite(number) ? String.fromCodePoint(number) : match;
    }
    return ENTITY_MAP.get(entity.toLowerCase()) ?? match;
  });
}

function cleanText(value = '') {
  return decodeEntities(value)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

export function visibleText(html) {
  return cleanText(html
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<(svg|canvas|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' '));
}

/**
 * Mnogi izvori renderiraju sadržaj iz JS podatkovnih struktura
 * (`const BOATS = [{...}]`), pa `visibleText` vidi samo prazan kostur.
 * Ovdje se iz inline skripti vade string literali koji izgledaju kao
 * ljudski tekst — bez ključeva objekata, identifikatora i base64 podataka.
 */
export function isProse(value) {
  const text = (value || '').trim();
  if (text.length < 2 || text.length > 600) return false;
  if (/^(https?:|data:|mailto:|tel:|[./#@])/i.test(text)) return false;
  if (/^#?[0-9a-f]{3,8}$/i.test(text)) return false;
  if (/^[\d\s.,:%+/-]+$/.test(text)) return false;
  if (/^[a-z]+(\s*,\s*[a-z]+)+$/i.test(text)) return false;          // CSS selektor lista
  const letters = (text.match(/\p{L}/gu) || []).length;
  if (letters < 2 || letters / text.length < 0.45) return false;
  if (!/\s/.test(text) && /^[a-z][a-z0-9_-]*$/i.test(text) && text.length < 14) return false;
  if (/[<>{}()[\]=;|&]/.test(text) && !/\p{L}\s+\p{L}+\s+\p{L}/u.test(text)) return false;
  return true;
}

export function scriptText(html) {
  const found = new Set();
  for (const block of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc\s*=/i.test(block[1])) continue;
    const source = block[2]
      .replace(/data:[a-z0-9/.+-]+;base64,[A-Za-z0-9+/=\s]*/gi, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ');
    // Nizovi se hvataju u paru; neomeđena duljina sprječava pomak
    // u parovima navodnika kod dugih opisa.
    for (const literal of source.matchAll(/"((?:[^"\\\n]|\\.)*)"(\s*:)?|'((?:[^'\\\n]|\\.)*)'(\s*:)?/g)) {
      if (literal[2] || literal[4]) continue;   // "kljuc": → preskoči
      const value = decodeEntities((literal[1] ?? literal[3] ?? '').replace(/\\[nrt]/g, ' ')).trim();
      if (isProse(value)) found.add(value);
    }
  }
  return [...found].join(' · ');
}

function getAttributes(tag = '') {
  const attributes = new Map();
  const pattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) {
    attributes.set(match[1].toLowerCase(), decodeEntities(match[2] ?? match[3] ?? match[4] ?? ''));
  }
  return attributes;
}

export function metaValues(html) {
  const values = new Map();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = getAttributes(match[0]);
    const key = (attrs.get('name') || attrs.get('property') || '').toLowerCase();
    if (key && attrs.has('content')) {
      const current = values.get(key) || [];
      current.push(attrs.get('content'));
      values.set(key, current);
    }
  }
  return values;
}

function firstTagContent(html, tagName) {
  const match = html.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}\\s*>`, 'i'));
  return cleanText(match?.[1] || '');
}

function humanizeFilename(filePath) {
  return path.basename(filePath, path.extname(filePath))
    .replace(/[-_]+/g, ' ')
    .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase('hr'));
}

function firstUsefulParagraph(html) {
  for (const match of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)) {
    const text = cleanText(match[1]);
    if (text.length >= 48) return text;
  }
  return '';
}

export function trimDescription(value, fallback) {
  const text = cleanText(value) || fallback;
  if (text.length <= 210) return text;
  const shortened = text.slice(0, 207).replace(/\s+\S*$/, '');
  return `${shortened}…`;
}

function normalizeForSearch(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('hr');
}

function automaticTags(meta, relativePath, title, description, content) {
  const explicit = [
    ...(meta.get('keywords') || []).flatMap((value) => value.split(/[,;]/)),
    ...(meta.get('article:tag') || []),
    ...(meta.get('category') || [])
  ].map(cleanText).filter(Boolean);

  const haystack = normalizeForSearch(`${title} ${title} ${description} ${content.slice(0, 50000)}`);
  const topicScores = TOPICS.map((topic) => ({
    tag: topic.tag,
    score: topic.terms.reduce((score, term) => {
      const matches = haystack.match(new RegExp(`\\b${normalizeForSearch(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*`, 'g'));
      return score + Math.min(matches?.length || 0, 8);
    }, 0)
  })).filter(({ score }) => score >= 2).sort((a, b) => b.score - a.score).slice(0, 3).map(({ tag }) => tag);

  const directoryTags = path.dirname(relativePath) === '.'
    ? []
    : path.dirname(relativePath).split(path.sep).map((directory) => directory.toLowerCase() === 'archive' ? 'Arhiva' : humanizeFilename(directory));

  return [...new Set([...explicit, ...topicScores, ...directoryTags])].slice(0, 6);
}

/* ═══════════════════════════════════════════════════════════
   Datum izmjene

   `mtime` je najslabiji izvor koji imamo: `git checkout` postavlja
   vrijeme clonea, pa bi na Cloudflareu svaki dokument dobio vrijeme
   builda. Sortiranje „nedavno" tada ne znači ništa, a svi datumi na
   karticama pokazuju isti dan. Zato se traži redom:

     1. datum upisan u samom dokumentu — putuje s datotekom
     2. datum zadnjeg commita koji ju je dirnuo
     3. mtime — zadnja linija obrane; build prijavi koliko ih je tu palo
   ═══════════════════════════════════════════════════════════ */

const DATE_META_KEYS = ['article:modified_time', 'article:published_time', 'date', 'dcterms.modified', 'last-modified'];

/**
 * Poredak po novosti.
 *
 * Uspoređuje se **dan**, ne točan trenutak. Datum upisan u dokument
 * nema sate — normalizira se na podne UTC da ga pomak vremenske zone
 * ne odgurne na susjedni dan — pa bi u izravnoj usporedbi izgubio od
 * svake datoteke dirnute isti dan poslije podneva. To nije razlika u
 * starosti nego razlika u preciznosti izvora.
 *
 * Unutar istog dana prednost ima eksplicitniji izvor: datum iz
 * dokumenta > datum iz gita > mtime.
 */
const DATE_SOURCE_RANK = { meta: 0, git: 1, mtime: 2 };

export function byRecency(a, b) {
  const dayA = a.modifiedAt.slice(0, 10);
  const dayB = b.modifiedAt.slice(0, 10);
  if (dayA !== dayB) return dayB.localeCompare(dayA);

  const rank = (DATE_SOURCE_RANK[a.dateSource] ?? 3) - (DATE_SOURCE_RANK[b.dateSource] ?? 3);
  if (rank) return rank;

  return b.modifiedAt.localeCompare(a.modifiedAt) || a.title.localeCompare(b.title, 'hr');
}

function isoDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return null;
  // Goli datum bez vremena postaje podne UTC, da pomak vremenske zone
  // ne odgurne dokument na susjedni dan.
  const parsed = new Date(text.length <= 10 ? `${text}T12:00:00Z` : text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function declaredDate(html, meta) {
  for (const key of DATE_META_KEYS) {
    const found = isoDate(meta.get(key)?.[0]);
    if (found) return found;
  }
  return isoDate(html.match(/<time\b[^>]*\bdatetime\s*=\s*["']([^"']+)["']/i)?.[1]);
}

/**
 * Datum zadnjeg commita po putanji, iz jednog poziva gita.
 *
 * Tiho vraća prazno kad gita nema ili je clone bez povijesti — tada
 * ostaje `mtime`, a build ispiše koliko dokumenata je na njemu završilo.
 */
function gitDates() {
  const dates = new Map();
  try {
    const log = execFileSync('git', ['log', '--pretty=format:%cI', '--name-only', '--', 'sources'], {
      cwd: projectRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore']
    });
    let stamp = null;
    for (const line of log.split('\n')) {
      const text = line.trim();
      if (!text) continue;
      // Datum uvijek nosi „T"; nazivi datoteka završavaju na .html.
      if (/^\d{4}-\d{2}-\d{2}T/.test(text)) { stamp = text; continue; }
      // Log ide od najnovijeg, pa prvi pogodak po putanji i jest zadnji commit.
      if (stamp && !dates.has(text)) dates.set(text, new Date(stamp).toISOString());
    }
  } catch { /* nema gita ili nema povijesti */ }

  // Jedan datum za sve datoteke ne govori ništa o poretku — tako izgleda
  // plitki clone, ali i repozitorij u koji je sve ušlo jednim commitom.
  // U oba slučaja je mtime barem lokalno informativniji, a u CI-ju je
  // jednako neupotrebljiv, pa se ovime ništa ne gubi.
  if (dates.size > 1 && new Set(dates.values()).size === 1) return new Map();
  return dates;
}

function findImageSource(html, meta) {
  const metaImage = meta.get('og:image')?.[0] || meta.get('twitter:image')?.[0];
  if (metaImage) return metaImage;
  const imageTag = html.match(/<img\b[^>]*>/i)?.[0];
  return imageTag ? getAttributes(imageTag).get('src') || '' : '';
}

/* SVG je dopušten jer se slika uvijek prikazuje kroz `<img src>`, a tamo
   se skripte u SVG-u ne izvršavaju. Za ručno napisanu sličicu to je
   najlakši put — nekoliko stotina bajta u samom alatu, bez binarnih
   datoteka u repozitoriju. */
const IMAGE_TYPES = ['avif', 'gif', 'jpg', 'png', 'svg', 'webp'];

/**
 * Slika iz dokumenta postaje datoteka uz katalog.
 *
 * Vraća i razlog odbijanja, da build može prijaviti kad je slika
 * upisana ali neupotrebljiva — inače kartica ostane prazna bez ijedne
 * riječi objašnjenja, a najčešća greška (relativna putanja) izgleda
 * točno kao da slike nema.
 */
async function materializeImage(imageSource, thumbnailsDirectory) {
  if (!imageSource) return { image: null, skipped: null };

  if (/^data:image\//i.test(imageSource)) {
    const match = imageSource.match(/^data:image\/([a-z0-9.+-]+)(;base64)?,([\s\S]+)$/i);
    if (!match) return { image: null, skipped: 'neispravan data: URI' };
    const extensionMap = { 'jpeg': 'jpg', 'svg+xml': 'svg' };
    const extension = extensionMap[match[1].toLowerCase()] || match[1].toLowerCase();
    if (!IMAGE_TYPES.includes(extension)) return { image: null, skipped: `nepodržan format ${extension}` };
    const buffer = match[2] ? Buffer.from(match[3].replace(/\s/g, ''), 'base64') : Buffer.from(decodeURIComponent(match[3]));
    if (!buffer.length) return { image: null, skipped: 'prazna slika' };
    const name = `${createHash('sha256').update(buffer).digest('hex').slice(0, 18)}.${extension}`;
    await mkdir(thumbnailsDirectory, { recursive: true });
    await writeFile(path.join(thumbnailsDirectory, name), buffer);
    return { image: `thumbnails/${name}`, skipped: null };
  }

  if (/^(https?:)?\/\//i.test(imageSource)) return { image: imageSource, skipped: null };

  // Dokument se kopira na drugu putanju, pa relativna referenca vodi u prazno.
  return { image: null, skipped: 'relativna putanja' };
}

async function htmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(directory, entry.name);
    // `sources/deleted/` je koš za smeće admina — sadržaj ostaje u
    // repozitoriju radi vraćanja, ali se nikad ne indeksira ni servira.
    const relative = path.relative(sourcesRoot, fullPath).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (`sources/${relative}/` === DELETED_DIR) continue;
      files.push(...await htmlFiles(fullPath));
    }
    if (entry.isFile() && /\.html?$/i.test(entry.name)) files.push(fullPath);
  }
  return files;
}

/**
 * Povezuje arhivske kopije s njihovim izvornikom.
 *
 * Kartica se prikazuje samo za "glavu" loze — aktivni dokument ako
 * postoji, inače najnoviju arhiviranu verziju (slučaj kad je nešto
 * arhivirano izravno i nikad zamijenjeno). Ostale verzije žive u
 * `versions` i dostupne su kroz vremensku crtu, ali ne troše mjesto u
 * katalogu ni u pretrazi.
 */
export function groupVersions(items) {
  const lineages = new Map();
  for (const item of items) {
    const { key, stampedAt, sequence } = lineageOf(`sources/${item.path}`);
    item.lineage = key;
    item.sequence = sequence;
    item.archivedAt = stampedAt || (item.isArchive ? item.modifiedAt.slice(0, 10) : null);
    if (!lineages.has(key)) lineages.set(key, []);
    lineages.get(key).push(item);
  }

  const visible = [];
  for (const [key, members] of lineages) {
    const active = members.filter((item) => !item.isArchive);
    // `foo.html` i `foo.htm` daju isti ključ loze i natjecali bi se za istu
    // adresu. Bez ove provjere druga datoteka tiho ostane bez `url`-a, a
    // build pukne tek pri kopiranju — na mjestu koje o uzroku ne govori ništa.
    if (active.length > 1) {
      const names = active.map((item) => item.path).sort().join(', ');
      throw new Error(`Dvije aktivne datoteke dijele lozu „${key}": ${names}. Preimenuj jednu.`);
    }
    // Redni broj razdvaja verzije arhivirane isti dan. Bez njega ih dijeli
    // samo `modifiedAt`, koji je u CI-ju za sve datoteke isti, pa bi im
    // redoslijed ovisio o okolini u kojoj se build vrti.
    const archived = members.filter((item) => item.isArchive)
      .sort((a, b) => (b.archivedAt || '').localeCompare(a.archivedAt || '')
        || (b.sequence - a.sequence)
        || b.modifiedAt.localeCompare(a.modifiedAt));

    // bez aktivne verzije glava postaje najnovija arhivirana
    const head = active[0] || archived.shift();
    if (!head) continue;

    const ordered = [head, ...archived];

    // Adrese se dodjeljuju tek ovdje, jer tek sad znamo tko je glava.
    for (const [index, item] of ordered.entries()) {
      item.url = urlFor(item, index === 0);
    }

    head.versions = ordered.map((item, index) => ({
      url: item.url,
      path: item.path,
      title: item.title,
      bytes: item.bytes,
      modifiedAt: item.modifiedAt,
      archivedAt: index === 0 && !head.isArchive ? null : item.archivedAt,
      current: index === 0
    }));

    visible.push(head);
  }
  return visible;
}

async function indexFile(filePath, thumbnailsDirectory, dates) {
  const [html, fileStats] = await Promise.all([readFile(filePath, 'utf8'), stat(filePath)]);
  const relativePath = path.relative(sourcesRoot, filePath);
  const posixPath = safeName(relativePath.split(path.sep).join('/'));
  const repoPath = `sources/${posixPath}`;
  const meta = metaValues(html);
  const markup = visibleText(html);
  const scripted = scriptText(html);
  const content = [markup, scripted].filter(Boolean).join(' · ');
  const title = cleanText(meta.get('og:title')?.[0]) || firstTagContent(html, 'title') || firstTagContent(html, 'h1') || humanizeFilename(filePath);
  const rawDescription = meta.get('description')?.[0] || meta.get('og:description')?.[0] || firstUsefulParagraph(html);
  const description = trimDescription(rawDescription, `Otvori alat “${title}”.`);
  const tags = automaticTags(meta, relativePath, title, description, content);
  const { image, skipped: imageSkipped } = await materializeImage(findImageSource(html, meta), thumbnailsDirectory);

  const themeColor = cleanText(meta.get('theme-color')?.[0]) || null;
  const accentColor = cleanText(meta.get('accent-color')?.[0]) || null;
  const appName = cleanText(meta.get('application-name')?.[0]) || null;

  const declared = declaredDate(html, meta);
  const fromGit = dates.get(repoPath) || null;

  return {
    id: createHash('sha1').update(relativePath).digest('hex').slice(0, 12),
    title,
    description,
    tags: tags.length ? tags : ['Alat'],
    image,
    imageSkipped,
    path: relativePath.split(path.sep).join('/'),
    isArchive: stateOf(repoPath) === 'archive',
    bytes: fileStats.size,
    modifiedAt: declared || fromGit || fileStats.mtime.toISOString(),
    dateSource: declared ? 'meta' : fromGit ? 'git' : 'mtime',
    // Normalizacija za pretragu radi se u pregledniku pri učitavanju —
    // prije se uz `content` slao i gotovo identičan `searchText`, što je
    // udvostručavalo indeks bez ikakve koristi.
    content,
    scriptChars: scripted.length,
    themeColor,
    accentColor,
    appName,
    sourceFile: filePath
  };
}

function headersFile() {
  return `# Zbirka alata.
/*
  X-Robots-Tag: noindex, nofollow, noarchive, nosnippet
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer

# Alati se dijele linkom, pa smiju kratko živjeti u cacheu.
/${PUBLIC_DIR}/*
  Cache-Control: public, max-age=300, must-revalidate

/favicon.svg
  Cache-Control: public, max-age=86400

# Worker mora smjeti provjeriti ima li novoga, inače nova verzija čeka
# na istek cachea umjesto na sljedeće otvaranje.
/sw.js
  Cache-Control: no-cache

/*.webmanifest
  Content-Type: application/manifest+json; charset=utf-8
  Cache-Control: public, max-age=3600

# Ikone se mijenjaju samo kad alat promijeni boje.
/icons/*
  Cache-Control: public, max-age=604800
/${PUBLIC_DIR}/icons/*
  Cache-Control: public, max-age=604800

# Indeks se mijenja sa svakim buildom i nikad se ne smije poslužiti iz cachea.
/search-index.js
  Cache-Control: no-store
/search-index.json
  Cache-Control: no-store
`;
}

const ROBOTS_FILE = `User-agent: *
Disallow: /
`;

/**
 * Znak kataloga: šesterokut s probušenom rupom, isti kao u zaglavlju.
 *
 * Puna ploha, a ne obris — na 16 px obris se pretvori u mrlju. Jantar
 * se drži i na svijetloj i na tamnoj traci kartica, pa nema potrebe za
 * dvije inačice. Alati pod `/alat/` nose vlastiti dizajn i ovaj znak
 * ne dobivaju; build im ne dira sadržaj.
 */
const FAVICON_FILE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
<path fill="#d9a441" fill-rule="evenodd" d="M20 2.4 35.2 11.2v17.6L20 37.6 4.8 28.8V11.2Zm0 11.2a6.4 6.4 0 1 0 0 12.8 6.4 6.4 0 0 0 0-12.8Z"/>
</svg>
`;

/**
 * Pages servira ovu stranicu za svaki promašaj, pa `/` i nasumična
 * putanja izgledaju identično — nema signala koji bi potvrdio da je
 * netko „blizu" prave adrese. Zato ovdje nema ni imena sustava ni
 * ijednog nagovještaja putanje.
 */
const NOT_FOUND_FILE = `<!doctype html>
<html lang="hr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>404</title>
<style>
  :root { color-scheme: light }
  * { box-sizing: border-box }
  body {
    display: grid; place-items: center; min-height: 100svh; margin: 0;
    background: #d7d3c8;
    background-image:
      radial-gradient(circle at center, rgba(21,20,14,.085) 1.6px, transparent 1.7px),
      linear-gradient(rgba(21,20,14,.05) 1px, transparent 1px),
      linear-gradient(90deg, rgba(21,20,14,.05) 1px, transparent 1px);
    background-size: 48px 48px, 16px 16px, 16px 16px;
    background-position: 24px 24px, 0 0, 0 0;
    color: #15140e;
    font: 400 15px/1.55 Futura, "Century Gothic", "Trebuchet MS", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  main { padding: 0 6vw; text-align: center }
  .slab {
    padding: clamp(10px, 2vw, 22px) clamp(20px, 4vw, 46px);
    border: 4px solid #15140e; background: #15140e;
    box-shadow: 7px 7px 0 rgba(21, 20, 14, .3);
  }
  .mark {
    margin: 0; color: #ffc400;
    font: 400 clamp(4.4rem, 20vw, 11rem)/.86 "Haettenschweiler", "Arial Narrow Bold", Impact, sans-serif;
    letter-spacing: .04em;
  }
  .stripe {
    height: 8px; margin: 22px auto 20px; max-width: 260px;
    background-image: repeating-linear-gradient(-45deg, #ffc400 0 10px, transparent 10px 20px);
  }
  .note {
    margin: 0; color: #837d6c;
    font: 400 .6rem/1.8 "American Typewriter", "Courier New", monospace;
    letter-spacing: .3em; text-transform: uppercase;
  }
</style>
</head>
<body>
<main>
  <div class="slab"><p class="mark">404</p></div>
  <div class="stripe"></div>
  <p class="note">Ovdje nema ničega</p>
</main>
</body>
</html>
`;

/**
 * Ikone i manifest jedne aplikacije.
 *
 * Ikone se crtaju u kodu, pa ih nema u repozitoriju i ne treba ih
 * osvježavati rukom kad alat promijeni boje — vidi `lib/pwa.js`.
 */
async function writeAppFiles(directory, base, colors, manifest) {
  await mkdir(path.join(directory, 'icons'), { recursive: true });
  const icon = (suffix) => path.join(directory, 'icons', `${base}${suffix}`);
  await Promise.all([
    writeFile(icon('.svg'), iconSvg(colors)),
    writeFile(icon('-192.png'), iconPng(192, colors)),
    writeFile(icon('-512.png'), iconPng(512, colors)),
    // Maskirana inačica: Android joj odreže sve izvan središnjeg kruga,
    // pa znak mora biti manji, a podloga sezati do ruba.
    writeFile(icon('-mask.png'), iconPng(512, { ...colors, mark: 0.42 })),
    writeFile(path.join(directory, `${base}.webmanifest`), manifest)
  ]);
}

export async function buildIndex({ quiet = false, dev = false } = {}) {

  // Sve je javno i na jednom mjestu: katalog na korijenu, alati pod
  // /alat/. Nema skrivenih putanja jer nema što skrivati.
  const appOutRoot = distRoot;
  const documentsRoot = path.join(distRoot, PUBLIC_DIR);
  // Thumbnailovi idu uz aplikaciju, jer ih indeks nosi kao relativne
  // putanje (`thumbnails/<hash>.webp`) — ostanu li na korijenu, katalog
  // pod `/<app>/` traži ih na krivom mjestu.
  const thumbnailsRoot = path.join(appOutRoot, 'thumbnails');

  // dist je u cijelosti izvedeno stanje; brisanje je jedini pouzdan
  // način da nestanu slugovi i thumbnailovi obrisanih izvora.
  await rm(distRoot, { recursive: true, force: true });
  await mkdir(documentsRoot, { recursive: true });

  const files = (await htmlFiles(sourcesRoot)).sort((a, b) => a.localeCompare(b, 'hr'));
  const dates = gitDates();
  const indexed = await Promise.all(files.map((file) => indexFile(file, thumbnailsRoot, dates)));

  const items = groupVersions(indexed);
  items.sort(byRecency);

  const collisions = indexed.length - new Set(indexed.map((item) => item.url)).size;
  if (collisions) throw new Error(`${collisions} kolizija adresa — dva dokumenta bi dobila isti URL.`);

  /* Javna kopija pod čitljivom adresom. Alati nisu tajni pa postoji
     samo jedna kopija — nema više odvojene „za dijeljenje" i „čitljive".

     Glava loze uz to dobiva manifest, ikone i registraciju workera, pa
     se svaki alat da instalirati zasebno. Ubacuje se u kopiju, nikad u
     izvor: `sources/` ostaje čist, a novi alat postaje aplikacija bez
     ijednog retka koji bi autor morao zapamtiti.

     Starije verzije ostaju doslovna kopija — one su povijest, ne
     aplikacija; worker ih svejedno posluži bez mreže kad ih otvoriš. */
  const heads = new Set(items.map((item) => item.id));

  await Promise.all(indexed.map(async (item) => {
    const target = path.join(distRoot, item.url.replace(/^\//, ''));
    await mkdir(path.dirname(target), { recursive: true });

    if (!heads.has(item.id)) {
      await copyFile(item.sourceFile, target);
      return;
    }

    const colors = {
      bg: item.themeColor || DEFAULT_THEME,
      fg: item.accentColor || DEFAULT_ACCENT
    };
    const base = item.lineage.split('/').pop();

    await writeAppFiles(documentsRoot, base, colors, manifestFor({
      name: item.title,
      short: shortName(item.title, item.appName),
      description: item.description,
      startUrl: item.url,
      scope: `/${PUBLIC_DIR}/`,
      theme: colors.bg,
      background: colors.bg,
      iconBase: `/${PUBLIC_DIR}/icons/${base}`
    }));

    const html = await readFile(item.sourceFile, 'utf8');
    await writeFile(target, injectPwa(html, {
      manifestHref: `/${PUBLIC_DIR}/${base}.webmanifest`,
      iconHref: `/${PUBLIC_DIR}/icons/${base}-192.png`,
      theme: colors.bg,
      hasThemeColor: Boolean(item.themeColor)
    }));
  }));

  const data = {
    version: 4,
    dev,
    generatedAt: new Date().toISOString(),
    // `dateSource` ide van jer po njemu i preglednik slaže „Najnovije";
    // bez njega bi klijentsko sortiranje odstupalo od build poretka.
    items: items.map(({ sourceFile, scriptChars, imageSkipped, themeColor, accentColor, appName,
      lineage, sequence, archivedAt, bytes, versions, ...item }) => ({
      ...item,
      versions: versions.map(({ bytes: _bytes, ...version }) => version)
    }))
  };
  const json = JSON.stringify(data);

  // Katalog, indeks i thumbnailovi idu na korijen — sve je javno.
  await Promise.all([
    writeFile(path.join(appOutRoot, 'search-index.json'), `${JSON.stringify(data, null, 2)}\n`),
    writeFile(path.join(appOutRoot, 'search-index.js'), `window.__WORKSHOP_INDEX__ = ${json.replace(/</g, '\\u003c')};\n`),
    readFile(path.join(appRoot, 'index.html'), 'utf8')
      .then((html) => writeFile(path.join(appOutRoot, 'index.html'),
        // Katalog manifest i workera nosi u izvoru; traka je zajednička
        // s alatima, pa dolazi odavde i ostaje ista na oba mjesta.
        html.replace('</body>', `${INSTALL_BAR}\n</body>`))),
    writeFile(path.join(distRoot, '_headers'), headersFile()),
    writeFile(path.join(distRoot, 'robots.txt'), ROBOTS_FILE),
    writeFile(path.join(distRoot, 'favicon.svg'), FAVICON_FILE),
    writeFile(path.join(distRoot, 'sw.js'), SERVICE_WORKER),
    writeAppFiles(distRoot, 'workshop', { bg: CATALOGUE_THEME, fg: DEFAULT_ACCENT }, manifestFor({
      name: 'Workshop — registar alata',
      short: 'Workshop',
      description: 'Pretraživi registar brzinskih alata.',
      startUrl: '/',
      scope: '/',
      theme: CATALOGUE_THEME,
      background: CATALOGUE_THEME,
      iconBase: '/icons/workshop'
    })),
    writeFile(path.join(distRoot, '404.html'), NOT_FOUND_FILE)
  ]);

  if (!quiet) {
    const withImages = items.filter((item) => item.image).length;
    const fromScripts = items.reduce((total, item) => total + item.scriptChars, 0);
    const totalChars = items.reduce((total, item) => total + item.content.length, 0);
    const olderVersions = indexed.length - items.length;
    const bySource = (name) => indexed.filter((item) => item.dateSource === name).length;
    console.log(`Indeksirano: ${items.length} ${items.length === 1 ? 'alat' : 'alata'} (${withImages} sa slikom, ${olderVersions} starijih verzija u arhivi).`);
    console.log(`Tekst za pretragu: ${totalChars.toLocaleString('hr-HR')} znakova, od toga ${fromScripts.toLocaleString('hr-HR')} iz JS podataka.`);
    console.log(`Datumi: ${bySource('meta')} iz dokumenta, ${bySource('git')} iz gita, ${bySource('mtime')} s mtimea.`);
    for (const item of indexed.filter((entry) => entry.imageSkipped)) {
      console.log(`Slika preskočena (${item.imageSkipped}): ${item.path}`);
    }
    console.log(`Indeks: ${Math.round(json.length / 1024)} kB`);
    console.log(`Aplikacije: ${items.length + 1} (katalog i svaki alat), ikone crtane u buildu.`);
    console.log('');
    console.log('  /'.padEnd(30) + 'katalog i pretraga');
    console.log(`  /${PUBLIC_DIR}/<naziv>.html`.padEnd(30) + 'alati — ovo dijeliš');
    console.log('');
  }

  return data;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  try {
    const data = await buildIndex();
    if (process.argv.includes('--check')) {
      const invalid = data.items.filter((item) => !item.title || !item.description || !item.url || !item.content);
      if (invalid.length) throw new Error(`${invalid.length} dokumenata nema potrebna indeksna polja.`);
      console.log('Provjera indeksa je prošla.');
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
