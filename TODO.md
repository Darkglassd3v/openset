# TODO — OpenSet v0.3.0

Stato aggiornato a ogni passo. Protocollo di ripresa: vedi `CLAUDE.md`.
Obiettivo utente: coprire il più possibile le funzioni di AbleSet; Windows e
macOS obbligatori, Linux se costa poco. v0.3.0 = funzioni rimandate in v0.2.0.

## In corso

- [x] Release v0.3.0 (run 39487410456): 4 zip, nessun `__pycache__`

(nessun lavoro in corso: prossimi passi in "Rimandato")

## Da fare

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

## Rimandato

Canvas libero, Bonjour per OSC, colori, scambio automatico dell'audio tra i due
computer (serve hardware), lettura dell'automazione del tempo da Live connesso
(l'API di Live non la espone: si usano le durate misurate).
