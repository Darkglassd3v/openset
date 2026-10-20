# TODO — OpenSet v0.2.0

Stato aggiornato a ogni passo. Protocollo di ripresa: vedi `CLAUDE.md`.
Obiettivo utente: coprire il più possibile le funzioni di AbleSet; Windows e
macOS obbligatori, Linux se costa poco.

## In corso

- [ ] Fase 2 — GREEN: implementazione (RED fatto, commit test:)

## Da fare

### Fase 1 — RED (`ecc:tdd-workflow`)
- [x] `test/setlist.test.js`: notazione AbleSet (sezioni `>`/`>>`, `SONG END`/`STOP`/`AUTOSTOP`/`=END`/`=STOP`, `.Brano`, `+JUMP`/`+STAY`, `+LOOP[:N]`/`+LOOPFULL`, `+PAUSE`, `+SKIP`, `+END`, `>>> Sezione`/`>>> SONG END`, `{descrizione}`, `#tag`, `[3:20]`, `[nosong]`, `[+2]`/`[-3b]`, `[.classe]`, `*` e ClyphX ignorati), ordine/salti/stop-dopo/note, songAt/sectionAt, prev/next, timer, traccia Sections, quantizzazione
- [x] `test/engine.test.js`: fine brano (continua/stop/autojump), transizioni con pre-roll quantizzato, `+PAUSE`, `+LOOP:N`, `+SKIP`, `+END`
- [x] `test/lyrics.test.js`: nome file Unicode, ChordPro, trasposizione, testi da traccia `+LYRICS`
- [x] `test/osc.test.js`: codifica/decodifica OSC, bundle
- [x] `test/als-parser.test.js`: `<Locator Id="0">`, XML semplice, file mancante
- [x] `test/server.test.js`: start() porte effimere, Live finto UDP (anche a pezzi), WS, `POST /api/cmd`, OSC compatibile AbleSet + `/subscribe`, autoplay, scalette salvate, `/api/load-als` solo loopback, testi
- [x] `remote-script/tests/test_openset.py`: comandi, stato, cue solo se cambiano, clip, invio a pezzi (limite UDP 9216 B di macOS), quantizzazione
- [x] Eseguire, verificare RED, commit `test:`

### Fase 2 — GREEN
- [x] `server/setlist.js`
- [x] `server/engine.js`
- [ ] `server/lyrics.js`
- [ ] `server/osc.js`
- [x] fix `server/als-parser.js`
- [ ] `server/index.js`: start(opts), comandi condivisi WS/HTTP/OSC, prefs `setlist.json`, motore, stato pubblico
- [ ] Remote Script: cue/clip solo se cambiano, invio a pezzi, quantizzazione, fix UDP Windows (`SIO_UDP_CONNRESET`)
- [ ] Test verdi, commit `feat:`

### Fase 3 — UI (`public/index.html`)
- [ ] Vista "Palco" (brano/sezione, prossimo, tempi, descrizione, note, tag, sezioni rapide `>>`)
- [ ] Editor scaletta: su/giù, salta, stop dopo brano, note, salva/carica, stampa, durata totale
- [ ] Impostazioni: stop sempre, autojump, autoplay, quantizzazione, MIDI learn (Web MIDI)
- [ ] Scorciatoie tastiera/pedale; testi ChordPro trasposti; render testi solo al cambio riga
- [ ] `custom.css` opzionale; classi `[.classe]`
- [ ] Verifica nel browser con Live finto, commit `feat:`

### Fase 4 — `ecc:test-coverage`
- [ ] `npm run coverage` ≥ 80% righe su `server/`, colmare i buchi, commit

### Fase 5 — Build e rilascio
- [ ] CI matrice Windows/macOS/Ubuntu: test Node + Python + build pkg + avvio binario
- [ ] Release: macOS arm64 nativo (firmato ad-hoc) + x64, Windows x64, Linux x64
- [ ] README/INSTALL: notazione, editor, OSC, HTTP, MIDI, scorciatoie, firewall
- [ ] Versione 0.2.0, report TDD `docs/releases/0.2.0/v0.2.0.tdd.md`
- [ ] Commit, push main, CI verde, tag `v0.2.0`, push tag

## Fatto

- [x] Analisi gap vs AbleSet e piano v0.2.0
- [x] `CLAUDE.md` + `TODO.md`

## Rimandato (fuori da v0.2.0)

AbleNet (ridondanza), Canvas, PlayAudio12, count-in parlato/sintesi vocale,
colori, traccia Measure, mixer/tracce, testi e Sections offline da `.als`,
Bonjour per OSC, wake lock (serve HTTPS), durate con automazione del tempo.
