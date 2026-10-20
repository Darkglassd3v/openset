# TODO — OpenSet v0.3.0

Stato aggiornato a ogni passo. Protocollo di ripresa: vedi `CLAUDE.md`.
Obiettivo utente: coprire il più possibile le funzioni di AbleSet; Windows e
macOS obbligatori, Linux se costa poco. v0.3.0 = funzioni rimandate in v0.2.0.

## In corso

- [ ] v0.3.1 — PWA per iPad/iPhone (chiesta dall'utente il 2026-10-20)

## Da fare

### H — PWA (v0.3.1)
- [x] RED `test/server.test.js`: `/manifest.webmanifest` (standalone, icone PNG servite), meta iOS in `index.html`
- [x] GREEN: manifest, icone 180/192/512, meta `apple-mobile-web-app-*`, Wake Lock dove il browser lo permette, avviso per il Blocco automatico di iOS
- [x] Verifica in Chrome: manifest standalone con 3 icone, Wake Lock attivo su localhost, avviso Blocco automatico via IP (non sicuro), nessun errore in console
- [x] Copertura: righe 99.88%, rami 93.36%; report `docs/releases/0.3.1/`
- [ ] Push, CI verde, tag `v0.3.1`

### A — Sections e testi dal `.als` (offline)
- [x] RED `test/als-parser.test.js`: clip arrangement di `Sections` e `+LYRICS`, clip di sessione escluse, nomi tracce
- [x] GREEN `server/als-parser.js` → `tracks`; server offline usa `cuesFromLive`/`lyricsFromClips` anche col `.als`

### B — Durate con automazione del tempo (`.als`)
- [x] RED: mappa del tempo dal `.als` (punti FloatEvent del Tempo del Master), secondi tra due beat con rampe lineari
- [x] GREEN: `tempoMap` in `als-parser.js`, `beatsToSeconds` in `setlist.js`, timing/durate offline la usano

### C — Durate misurate dal vivo
- [x] RED: brano suonato dall'inizio alla fine senza salti → durata reale salvata in `setlist.json`, usata al posto della stima
- [x] GREEN: `server/meter.js` + `songSeconds`: `[m:ss]` > mappa tempo > misurata > stima; pulsante "Azzera durate misurate"

### D — Annunci vocali e count-in
- [x] RED `test/cues.test.js`: annuncio sezione/brano una battuta prima, numeri del count-in sull'ultima battuta, nessun annuncio su seek
- [x] GREEN `server/cues.js`, evento WS `cue`; UI: sintesi vocale del browser, attivabile per dispositivo

### E — Ridondanza a due computer (stile AbleNet)
- [x] RED: server principale inoltra i comandi ai peer (`/api/cmd` con `mirror`), niente loop, stato dei peer (online, scarto di beat)
- [x] GREEN: `peers` nelle opzioni, inoltro, controllo stato; UI: lista peer (README in G)

### F — Vista Palco personalizzabile per dispositivo
- [x] UI: scelta degli elementi (tempi, prossimo, note, sezioni rapide, testi nel Palco), salvata per dispositivo
- [x] Verifica nel browser con Live simulato: testi nel Palco, cue via WS (sezione + count 1-4), lista peer con stato

### G — Rilascio
- [x] `npm run coverage`: righe 99.75%, rami 91.39%
- [x] README, versione 0.3.0, report TDD `docs/releases/0.3.0/`
- [x] Push, CI verde (run 39487118022: 123/123 + 17 OK su Windows/macOS/Ubuntu), tag `v0.3.0`

## Fatto

- [x] v0.2.0 rilasciata (notazione AbleSet, motore, editor, Palco, OSC/HTTP/MIDI, macOS arm64): vedi `docs/releases/0.2.0/v0.2.0.tdd.md`

## Da decidere con l'utente

- Brani aggiunti a mano dalla UI, senza progetto Live (solo scaletta e testi):
  proposto il 2026-10-20, in attesa di risposta.
- v0.4.0 "facile da avviare e da usare su tutti i dispositivi" (da
  https://ableset.com/docs/all, proposta del 2026-10-20, in attesa di conferma):
  1. Dati in una cartella utente stabile (macOS `~/Library/Application Support/OpenSet`,
     Windows `%APPDATA%\OpenSet`, Linux `~/.config/openset`), con migrazione del
     `setlist.json` che oggi sta accanto al binario.
  2. Doppio clic che apre da solo il browser (`open`/`start`/`xdg-open`, `--no-open`).
  3. Installazione automatica del Remote Script nella User Library di Live, più
     una schermata "In attesa di Live" con i passi da seguire.
  4. "Connetti un dispositivo": indirizzo `nome.local` e IP con QR code nella UI;
     porta 80 se libera, altrimenti 39080.
  5. Schermo sempre acceso (Wake Lock) e PWA a schermo intero sui tablet.
  6. Nome per dispositivo, vista predefinita, blocco (⇧L), lista dei dispositivi
     connessi; OSC `/devices/showPage` e `/devices/reload`.
  7. Modalità di salto (Quantizzato, Fine sezione, Fine brano, Dinamico, Manuale)
     con coda: J, ⇧J, C.
  8. Editor: trascinamento anche touch, Ctrl+K per cercare (iniziali, tag),
     copia/incolla della scaletta come testo con match approssimato, backup a
     ogni sovrascrittura.
  9. Safe Mode e password facoltativa per le modifiche.

## Rimandato

Canvas libero, Bonjour per OSC, colori, scambio automatico dell'audio tra i due
computer (serve hardware), lettura dell'automazione del tempo da Live connesso
(l'API di Live non la espone: si usano le durate misurate).
