# TODO — OpenSet v0.3.0

Stato aggiornato a ogni passo. Protocollo di ripresa: vedi `CLAUDE.md`.
Obiettivo utente: coprire il più possibile le funzioni di AbleSet; Windows e
macOS obbligatori, Linux se costa poco. v0.3.0 = funzioni rimandate in v0.2.0.

## In corso

- [ ] B — durate con automazione del tempo (`.als`)

## Da fare

### A — Sections e testi dal `.als` (offline)
- [x] RED `test/als-parser.test.js`: clip arrangement di `Sections` e `+LYRICS`, clip di sessione escluse, nomi tracce
- [x] GREEN `server/als-parser.js` → `tracks`; server offline usa `cuesFromLive`/`lyricsFromClips` anche col `.als`

### B — Durate con automazione del tempo (`.als`)
- [ ] RED: mappa del tempo dal `.als` (punti FloatEvent del Tempo del Master), secondi tra due beat con rampe lineari
- [ ] GREEN: `tempoMap` in `als-parser.js`, `beatsToSeconds` in `setlist.js`, timing/durate offline la usano

### C — Durate misurate dal vivo
- [ ] RED: brano suonato dall'inizio alla fine senza salti → durata reale salvata in `setlist.json`, usata al posto della stima
- [ ] GREEN: `server/index.js` + `songSeconds` con priorità `[m:ss]` > misurata > stima

### D — Annunci vocali e count-in
- [ ] RED `test/cues.test.js`: annuncio sezione/brano una battuta prima, numeri del count-in sull'ultima battuta, nessun annuncio su seek
- [ ] GREEN `server/cues.js`, evento WS `cue`; UI: sintesi vocale del browser, attivabile per dispositivo

### E — Ridondanza a due computer (stile AbleNet)
- [ ] RED: server principale inoltra i comandi ai peer (`/api/cmd` con `mirror`), niente loop, stato dei peer (online, scarto di beat)
- [ ] GREEN: `peers` nelle opzioni, inoltro, controllo stato; UI: lista peer; README: Ableton Link per il tempo

### F — Vista Palco personalizzabile per dispositivo
- [ ] UI: scelta degli elementi (tempi, prossimo, note, sezioni rapide, testi nel Palco), salvata per dispositivo
- [ ] Verifica nel browser con Live simulato

### G — Rilascio
- [ ] `npm run coverage` ≥ 80% righe/rami su `server/`
- [ ] README/INSTALL, versione 0.3.0, report TDD `docs/releases/0.3.0/`
- [ ] Push, CI verde (Windows/macOS/Ubuntu), tag `v0.3.0`, verifica asset

## Fatto

- [x] v0.2.0 rilasciata (notazione AbleSet, motore, editor, Palco, OSC/HTTP/MIDI, macOS arm64): vedi `docs/releases/0.2.0/v0.2.0.tdd.md`

## Rimandato

Canvas libero, Bonjour per OSC, colori, scambio automatico dell'audio tra i due
computer (serve hardware), lettura dell'automazione del tempo da Live connesso
(l'API di Live non la espone: si usano le durate misurate).
