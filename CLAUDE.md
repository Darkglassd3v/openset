# OpenSet — istruzioni per Claude

Controller di scaletta open-source per Ableton Live, alternativa gratuita ad
AbleSet (https://ableset.com). Leggi `TODO.md` prima di iniziare qualsiasi lavoro.

## Architettura

```
Ableton Live ── Remote Script Python (remote-script/OpenSet/OpenSet.py)
                   │ UDP JSON: comandi → :39050, stato ~10 Hz → :39051
                   ▼
Server Node (server/index.js) ── HTTP + WebSocket :39080 ── public/index.html
   ├─ server/setlist.js     logica pura: scaletta, ordine, fine brano, timer
   └─ server/als-parser.js  lettura offline dei file .als (XML gzip)
```

- `server/setlist.js` non fa I/O: tutta la logica nuova va qui e si testa qui.
- `server/index.js` esporta `start(opts)` (porte e cartella configurabili) e
  parte da solo solo con `require.main === module`.
- La UI è un unico file vanilla JS, in italiano. Riceve dal server lo stato già
  calcolato (`current`, `next`, `timing`) e non duplica la logica.
- Commenti nel codice in inglese, testi della UI e documentazione in italiano.
- Nessuna dipendenza nuova senza motivo: i test usano `node:test` integrato.

## Comandi

```bash
npm install
npm start                                           # server su :39080
npm test                                            # test Node (node:test)
npm run coverage                                    # test + copertura
python3 -m unittest discover -s remote-script/tests # test del Remote Script
npx pkg@5.8.1 . --targets node18-linux-x64 --out-path build   # binario locale
```

## Flusso di lavoro (logica ECC)

Ogni modifica segue questo ordine. Non saltare passi.

1. **Piano**: requisiti e rischi in `TODO.md` (sezione "Da fare").
2. **`ecc:tdd-workflow`**:
   - RED: scrivi i test, eseguili, verifica che falliscano per il motivo giusto.
     Commit `test: ...` con l'evidenza RED nel messaggio.
   - GREEN: codice minimo finché i test passano. Commit `feat:`/`fix: ...`.
   - REFACTOR: pulizia a test verdi. Commit `refactor: ...` (opzionale).
3. **`ecc:test-coverage`**: `npm run coverage`, obiettivo ≥ 80% sulle righe di
   `server/`. Aggiungi test per i buchi. Commit `test: ...`.
4. **Build**: binario pkg locale, avvio e verifica `GET /api/state`.
5. **Rilascio**: aggiorna `VERSION` e `package.json`, README, report TDD in
   `docs/releases/<versione>/`, commit, `git push origin main`, poi tag
   `v<versione>` e `git push origin v<versione>` (il tag avvia la release CI).

## Regole per i commit

- Commit separati e autoconsistenti: uno per modulo o funzione, ognuno con il
  proprio codice e i propri test verdi. Mai mescolare modifiche non correlate.
- Ogni commit include l'aggiornamento di `TODO.md` (checkbox spuntate, sezione
  "In corso" sul passo successivo), così la storia git e il TODO coincidono.
- Messaggi Conventional Commits (`test:`, `feat:`, `fix:`, `refactor:`,
  `docs:`, `ci:`, `chore:`) con l'evidenza dei test nel corpo.

## Ripresa dopo limite o reset

1. Leggi `TODO.md`: la sezione "In corso" dice dove eri.
2. `git log --oneline -15` e `git status`: confronta con le checkbox.
3. `npm test`: lo stato rosso/verde dice se eri in fase RED o GREEN.
4. Riprendi dal primo punto non spuntato. Non rifare commit già presenti.
