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

> Sajt nosi `X-Robots-Tag: noindex` i `robots.txt` sa `Disallow: /`. Adrese su pogodive i namijenjene dijeljenju, ali nisu u tražilicama. Ako želiš i to, obriši ta dva pravila u [`build-index.mjs`](scripts/build-index.mjs).

---

## Kako radi indeksiranje

Za svaku `.html` / `.htm` datoteku u `sources/`:

| Polje | Odakle |
| --- | --- |
| **Naslov** | `og:title` → `<title>` → prvi `<h1>` → naziv datoteke |
| **Opis** | `<meta name="description">` → `og:description` → prvi smisleni `<p>`, skraćen na 210 znakova |
| **Tagovi** | `keywords` / `article:tag` / `category` + bodovanje ključnih riječi + naziv podmape |
| **Slika** | `og:image` → `twitter:image` → prvi `<img>`; base64 slike postaju datoteke uz katalog |
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
| **Pregled** | Klik na karticu otvara alat u panelu |
| **Verzije** | Alat s više verzija dobiva vremensku crtu s razlikama |
| **Nacrti** | Alati bez slike dobivaju generiran nacrt dijela izveden iz `id`-a |
| **Teme** | Beton (zadano) i noćna smjena (`T`) |
| **URL stanje** | `#q=pdv&tag=Kalkulator&sort=recent` |
| **Tipkovnica** | `/` pretraga · `⌘K` skok · `J`/`K` kretanje · `G`/`L` prikaz · `T` tema · `Esc` natrag |

---

## Dizajn

Katalog je **industrijski katalog dijelova**: svijetla podloga, teška zbijena verzalna, pune crne linije, tvrde sjene bez zamućenja, sigurnosno žuta. Sve boje su tokeni u jednom bloku na vrhu [`app/index.html`](app/index.html).

Uz boje idu **skala razmaka** (`--sp-1` … `--sp-6`, višekratnici od 4 px) i **jedinstvena visina kontrole** (`--ctl: 32px`), pa retci alata čine ravnu crtu umjesto stepenica.

Nacrti na karticama nisu slike nego SVG izveden iz `id`-a alata: četiri obitelji dijelova, uvijek isti crtež za isti alat.

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

**Podijeljeni link vraća 404**
Alat je preimenovan, arhiviran ili u košu. Adresa je naziv datoteke, pa je preimenovanje mijenja.

**Watcher ne primjećuje promjene**
`fs.watch` na nekim mrežnim datotečnim sustavima ne javlja događaje. Restartaj `npm run dev`.
