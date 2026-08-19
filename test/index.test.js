/**
 * Generator indeksa: izvlačenje teksta, datumi, adrese i loze.
 *
 * Pokrivena su mjesta na kojima tiha regresija ne ruši build nego samo
 * osiromaši rezultat — pretraga koja odjednom ne nalazi pola sadržaja,
 * ili adresa koja se promijeni i razbije podijeljeni link.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  byRecency, declaredDate, groupVersions, isProse, metaValues,
  scriptText, trimDescription, urlFor, visibleText
} from '../scripts/build-index.mjs';

describe('urlFor', () => {
  it('glava ide po ključu loze, starije verzije po putanji', () => {
    const glava = { lineage: 'timer', path: 'timer.html' };
    const starija = { lineage: 'timer', path: 'archive/timer-2026-08-18.html' };
    assert.equal(urlFor(glava, true), '/alat/timer.html');
    assert.equal(urlFor(starija, false), '/alat/v/archive/timer-2026-08-18.html');
  });

  it('adresa je čitljiva, bez heša', () => {
    assert.match(urlFor({ lineage: 'pdv-kalkulator', path: 'pdv-kalkulator.html' }, true), /^\/alat\/pdv-kalkulator\.html$/);
  });

  it('podmapa ostaje u ključu loze', () => {
    assert.equal(urlFor({ lineage: 'racun/pdv', path: 'racun/pdv.html' }, true), '/alat/racun/pdv.html');
  });
});

describe('visibleText', () => {
  it('izbacuje skripte, stilove, komentare i svg', () => {
    const html = `<p>Vidljivo</p><script>var x = "skriveno"</script>
      <style>.a{color:red}</style><!-- komentar --><svg><title>ikona</title></svg>`;
    const text = visibleText(html);
    assert.match(text, /Vidljivo/);
    for (const izbaceno of ['skriveno', 'color', 'komentar', 'ikona']) {
      assert.doesNotMatch(text, new RegExp(izbaceno), izbaceno);
    }
  });

  it('razrješava entitete i sabija razmake', () => {
    assert.equal(visibleText('<p>a &amp;   b&nbsp;c</p>'), 'a & b c');
  });
});

describe('isProse', () => {
  it('prihvaća ljudske rečenice', () => {
    assert.ok(isProse('Otvoren trup, jednostrano veslo'));
    assert.ok(isProse('Prsluk za spašavanje mora imati ovratnik.'));
  });

  it('odbija tehničke nizove', () => {
    for (const smece of ['https://primjer.hr', '#4fd8c4', 'data:image/png;base64,AAAA', '12.5', 'div, span, p', 'itemName', './putanja']) {
      assert.equal(isProse(smece), false, smece);
    }
  });

  it('odbija prekratko i predugo', () => {
    assert.equal(isProse('a'), false);
    assert.equal(isProse('r'.repeat(601)), false);
  });
});

describe('scriptText', () => {
  it('vadi tekst iz podatkovnih struktura, bez ključeva objekata', () => {
    const html = `<script>
      const BOATS = [{ "name": "Kanu", "subtitle": "Otvoren trup, jednostrano veslo" }];
    </script>`;
    const text = scriptText(html);
    assert.match(text, /Otvoren trup/);
    assert.doesNotMatch(text, /"name"/, 'ključevi objekata se preskaču');
  });

  it('kratku riječ bez razmaka smatra identifikatorom i preskače je', () => {
    // Namjerna cijena postojeće heuristike: s „itemName" i „container"
    // ispadaju i kratki podatkovni nazivi poput „Kanu". Test je ovdje da
    // se promjena tog pravila vidi, a ne da se dogodi slučajno.
    assert.equal(isProse('Kanu'), false);
    assert.equal(isProse('itemName'), false);
    assert.ok(isProse('Kanu, otvoren trup'));
  });

  it('preskače vanjske skripte i base64 podatke', () => {
    assert.equal(scriptText('<script src="vanjska.js">const a = "tekst koji se ne broji";</script>'), '');
    assert.doesNotMatch(
      scriptText('<script>const slika = "data:image/png;base64,iVBORw0KGgoAAAA";</script>'),
      /iVBOR/
    );
  });

  it('ne prekida se na apostrofu unutar dvostrukih navodnika', () => {
    const text = scriptText(`<script>const a = "Nije to za svakoga"; const b = "Druga rečenica ovdje";</script>`);
    assert.match(text, /Nije to za svakoga/);
    assert.match(text, /Druga rečenica ovdje/);
  });

  it('istu rečenicu broji jednom', () => {
    const text = scriptText('<script>const a = "Ista rečenica"; const b = "Ista rečenica";</script>');
    assert.equal(text.split('Ista rečenica').length - 1, 1);
  });
});

describe('declaredDate', () => {
  const dateOf = (html) => declaredDate(html, metaValues(html));

  it('čita datum izmjene iz meta tagova', () => {
    assert.equal(dateOf('<meta property="article:modified_time" content="2026-03-04T10:00:00Z">'), '2026-03-04T10:00:00.000Z');
    assert.equal(dateOf('<meta name="date" content="2026-03-04">'), '2026-03-04T12:00:00.000Z');
  });

  it('datum izmjene ima prednost pred datumom objave', () => {
    const html = `<meta property="article:published_time" content="2020-01-01">
      <meta property="article:modified_time" content="2026-03-04">`;
    assert.equal(dateOf(html), '2026-03-04T12:00:00.000Z');
  });

  it('goli datum postaje podne UTC, da ne odluta na susjedni dan', () => {
    assert.match(dateOf('<meta name="date" content="2026-03-04">'), /^2026-03-04T12:00/);
  });

  it('pada na <time datetime> kad meta tagova nema', () => {
    assert.equal(dateOf('<p>Napisano <time datetime="2026-05-06">u svibnju</time></p>'), '2026-05-06T12:00:00.000Z');
  });

  it('vraća null kad datuma nema ili je neispravan', () => {
    assert.equal(dateOf('<p>bez datuma</p>'), null);
    assert.equal(dateOf('<meta name="date" content="jučer">'), null);
    assert.equal(dateOf('<meta name="date" content="2026-13-45">'), null);
  });
});

describe('byRecency', () => {
  const doc = (title, modifiedAt, dateSource) => ({ title, modifiedAt, dateSource });
  const order = (...items) => [...items].sort(byRecency).map((item) => item.title);

  it('noviji dan ide prvi', () => {
    assert.deepEqual(order(
      doc('stari', '2026-08-16T23:00:00.000Z', 'mtime'),
      doc('novi', '2026-08-17T01:00:00.000Z', 'mtime')
    ), ['novi', 'stari']);
  });

  it('datum iz dokumenta ne gubi od mtimea istog dana', () => {
    // Datum bez sati stoji na podne UTC. Prije se izravno uspoređivao s
    // mtimeom, pa je svaka datoteka dirnuta poslijepodne izgledala novija.
    assert.deepEqual(order(
      doc('dirnut popodne', '2026-08-17T13:32:00.000Z', 'mtime'),
      doc('upisan datum', '2026-08-17T12:00:00.000Z', 'meta')
    ), ['upisan datum', 'dirnut popodne']);
  });

  it('git je precizniji od mtimea, ali slabiji od upisanog datuma', () => {
    assert.deepEqual(order(
      doc('mtime', '2026-08-17T20:00:00.000Z', 'mtime'),
      doc('git', '2026-08-17T09:00:00.000Z', 'git'),
      doc('meta', '2026-08-17T12:00:00.000Z', 'meta')
    ), ['meta', 'git', 'mtime']);
  });

  it('unutar istog izvora i dana odlučuje vrijeme', () => {
    assert.deepEqual(order(
      doc('ranije', '2026-08-17T08:00:00.000Z', 'mtime'),
      doc('kasnije', '2026-08-17T18:00:00.000Z', 'mtime')
    ), ['kasnije', 'ranije']);
  });

  it('posve izjednačene stavke slaže naslov, da poredak bude determinističan', () => {
    // U CI-ju su svi mtimeovi jednaki; bez ovoga bi redoslijed ovisio o
    // redoslijedu čitanja datoteka.
    assert.deepEqual(order(
      doc('Beta', '2026-08-17T12:00:00.000Z', 'mtime'),
      doc('Alfa', '2026-08-17T12:00:00.000Z', 'mtime')
    ), ['Alfa', 'Beta']);
  });
});

describe('trimDescription', () => {
  it('krati na granici riječi i dodaje trotočje', () => {
    const opis = trimDescription('riječ '.repeat(60), 'zamjena');
    assert.ok(opis.length <= 211, opis.length);
    assert.match(opis, /…$/);
    assert.doesNotMatch(opis, /rije…$/, 'ne siječe usred riječi');
  });

  it('kratak opis ostaje netaknut', () => {
    assert.equal(trimDescription('Kratak opis.', 'zamjena'), 'Kratak opis.');
  });

  it('prazan opis pada na zamjenski tekst', () => {
    assert.equal(trimDescription('', 'zamjena'), 'zamjena');
  });
});

describe('groupVersions', () => {
  const doc = (path, isArchive, modifiedAt) => ({
    path, isArchive, modifiedAt, title: path, bytes: 10
  });

  it('karticu dobiva aktivna verzija, starije idu u vremensku crtu', () => {
    const visible = groupVersions([
      doc('foo.html', false, '2026-01-03T00:00:00.000Z'),
      doc('archive/foo-2026-01-02.html', true, '2026-01-02T00:00:00.000Z'),
      doc('archive/foo-2026-01-01.html', true, '2026-01-01T00:00:00.000Z')
    ]);

    assert.equal(visible.length, 1);
    assert.equal(visible[0].path, 'foo.html');
    assert.deepEqual(visible[0].versions.map((version) => version.path), [
      'foo.html', 'archive/foo-2026-01-02.html', 'archive/foo-2026-01-01.html'
    ]);
    assert.equal(visible[0].versions[0].current, true);
  });

  it('bez aktivne verzije glava postaje najnovija arhivirana', () => {
    const visible = groupVersions([
      doc('archive/foo-2026-01-01.html', true, '2026-01-01T00:00:00.000Z'),
      doc('archive/foo-2026-02-01.html', true, '2026-02-01T00:00:00.000Z')
    ]);

    assert.equal(visible.length, 1);
    assert.equal(visible[0].path, 'archive/foo-2026-02-01.html');
  });

  it('dvije verzije istog dana slaže redni broj, ne mtime', () => {
    // Svi mtimeovi su namjerno jednaki — točno ono što se dogodi u CI-ju
    // nakon checkouta. Redoslijed mora ostati određen.
    const isti = '2026-01-01T00:00:00.000Z';
    const visible = groupVersions([
      doc('archive/foo-2026-01-01.html', true, isti),
      doc('archive/foo-2026-01-01-3.html', true, isti),
      doc('archive/foo-2026-01-01-2.html', true, isti)
    ]);

    assert.deepEqual(visible[0].versions.map((version) => version.path), [
      'archive/foo-2026-01-01-3.html',
      'archive/foo-2026-01-01-2.html',
      'archive/foo-2026-01-01.html'
    ]);
  });

  it('adresa glave preživi arhiviranje jer ide po lozi, ne po putanji', () => {
    const kaoAktivan = groupVersions([doc('foo.html', false, '2026-01-02T00:00:00.000Z')]);
    const kaoArhiva = groupVersions([doc('archive/foo-2026-01-01.html', true, '2026-01-01T00:00:00.000Z')]);
    assert.equal(kaoAktivan[0].url, kaoArhiva[0].url);
  });

  it('starije verzije dobivaju vlastite, različite adrese', () => {
    const visible = groupVersions([
      doc('foo.html', false, '2026-01-02T00:00:00.000Z'),
      doc('archive/foo-2026-01-01.html', true, '2026-01-01T00:00:00.000Z')
    ]);
    const [glava, starija] = visible[0].versions;
    assert.equal(glava.url, '/alat/foo.html');
    assert.equal(starija.url, '/alat/v/archive/foo-2026-01-01.html');
    assert.notEqual(glava.url, starija.url);
  });

  it('adrese su čitljive, bez heša i bez tajne putanje', () => {
    const visible = groupVersions([doc('foo.html', false, '2026-01-01T00:00:00.000Z')]);
    assert.equal(visible[0].url, '/alat/foo.html');
    assert.equal(visible[0].readable, undefined);
  });

  it('različite loze ostaju odvojene', () => {
    const visible = groupVersions([
      doc('foo.html', false, '2026-01-01T00:00:00.000Z'),
      doc('bar.html', false, '2026-01-01T00:00:00.000Z')
    ]);
    assert.equal(visible.length, 2);
  });
});
