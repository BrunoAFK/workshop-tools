/**
 * Pravila putanja.
 *
 * Iz njih generator izvodi loze. Pogriješi li ključ loze, dvije verzije
 * istog alata razdvoje se u dvije kartice, a javna adresa se promijeni.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lineageOf, stateOf } from '../lib/paths.js';

const today = new Date().toISOString().slice(0, 10);

describe('stateOf', () => {
  it('razlikuje aktivno, arhivu i koš', () => {
    assert.equal(stateOf('sources/foo.html'), 'active');
    assert.equal(stateOf('sources/archive/foo-2026-08-16.html'), 'archive');
    assert.equal(stateOf('sources/deleted/foo-2026-08-16.html'), 'deleted');
  });

  it('podmapa koja počinje kao „archive" nije arhiva', () => {
    assert.equal(stateOf('sources/archived-notes/foo.html'), 'active');
  });
});

describe('lineageOf', () => {
  it('aktivni dokument je sam svoja loza', () => {
    assert.deepEqual(lineageOf('sources/foo.html'), { key: 'foo', stampedAt: null, sequence: 1 });
  });

  it('arhivska kopija se veže na izvornik i nosi datum', () => {
    assert.deepEqual(lineageOf('sources/archive/foo-2026-08-16.html'),
      { key: 'foo', stampedAt: '2026-08-16', sequence: 1 });
  });

  it('druga kopija istog dana nosi redni broj', () => {
    assert.deepEqual(lineageOf('sources/archive/foo-2026-08-16-2.html'),
      { key: 'foo', stampedAt: '2026-08-16', sequence: 2 });
  });

  it('čuva strukturu mapa — inače se „sub/foo" i „sub-foo" sudare', () => {
    assert.equal(lineageOf('sources/archive/sub/foo-2026-08-16.html').key, 'sub/foo');
    assert.equal(lineageOf('sources/sub-foo.html').key, 'sub-foo');
    assert.notEqual(
      lineageOf('sources/archive/sub/foo-2026-08-16.html').key,
      lineageOf('sources/sub-foo.html').key
    );
  });

  it('arhivska kopija bez datuma zadržava puni naziv kao ključ', () => {
    assert.deepEqual(lineageOf('sources/archive/pdv-kalkulator.html'),
      { key: 'pdv-kalkulator', stampedAt: null, sequence: 1 });
  });

  it('aktivni dokument s datumom u nazivu ne gubi datum iz ključa', () => {
    // Aktivna putanja se ne raščlanjuje — inače bi „izvjestaj-2026-08-16.html"
    // završio u lozi „izvjestaj" i pojeo tuđe verzije.
    assert.equal(lineageOf('sources/izvjestaj-2026-08-16.html').key, 'izvjestaj-2026-08-16');
  });

  it('koš se veže na istu lozu kao arhiva', () => {
    assert.equal(lineageOf('sources/deleted/foo-2026-08-16.html').key, 'foo');
  });
});

