/**
 * Pravila putanja za generator.
 *
 * Iz njih se izvodi loza — koje su verzije istog alata, koja je glava i
 * kamo ide javna adresa. Sve ostalo (arhiviranje, brisanje, vraćanje)
 * radi se rukom u `sources/`, pa ovdje nema koda za to.
 */

export const ARCHIVE_DIR = 'sources/archive/';
export const DELETED_DIR = 'sources/deleted/';

export function stateOf(sourcePath) {
  if (sourcePath.startsWith(ARCHIVE_DIR)) return 'archive';
  if (sourcePath.startsWith(DELETED_DIR)) return 'deleted';
  return 'active';
}

/**
 * Ključ loze — sve verzije jednog alata dijele ga.
 *
 *   sources/foo.html                        → foo
 *   sources/archive/foo-2026-08-16.html     → foo, 2026-08-16, #1
 *   sources/archive/foo-2026-08-16-2.html   → foo, 2026-08-16, #2
 *   sources/archive/sub/foo-2026-08-16.html → sub/foo
 *   sources/archive/pdv-kalkulator.html     → pdv-kalkulator  (starije, bez datuma)
 *
 * Struktura mapa se namjerno čuva pri arhiviranju: da se spljošti u
 * crtice, `sub/foo.html` i `sub-foo.html` dobili bi isti ključ i „vrati"
 * ne bi znao kamo vratiti datoteku.
 *
 * `sequence` je redni broj unutar istog dana. Bez njega se dvije verzije
 * arhivirane isti dan ne mogu poredati, jer im je datum jednak, a `mtime`
 * u CI-ju nosi vrijeme checkouta i za sve je datoteke isti.
 */
export function lineageOf(sourcePath) {
  const state = stateOf(sourcePath);
  const prefix = state === 'archive' ? ARCHIVE_DIR : state === 'deleted' ? DELETED_DIR : 'sources/';
  const withoutPrefix = sourcePath.slice(prefix.length).replace(/\.html?$/i, '');

  if (state === 'active') return { key: withoutPrefix, stampedAt: null, sequence: 1 };

  const stamped = withoutPrefix.match(/^(.*?)-(\d{4}-\d{2}-\d{2})(?:-(\d+))?$/);
  return stamped
    ? { key: stamped[1], stampedAt: stamped[2], sequence: Number(stamped[3] || 1) }
    : { key: withoutPrefix, stampedAt: null, sequence: 1 };
}
