# Workshop — Alati

Pretraživi registar brzinskih alata — kalkulatora, konvertera, generatora, šalabahtera. Samostalnu HTML datoteku baciš u `sources/` i ona se sama pojavi u katalogu: s naslovom, opisom, tagovima, slikom i punim tekstom u pretrazi.

**Statičan sajt.** Nema backenda, nema baze, nema lozinke ni tokena. Build od `sources/` napravi `dist/`, i to je sve. Bez ijedne npm ovisnosti — generator je čisti Node, sučelje vanilla HTML/CSS/JS.

---

## Sadržaj

- [Zahtjevi](#zahtjevi)
- [Brzi start](#brzi-start)
- [Struktura projekta](#struktura-projekta)
- [Rute](#rute)
- [Kako radi indeksiranje](#kako-radi-indeksiranje)
- [Sučelje](#sučelje)
- [Jezici](#jezici)
- [Dizajn](#dizajn)
- [Deploy](#deploy)
- [Testovi](#testovi)
- [Rješavanje problema](#rješavanje-problema)

---

## Zahtjevi

**Node.js 24 ili noviji.** Ništa drugo — nema `npm install` koraka.

```bash
node -v      # → v24.x ili više
```

---

## Brzi start

```bash
npm run dev
```

| Naredba | Što radi |
| --- | --- |
| `npm run dev` | Lokalni server + watcher + live reload |
| `npm run build` | Generira `dist/` za objavu |
| `npm run check` | Isto, plus provjera da svaki alat ima obavezna polja |
| `npm test` | Testovi pravila putanja i generatora |

Port se mijenja varijablom `PORT` (zadano 4173).

### Otvaranje s mobitela

Dev server sluša na `0.0.0.0` pa uz lokalne ispisuje i mrežne adrese:

```
S mobitela na istoj mreži:
  http://192.168.2.3:4173/
```

Oba uređaja moraju biti na istoj mreži; prvi put macOS pita smije li Node primati dolazne veze. Gostinski i hotelski Wi-Fi često blokiraju promet među uređajima. Za povratak na samo svoje računalo: `HOST=127.0.0.1 npm run dev`.

---

## Struktura projekta

```
.
├── app/
│   └── index.html          # Katalog — sve sučelje u jednoj datoteci
├── lib/
│   └── paths.js            # Pravila loza i putanja
├── scripts/
│   ├── build-index.mjs     # Generator
│   └── dev.mjs             # Dev server + watcher + SSE
├── sources/                # ⬅ OVDJE se ubacuju alati
│   ├── timer.html
│   ├── archive/            # Starije verzije — u vremenskoj crti
│   └── deleted/            # Koš — build ih preskače
├── test/                   # Testovi generatora i pravila putanja
└── dist/                   # GENERIRANO — u .gitignore
```

**`sources/` je jedini direktorij koji uređuješ ručno.** Generator ga čita i nikad ne mijenja. Arhiviranje i brisanje su premještanje datoteke u `archive/` odnosno `deleted/`.

---

## Rute

Sve je javno i na jednom mjestu:

```
/                        katalog i pretraga
/alat/timer.html         alat — ovo dijeliš
/alat/v/archive/…        starija verzija
```

`sources/` se nikad ne servira — build svakom alatu radi kopiju pod `/alat/`.

### Javna adresa je trajna

Glava loze imenuje se po **ključu loze**, ne po putanji datoteke, pa podijeljen link preživi zamjenu novom verzijom:

| Radnja | Adresa |
| --- | --- |
| Rebuild | ista |
| Zamjena novom verzijom | ista — link uvijek vodi na najnoviju |
| Arhiviranje | **puca** — aktivne putanje više nema |
| Vraćanje iz arhive | ista kao prije |
| Preimenovanje datoteke | **mijenja se** |

Starije verzije stoje pod `/alat/v/<putanja>`; adresa im treba biti samo jedinstvena, dostupne su iz vremenske crte.

Zbog toga je **`v/` rezerviran naziv mape** u `sources/` — build ga odbije s objašnjenjem, umjesto da pusti dvije datoteke na istu adresu.

> Sajt nosi `X-Robots-Tag: noindex` i `robots.txt` sa `Disallow: /`. Adrese su pogodive i namijenjene dijeljenju, ali nisu u tražilicama. Ako želiš i to, obriši ta dva pravila u [`build-index.mjs`](scripts/build-index.mjs).

---

## Kako radi indeksiranje

Za svaku `.html` / `.htm` datoteku u `sources/`:

| Polje | Odakle |
| --- | --- |
| **Naslov** | `og:title` → `<title>` → prvi `<h1>` → naziv datoteke |
| **Opis** | `<meta name="description">` → `og:description` → prvi smisleni `<p>`, skraćen na 210 znakova |
| **Tagovi** | `keywords` / `article:tag` / `category` + bodovanje ključnih riječi + naziv podmape |
| **Slika** | `og:image` → `twitter:image` → prvi `<img>`; ugrađene slike postaju datoteke uz katalog — vidi [Slika na kartici](#slika-na-kartici) |
| **Sadržaj** | Vidljivi tekst **plus tekst izvučen iz inline `<script>` blokova** |

### Zašto se čita i JavaScript

Kod alata je to pravilo, a ne iznimka: prazan kostur u markupu, a sve što korisnik vidi stoji u JS strukturama:

```js
const STOPE = [{ "naziv": "Opća stopa PDV-a", "opis": "Vrijedi za većinu roba i usluga", ... }];
```

Generator iz inline skripti vadi string literale i zadržava one koji izgledaju kao ljudski tekst — preskaču se ključevi objekata, identifikatori, CSS selektori, URL-ovi i base64. Build ispisuje koliko je znakova došlo iz markupa, a koliko iz skripti:

```
Tekst za pretragu: 18.400 znakova, od toga 14.900 iz JS podataka.
```

### Slika na kartici

Kartica dobiva pojas 16:9 na vrhu kad dokument nosi sliku. Bez slike nema zamjenskog ukrasa — kartica je samo tekst.

Traži se `og:image`, pa `twitter:image`, pa prvi `<img>` u dokumentu. Prihvaćaju se dva oblika:

```html
<!-- Ugrađena slika — postaje datoteka uz katalog, s hešom u nazivu -->
<meta property="og:image" content="data:image/png;base64,iVBORw0KGgo…">

<!-- Ili apsolutna adresa na tuđem poslužitelju -->
<meta property="og:image" content="https://primjer.hr/slike/timer.png">
```

Formati: `avif`, `gif`, `jpg`, `png`, `svg`, `webp`.

**Najlakši put je ručno napisan SVG** — nekoliko stotina bajta u samom alatu, bez ijedne binarne datoteke u repozitoriju:

```html
<meta property="og:image" content="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 180'%3E%3Crect width='320' height='180' fill='%2312313f'/%3E%3Ccircle cx='160' cy='90' r='52' fill='none' stroke='%234fd8c4' stroke-width='7'/%3E%3C/svg%3E">
```

U takvom se URI-ju `#` piše kao `%23`, a `<` i `>` kao `%3C` i `%3E`; jednostruki navodnici u atributima prolaze kakvi jesu.

> **Relativne putanje se preskaču.** `content="./slike/timer.png"` ne radi — dokument se kopira na drugu putanju, pa referenca vodi u prazno. Build to prijavi imenom datoteke:
>
> ```
> Slika preskočena (relativna putanja): timer.html
> ```

Snimku zaslona alata možeš napraviti i lokalno, pa je ugraditi kao `data:` URI:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --hide-scrollbars --window-size=1200,675 \
  --screenshot=snimka.png "file://$PWD/sources/timer.html"
```

### Datum izmjene

Traži se ovim redom:

| Izvor | Pouzdanost |
| --- | --- |
| `<meta property="article:modified_time">`, `<meta name="date">`, `<time datetime>` | putuje s datotekom |
| datum zadnjeg commita koji je datoteku dirnuo | točan dok commitovi razdvajaju alate |
| `mtime` datoteke | **nepouzdan** — `git checkout` mu postavlja vrijeme clonea |

Datum iz gita se odbacuje kad je za sve datoteke jednak — takav je plitki clone i repozitorij u koji je sve ušlo jednim commitom. Lijek je upisati datum u sam dokument:

```html
<meta name="date" content="2026-08-18">
```

### Ograničenje: izvori moraju biti samostalni

Dokument se kopira na drugu putanju, pa **relativne reference na vanjske datoteke pucaju**. Slike i skripte moraju biti unutar same HTML datoteke.

---

## Sučelje

| | |
| --- | --- |
| **Pretraga** | Rangira po tome gdje pojam pada: naslov > tagovi > opis > sadržaj, s isječkom rečenice |
| **Prikazi** | Kartice (`G`) i gusti registar-popis (`L`) |
| **Otvaranje** | Klik bilo gdje po kartici ili retku otvara alat u novoj kartici |
| **Verzije** | Alat s više verzija dobiva gumb sa satom; on otvara vremensku crtu s razlikama |
| **Teme** | Dan (zadano) i noć (`T`) |
| **Jezici** | Hrvatski, engleski i njemački — vidi [Jezici](#jezici) |
| **URL stanje** | `#q=pdv&tag=Kalkulator&sort=recent` |
| **Tipkovnica** | `/` pretraga · `⌘K` skok · `J`/`K` kretanje · `G`/`L` prikaz · `T` tema · `Esc` zatvori |

---

## Jezici

Sučelje govori hrvatski, engleski i njemački. Zadani se bira iz preglednika (`navigator.languages`), izbor s globusa u zaglavlju pamti se u `localStorage` i nadjača ga.

Uz tekst se mijenja i **formatiranje brojeva i datuma** — `hr-HR`, `en-GB` ili `de-DE` — pa engleski katalog ne pokazuje hrvatske datume. Sve niske stoje u jednom `STRINGS` objektu na vrhu skripte u [`app/index.html`](app/index.html); novi jezik je jedan ključ više u `LANGS` i jedan blok u `STRINGS`.

**Sadržaj se ne prevodi.** Naslovi, opisi i automatski tagovi dolaze iz samih alata, pa ostaju na jeziku na kojem je alat napisan.

---

## Dizajn

Katalog je **namjerno tih**: sadržaj nosi stranicu, ukras ne postoji. Nema pozadinskih slojeva, nema hero sekcije, nema ulaznih animacija — stranica počinje pretragom, a odmah ispod je popis alata.

Pravila su kratka:

| | |
| --- | --- |
| **Pismo** | Jedno — sistemski sans. Monospace samo za brojeve, datume i oznake |
| **Linija** | 1 px, jedina debljina u sučelju. Bez sjena osim ispod ladice i palete |
| **Boja** | Neutralna podloga i jedan akcent (jantar) za aktivni filtar, pogodak i primarni gumb |
| **Razmaci** | Skala `--sp-1` … `--sp-7`, višekratnici od 4 px |
| **Kontrole** | Jedinstvena visina `--ctl-sm: 28px`, pa retci čine ravnu crtu umjesto stepenica |

Sve boje i mjere su tokeni u jednom bloku na vrhu [`app/index.html`](app/index.html), u dvije teme — `day` i `night`.

**Kartica pokazuje samo ono što pomaže odabrati alat:** kategorije, naslov, opis i — kad se pretražuje — isječak s pogotkom. Slika se prikaže ako je dokument nosi; kad je nema, ne stavlja se zamjenski ukras.

Cijela je kartica klikabilna. Vlastiti gumbi i poveznice u njoj rade svoje, a označavanje teksta se ne broji kao klik — inače bi svako povlačenje preko opisa otvorilo alat.

Znak kataloga je šesterokut s probušenom rupom. Isti oblik stoji u zaglavlju i u `favicon.svg`, koji build generira uz `robots.txt` i `404.html`.

Sami alati ne moraju pratiti taj jezik — svaki nosi vlastiti dizajn.

---

## Deploy

Statičan sajt, bilo gdje. Za Cloudflare Pages:

| Postavka | Vrijednost |
| --- | --- |
| Build command | `npm run build` |
| Build output directory | `dist` |
| `NODE_VERSION` | `24` |

Nema drugih varijabli okoline. Nema Functions direktorija.

---

## Testovi

```bash
npm test
```

Pokriveno je ono gdje tiha regresija ne ruši build nego samo osiromaši rezultat: izvlačenje teksta iz markupa i skripti, redoslijed datuma, pravila loza i oblik javnih adresa.

---

## Rješavanje problema

**Alat se ne pojavljuje u katalogu**
Provjeri da je u `sources/`, da ima nastavak `.html` i da nije u `deleted/`.

**Svi alati imaju isti datum**
Nijedan nema upisan datum, a git ih ne razdvaja. Dodaj `<meta name="date">`.

**Mobitel ne može otvoriti stranicu**
Upiši adresu koju server ispiše pod „S mobitela na istoj mreži". Oba uređaja moraju biti na istoj mreži; gostinski Wi-Fi često blokira promet među uređajima.

**Build javlja da dvije datoteke dijele lozu**
Dva aktivna dokumenta daju isti ključ loze — najčešće `foo.html` i `foo.htm` — pa bi se natjecali za istu adresu. Preimenuj jedan.

**Build javlja da je `v/` rezerviran naziv mape**
Pod `/alat/v/` žive starije verzije, pa mapa `sources/v/` može ciljati adresu koja je već nečija. Preimenuj mapu.

**Podijeljeni link vraća 404**
Alat je preimenovan, arhiviran ili u košu. Adresa je naziv datoteke, pa je preimenovanje mijenja.

**Slika se ne pojavljuje na kartici**
Pogledaj ispis builda — ako javi „Slika preskočena", piše i razlog. Najčešće je posrijedi relativna putanja; vidi [Slika na kartici](#slika-na-kartici).

**Indeks ne odgovara datotekama na disku**
`npm run build` pokrenut dok `npm run dev` već radi — oba brišu i pišu `dist/` pa se mogu preklopiti. Dev server sam sa sobom to više ne radi, ali dvije odvojene naredbe nemaju zajedničku bravu. Pusti dev server da odradi svoje ili ga ugasi prije ručnog builda.

**Watcher ne primjećuje promjene**
`fs.watch` na nekim mrežnim datotečnim sustavima ne javlja događaje. Restartaj `npm run dev`.
