# TODO — OpenSet v0.5.0

Stato aggiornato a ogni passo. Protocollo di ripresa: vedi `CLAUDE.md`.
Branch: `release/v0.5.0` (da `main` a383a08); rilascio con PR verso `main`.
Obiettivo utente: coprire il più possibile le funzioni di AbleSet; Windows e
macOS obbligatori, Linux se costa poco. v0.5.0 = punti 6-9 della proposta del
2026-10-20 (confermati il 2026-10-21) + regola degli artefatti di rilascio
(versione nei nomi e all'avvio, guida PDF, icona ovunque).

## In corso

- [ ] v0.5.0 — S: editor della scaletta

## Da fare

### N — Versione visibile e nomi con la versione
- [x] RED: `/api/state` espone `version`; il CLI stampa `OpenSet <versione>` all'avvio
- [x] GREEN: banner nel terminale, versione e logo nell'intestazione della UI
- [x] Release CI: zip `openset-<versione>-<piattaforma>.zip`, programma `openset-<versione>[.exe]`; smoke test CI aggiornato (versione nello stato e prima riga del log); `INSTALL-*.txt` con `{{VERSION}}`; la release fallisce se il tag non coincide con `package.json`

### O — Icona ovunque
- [x] Logo nell'intestazione della UI (favicon e PWA già fatti), fatto in N
- [x] Icona del `.exe` Windows: `scripts/win-icon.mjs` (resedit) patcha il binario base di pkg prima dell'impacchettamento; `--check` in CI e nella release
- [x] macOS: `OpenSet <versione>.app` (`scripts/make-macos-app.sh`, `dist-extras/Info.plist`) con icona `.icns`, apre il Terminale con il server; lo smoke test CI su macOS avvia il programma dentro il bundle

### P — Guida PDF e CHANGELOG
- [x] RED `test/guide.test.js`: la guida generata contiene versione, novità della versione da `CHANGELOG.md` e i passi per Windows, macOS, Linux, iPad/iPhone
- [x] GREEN `scripts/build-guide.js` (HTML con logo → PDF con Chrome headless), `CHANGELOG.md` (0.1.0-0.4.0; la 0.5.0 al rilascio)
- [x] Release CI: `OpenSet-<versione>-Guida.pdf` dentro ogni zip e tra gli asset; la CI su Ubuntu genera la guida a ogni push

### Q — Dispositivi
- [x] RED: nome per dispositivo, lista dei connessi (nome, IP, pagina, latenza), OSC `/devices/showPage|reload|lock|unlock|toggleLock` con `all`, nome/tag o IP
- [x] GREEN: `server/devices.js`, server (lista, ping/latenza, comando `devices`, OSC `/devices/*`, valore `/devices/names`) + UI (nome, vista all'apertura, blocco ⇧L con sblocco a pressione lunga, lista in Opzioni)

### R — Modalità di salto e coda
- [x] RED: modalità Quantizzato, Fine sezione, Fine brano, Dinamico, Manuale; coda; J, ⇧J, C; OSC `/setlist/jumpToQueued`, `/setlist/clearQueuedJump`
- [x] GREEN motore + server: `jumpMode` nelle impostazioni, coda nello stato, `jumpToQueued`/`clearQueue`, salto in coda allo stop, OSC `/setlist/jumpToQueued`, `/setlist/clearQueuedJump`, valori `queuedName`/`queuedIndex`
- [x] GREEN UI: brano/sezione in coda evidenziati, barra «In coda» con salta / subito / annulla, tasti J, ⇧J, C, scelta della modalità in Opzioni

### S — Editor della scaletta
- [x] RED: ricerca approssimata (iniziali, parti del titolo, tag), scaletta come testo (`{nota}`, `-- stop --`) e incolla con match approssimato, backup a ogni sovrascrittura
- [x] GREEN server: `server/editor.js` (ricerca, testo, incolla approssimato), `GET /api/search`, `GET|POST /api/setlist-text`, backup a ogni sovrascrittura e `restoreBackup`
- [ ] GREEN UI: trascinamento anche touch, Ctrl+K, copia/incolla, togli/rimetti tutti, ripristino backup

### T — Safe Mode e password
- [ ] RED: Safe Mode (niente salti di brano dalla UI mentre suona, conferma prima della pausa; MIDI/OSC esclusi); password facoltativa (hash scrypt) per modificare e comandare dalla web app, `localhost` sempre ammesso
- [ ] GREEN: server + UI

### U — Rilascio v0.5.0
- [ ] Copertura, README, report TDD, guida PDF, CI verde, tag `v0.5.0`, asset verificati


### I — Cartella dati utente stabile
- [x] RED `test/datadir.test.js`: `dataDir(platform, env, home)` per macOS/Windows/Linux; migrazione che copia `setlist.json`, `lyrics/`, `custom.css` dalla cartella del programma senza sovrascrivere
- [x] GREEN `server/datadir.js`; il CLI usa la cartella dati come `baseDir`, `public/` resta nella cartella del programma

### J — Apertura automatica del browser
- [x] RED `test/launch.test.js`: `openCommand(platform, url)`, `parseArgs(argv)` (`--no-open`, `.als` primo argomento non-flag), errori dello spawn ignorati
- [x] GREEN `server/launch.js`; smoke test della CI con `--no-open`

### K — Installazione automatica del Remote Script
- [x] RED `test/install.test.js`: User Library per macOS/Windows, copia solo se manca o è diverso, niente `__pycache__`, nessuna eccezione; stato in `/api/state`
- [x] GREEN `server/install.js`; UI: passi per collegare Live quando non è connesso

### L — Connetti un dispositivo e porta 80
- [x] RED: `deviceUrls` (`nome.local` su macOS, IP LAN, niente `:80`), `/api/connect` con QR SVG, `httpPort` come lista (porta occupata → successiva)
- [x] GREEN `server/connect.js` + `qrcode-generator`; UI in Opzioni; CLI su `[80, 39080]`, `PORT` forza la porta

### M — Rilascio v0.4.0
- [x] `npm run coverage`: righe 99.79%, rami 93.48%, funzioni 98.50%; Remote Script 17 OK
- [x] README, `dist-extras/INSTALL-*.txt`, report `docs/releases/0.4.0/`, versione 0.4.0
- [x] CI verde (run 39495250973), ma il test del CLI scriveva nella home reale: isolato, smoke test che verifica la copia di `lyrics/`
- [x] CI verde dopo la correzione (run 39495681204: Windows/macOS/Ubuntu, copia di `lyrics/` nei 3 binari), tag `v0.4.0`

## Fatto

- [x] v0.3.1 rilasciata (PWA per iPad/iPhone): vedi `docs/releases/0.3.1/v0.3.1.tdd.md`
- [x] v0.3.0 rilasciata (sezioni e testi dal `.als`, mappa del tempo, durate misurate, annunci vocali, computer di riserva, Palco per dispositivo): vedi `docs/releases/0.3.0/v0.3.0.tdd.md`
- [x] v0.2.0 rilasciata (notazione AbleSet, motore, editor, Palco, OSC/HTTP/MIDI, macOS arm64): vedi `docs/releases/0.2.0/v0.2.0.tdd.md`

## Logo

- [x] Logo "anello aperto + play" (scelto dall'utente il 2026-10-21): `docs/brand/logo.svg`, `docs/brand/logo-wordmark.svg`, icone PWA 180/192/512 rigenerate

## Da decidere con l'utente

- Brani aggiunti a mano dalla UI, senza progetto Live (solo scaletta e testi):
  proposto il 2026-10-20, in attesa di risposta.

## Rimandato

Canvas libero, Bonjour per OSC, colori, scambio automatico dell'audio tra i due
computer (serve hardware), lettura dell'automazione del tempo da Live connesso
(l'API di Live non la espone: si usano le durate misurate).
