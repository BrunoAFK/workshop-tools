# Pomodoro — dizajn

Datum: 2026-08-21 · Grana: `pomodoro`

Alat za rad u krugovima: 25 minuta rada, kratka pauza, i duga nakon
četvrtog kruga. Ulazi u katalog kao i svaki drugi — jedna samostalna
HTML datoteka u `sources/`.

Osobitost je da izgled nije odlučen jednom za svagda. Jezgra ne zna kako
se crta, a prikaz se bira u postavkama — isto kao što `timer.html` nudi
`bar`, `deflate` i `fill` umjesto da bira jedan.

---

## Sadržaj

- [Opseg](#opseg)
- [Mjesto u projektu](#mjesto-u-projektu)
- [Boje i teme](#boje-i-teme)
- [Jezgra](#jezgra)
- [Prikazi](#prikazi)
- [Sloj: zadaci](#sloj-zadaci)
- [Sloj: tjedan](#sloj-tjedan)
- [Zvuk](#zvuk)
- [Obavijesti](#obavijesti)
- [Ekran, jezici, teme](#ekran-jezici-teme)
- [Sučelje](#sučelje)
- [Trajno stanje](#trajno-stanje)
- [Testiranje i provjera](#testiranje-i-provjera)
- [Rizici](#rizici)
- [Izvan opsega](#izvan-opsega)

---

## Opseg

U prvoj verziji ulazi sve: jezgra, četiri prikaza, oba sloja i puni rub
(zvuk, obavijesti, wake lock, tri jezika, dvije teme). Izlazi na veličinu
`timer.html` — 2500 do 3000 redaka, što je u ovom repozitoriju uobičajena,
a ne izuzetna veličina.

---

## Mjesto u projektu

| | |
| --- | --- |
| Izvor | `sources/pomodoro.html` |
| Javna adresa | `/alat/pomodoro.html` |
| Ključ loze | `pomodoro` |
| Doseg aplikacije | `/alat/pomodoro` |

Doseg se ne preklapa ni s `/alat/timer` ni s `/alat/box-breathing`, pa
provjera dosega u `build-index.mjs` neće prigovoriti.

### Zaglavlje

```html
<meta name="description" content="Pomodoro — rad u krugovima od 25 minuta s kratkim pauzama i dugom nakon četvrtog kruga. Četiri načina prikaza, popis zadataka s procjenom i tjedan iza tebe.">
<meta name="date" content="2026-08-21">
<meta name="theme-color" content="#faf8f3">
<meta name="accent-color" content="#c0503a">
<meta name="keywords" content="Vrijeme, Fokus">
<meta property="og:image" content="data:image/svg+xml,…">
<title>Pomodoro — krugovi rada i pauze</title>
```

`og:image` je ručno pisan SVG, kao u oba postojeća alata: traka ciklusa s
pokazivačem i brojkom. Nekoliko stotina bajta, bez binarne datoteke u
repozitoriju.

Alat mora ostati **samostalan** — nema relativnih referenci na vanjske
datoteke, jer se dokument kopira na drugu putanju.

---

## Boje i teme

Boja faze je jedina jaka boja u sučelju i znači isto u obje teme.

| Faza | Boja |
| --- | --- |
| Rad | `#c0503a` |
| Kratka pauza | `#4e8c66` |
| Duga pauza | `#d9a441` |

Podloge:

| Token | Dan | Noć |
| --- | --- | --- |
| `--bg` | `#faf8f3` | `#131316` |
| `--panel` | `#ffffff` | `#1b1b1f` |
| `--ink` | `#15140e` | `#ece9e2` |
| `--dim` | `#6f6a5c` | `#9a958a` |
| `--faint` | `#9a9484` | `#6b665c` |
| `--line` | `#e3ded1` | `#2c2c31` |

**Zadana tema je dan.** Pomodoro je alat za radne sate, a i katalog je
svijetao. `timer.html` ima obrnuto zadano jer se gleda u teretani.

Boje faza ostaju identične u obje teme. Iznimka je dopuštena samo ako
kontrast prema noćnoj podlozi padne ispod 3:1 za velik tekst — tada se
posvjetljuje **samo** noćna inačica, uz zadržan ton. Značenje se ne mijenja.

`syncThemeColor()` nakon promjene teme čita `--bg` i upisuje ga u
`<meta name="theme-color">`, pa se zatamni i traka preglednika.

---

## Jezgra

Jezgra ne dodiruje DOM. Piše se kao skup čistih funkcija, da se dade
izvući u `lib/` ako alat ikad dobije testove.

### Postavke

```js
const DEFAULTS = {
  rad: 25, kratka: 5, duga: 15, ciklus: 4,
  prikaz: 'traka',
  zadaciOn: true, tjedanOn: true,
  zvuk: true, tik: true,
  obavijesti: false, budan: true,
  autoPauza: true, autoRad: false,
  tema: 'dan', lang: null
};
```

`ciklus` je broj krugova rada do duge pauze.

### Tekuće stanje

```js
run = {
  faza: null,      // 'rad' | 'kratka' | 'duga' | null (mirno)
  krug: 0,         // koji krug rada u ciklusu, 0 … ciklus-1
  endsAt: null,    // ms epoch — kad tekuća faza istekne
  ostatak: null,   // ms — postavljeno samo dok je pauzirano
  zadatak: null    // id aktivnog zadatka
};
```

**Sprema se trenutak kraja, ne preostalo vrijeme.** Zatvoriš karticu i
vratiš se — alat iz sata zna je li faza u međuvremenu istekla. Da se
sprema preostalo, vrijeme provedeno zatvoreno bilo bi izgubljeno.

### Plan ciklusa

```js
plan()  // → [rad, kratka, rad, kratka, rad, kratka, rad, duga]
```

Za `ciklus` krugova: svaki krug je `rad`, iza njega `kratka`, osim iza
zadnjeg gdje je `duga`. Prikaz „traka" crta upravo ovaj niz.

### Izvedeno stanje

```js
stanje(sada = Date.now())
// → { mirno, faza, preostalo, udio, krug, udioSeanse, pauzirano }
```

- `preostalo` je `ostatak` kad je pauzirano, inače `endsAt - sada`
- `udio` je proteklo / trajanje faze, u rasponu 0…1
- `udioSeanse` je položaj unutar cijelog plana — treba samo prikazu „traka"
- `pauzirano` je istinito dok je `ostatak` postavljen

### Kraj faze

`zavrsiFazu()` se poziva iz tri mjesta:

1. iz petlje kad `preostalo <= 0`
2. iz `setTimeout` naoružanog na početku faze, kao rezerva
3. pri povratku na karticu (`visibilitychange`, `load`)

Sva tri mogu okinuti u istoj sekundi, pa funkcija na ulazu uzme `endsAt`
u lokalnu varijablu i odmah ga postavi na `null`. Drugi poziv zatekne
`null` i tiho izađe — bez toga jedan kraj faze zabilježi dva kruga.

Redoslijed:

1. ako je faza bila `rad`: `dani[danas]++`, aktivnom zadatku `ucinjeno++`, `krug++`
2. odredi sljedeću fazu iz plana
3. zvuk i obavijest
4. pokreni sljedeću fazu ako to dopušta `autoPauza` odnosno `autoRad`;
   inače stani u mirno stanje s pripremljenom sljedećom fazom

**Prijelazi su asimetrični po zadanome:** rad → pauza kreće sam, jer si
tada još za stolom. Pauza → rad traži tvoju odluku, jer bi inače timer
trčao prazan dok te nema. Oboje je prekidač u postavkama.

### Povratak nakon dugog izbivanja

Vratiš se nakon tri sata: alat obradi **točno jednu** isteklu fazu i
stane u mirno stanje uz poruku da je krug istekao dok te nije bilo.

Ne namotava propuštene krugove kroz cijelo razdoblje — tih pomodora nema
u dnevnom brojaču jer ih nisi odradio. Bez ovog pravila jedan zaboravljen
prozor preko noći ujutro javi trideset odrađenih krugova.

---

## Prikazi

Ugovor su dvije metode:

```js
PRIKAZI = {
  traka:    { ime, mount(el), paint(stanje) },
  znamenka: { … }, prsten: { … }, posuda: { … }
};
```

- `mount(el)` upiše svoj markup **jednom** i zapamti čvorove koje mijenja
- `paint(stanje)` mijenja samo vrijednosti — nikad ne gradi DOM iznova

Prebacivanje prikaza: `stage.replaceChildren()`, pa `mount`, pa `paint`.

| Prikaz | Što crta |
| --- | --- |
| `traka` | Plan ciklusa vodoravno, segmenti razmjerni trajanju; pokazivač putuje kroz njih, odrađeni segmenti blijede |
| `znamenka` | Brojka preko cijele širine; boja faze se povlači iz znamenki odozdo kako vrijeme curi |
| `prsten` | Kružni tijek, četiri točke ispod za krugove u ciklusu |
| `posuda` | Pješčani sat — gornji bulb se prazni, donji puni |

Petlja je jedan `requestAnimationFrame` koji čita sat. Tekst se prepisuje
tek kad se prikazana sekunda promijeni, da se ne piše u DOM 60 puta u
sekundi radi iste brojke.

Vrijeme se **uvijek čita iz sata**, nikad ne zbraja po okviru — inače
alat zaostane čim preglednik uspori karticu u pozadini.

---

## Sloj: zadaci

Uključuje se prekidačem `zadaciOn`.

```js
zadatak = { id, tekst, procjena, ucinjeno, gotov }
```

| Radnja | Kako |
| --- | --- |
| Dodavanje | Polje „Na čemu radiš?" + Enter |
| Procjena | Prikazuje se onoliko kvadratića kolika je procjena, plus jedan prazan. Klik na n-ti postavlja procjenu na n, klik na prazan je povećava. Raspon 1–8 |
| Aktiviranje | Klik na naziv — aktivan je jedan |
| Napredak | `ucinjeno++` kad krug rada završi, samo aktivnom |
| Gotovo | Klik na kružić lijevo — precrtan, ide na dno |
| Brisanje | `✕` na retku |
| Čišćenje | „Obriši gotove" u postavkama |

Aktivni zadatak ulazi u natpis obavijesti. To je i razlog zašto obavijest
uopće nešto govori — bez zadatka piše samo koja je faza gotova.

---

## Sloj: tjedan

Uključuje se prekidačem `tjedanOn`. Mreža zadnjih sedam dana ispod
prikaza; današnji stupac je istaknut.

```js
dani = { '2026-08-21': 5, '2026-08-20': 7, … }
```

**Čuva se samo brojka po danu** — ništa o zadacima. Nema što izvoziti i
nema pitanja o privatnosti.

- Dan se računa iz **lokalnog** datuma, ne `toISOString()`. Inače se
  brojač u našoj zoni resetira u dva ujutro.
- Visina mreže je `max(5, najveći broj među prikazanih sedam dana)`.
- Zapisi stariji od 60 dana se odbacuju pri spremanju.
- „Obriši povijest" stoji u postavkama.

---

## Zvuk

Tonovi se sintetiziraju u Web Audiju — nema datoteke koja se učitava, pa
alat ostaje jedna HTML datoteka i radi bez mreže. iOS pušta zvuk tek
nakon dodira, pa se kontekst otvara na prvi pritisak.

| Signal | Kada |
| --- | --- |
| Kraj rada | Topliji, dvotonski |
| Kraj pauze | Kraći, jedan ton |
| Tik | Zadnje tri sekunde faze, ako je `tik` uključen |

**Signal kraja se zakazuje u `AudioContext` čim faza počne.** To je jedini
način da zvuk stigne dok je kartica prigušena u pozadini; `timer.html`
isto radi u `scheduleSounds()`. Pauza i preskakanje moraju otkazati
zakazano, inače beep stigne za fazu koje više nema.

---

## Obavijesti

Idu kroz service worker, jer Chrome na Androidu ne dopušta
`new Notification()` sa stranice. Prekidač je zaključan dok alat nije
instaliran — u kartici preglednika alat ionako vidiš, a na iPhoneu su
obavijesti dopuštene samo aplikacijama na početnom zaslonu.

Obavijest nosi **sat u koliko faza završava**, ne odbrojavanje. Izračuna
se jednom i ne stari, pa se šalje samo kad se stanje stvarno promijeni.
Osvježavanje svake sekunde Chrome prijavljuje kao zlouporabu.

- Potpis zadnje poslane obavijesti — ista se ne šalje dvaput.
- Obavijest se **ne veže uz vidljivost** stranice; stoji dok faza traje.
- Tipke gdje `Notification.maxActions` to dopušta: **Pauza · Preskoči · Zaustavi**.
- Tekst nosi fazu, sat kraja i naziv aktivnog zadatka ako postoji.

Web ne može zakazati obavijest unaprijed — ako sustav uspava aplikaciju,
javka kasni. Zvuk ostaje pouzdaniji signal.

---

## Ekran, jezici, teme

- **Wake lock** dok traje faza rada, ako je `budan` uključen. Otpušta se
  na pauzi i u mirnom stanju.
- **Jezici** hr / en / de u jednom `STRINGS` objektu, s `LOCALES` za
  formatiranje brojeva i vremena. Zadani iz `navigator.languages`, izbor
  u postavkama ga nadjača i pamti se.
- **Teme** dan i noć, prekidač `T`.

---

## Sučelje

Kontrole stoje pri dnu, pa alat podiže traku za instalaciju iznad njih:

```css
:root { --install-offset: 92px }
```

### Prečaci

| Tipka | Radnja |
| --- | --- |
| `Space` | Kreni / pauziraj |
| `S` | Preskoči fazu |
| `R` | Resetiraj krug |
| `1`–`4` | Prikaz |
| `T` | Tema |
| `Esc` | Zatvori ladicu |

### Postavke

Ladica sa: prikazom, trajanjima (rad, kratka, duga, krugova do duge),
prijelazima, slojevima, zvukom, obavijestima, ekranom, temom, jezikom,
uputama i dvjema radnjama čišćenja.

---

## Trajno stanje

Jedan ključ, `workshop.pomodoro`:

```js
{ cfg: { … }, run: { … }, zadaci: [ … ], dani: { … } }
```

Čitanje tolerira nedostajuće grane i pada na `DEFAULTS`. Pisanje ide u
`try`/`catch` — privatni način zna zabraniti `localStorage`.

Piše se pri promjeni postavke i pri prijelazu faze, ne po sekundi.

---

## Testiranje i provjera

Alati u ovom repozitoriju nemaju testove, jer su jedna samostalna HTML
datoteka koju `node --test` ne može uvesti. Držimo se tog presedana.

Jezgra se ipak piše kao čiste funkcije bez dodira s DOM-om, da se dade
izvući u `lib/` ako alat ikad dobije testove.

Provjera prije zaključenja:

1. `npm test` — postojećih 42 testa i dalje prolaze
2. `npm run check` — alat ima naslov, opis, adresu i sadržaj
3. Katalog pokazuje karticu sa slikom, opisom, tagovima i datumom 2026-08-21
4. Sva četiri prikaza se prebacuju i crtaju točno
5. Zatvaranje i ponovno otvaranje kartice nastavlja odbrojavanje
6. Povratak nakon isteka obradi jednu fazu i stane
7. `dist/alat/pomodoro.webmanifest` ima `scope: "/alat/pomodoro"`
8. Ikone `pomodoro-192/512/mask.png` nose boje alata

---

## Rizici

| Rizik | Odgovor |
| --- | --- |
| Preglednik prigušuje karticu i odbrojavanje zaostane | Vrijeme se čita iz sata; zvuk se zakazuje unaprijed |
| Dnevni brojač se resetira u krivo doba | Lokalni datum, ne UTC |
| Duže izbivanje namota lažne krugove | Obradi se točno jedna istekla faza |
| Zakazani zvuk stigne nakon pauze ili preskakanja | Pauza i preskakanje otkazuju zakazano |
| Četiri prikaza povećaju datoteku preko granice čitljivosti | Prikazi su odvojeni objekti s ugovorom od dvije metode |
| Prebacivanje prikaza ostavi mrtve čvorove | `stage.replaceChildren()` prije `mount` |

---

## Izvan opsega

Namjerno ne ulazi u prvu verziju:

- izvoz ili sinkronizacija povijesti
- statistika dulja od tjedna
- gotovi obrasci (52/17, 90/20)
- više seansi u danu kao zaseban pojam
- dijeljenje zadataka s drugim alatima
