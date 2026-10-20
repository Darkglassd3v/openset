# TODO — OpenSet v0.4.0

Stato aggiornato a ogni passo. Protocollo di ripresa: vedi `CLAUDE.md`.
Obiettivo utente: coprire il più possibile le funzioni di AbleSet; Windows e
macOS obbligatori, Linux se costa poco. v0.4.0 = punti 1-4 della proposta
"facile da avviare e da usare su tutti i dispositivi" (confermati il 2026-10-20).

## In corso

- [x] v0.4.0 rilasciata (run 39495893233): 4 zip con `remote-script/OpenSet`, nessun `__pycache__`

(nessun lavoro in corso: prossima proposta in "Da decidere", v0.5.0)

## Da fare

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

## Da decidere con l'utente

- Brani aggiunti a mano dalla UI, senza progetto Live (solo scaletta e testi):
  proposto il 2026-10-20, in attesa di risposta.
- v0.5.0 (resto della proposta del 2026-10-20 da https://ableset.com/docs/all,
  in attesa di conferma):
  1. Nome per dispositivo, vista predefinita, blocco (⇧L), lista dei dispositivi
     connessi; OSC `/devices/showPage` e `/devices/reload`.
  2. Modalità di salto (Quantizzato, Fine sezione, Fine brano, Dinamico, Manuale)
     con coda: J, ⇧J, C.
  3. Editor: trascinamento anche touch, Ctrl+K per cercare (iniziali, tag),
     copia/incolla della scaletta come testo con match approssimato, backup a
     ogni sovrascrittura.
  4. Safe Mode e password facoltativa per le modifiche.

## Rimandato

Canvas libero, Bonjour per OSC, colori, scambio automatico dell'audio tra i due
computer (serve hardware), lettura dell'automazione del tempo da Live connesso
(l'API di Live non la espone: si usano le durate misurate).
