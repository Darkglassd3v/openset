# TODO — OpenSet v0.5.1 (hotfix) e v0.6.0 (parità con le impostazioni di AbleSet)

Stato aggiornato a ogni passo. Protocollo di ripresa: vedi `CLAUDE.md`.
Obiettivo utente: coprire il più possibile le funzioni di AbleSet seguendo
fedelmente https://ableset.com/docs/settings; Windows e macOS obbligatori.
Implementazione sempre con `ecc:tdd-workflow` (commit RED e GREEN separati).

Origine (2026-10-22): due video da un Mac con Live 11, AbleSet e OpenSet 0.5.0
aperti insieme (in Live: superficie di controllo 3 = AbleSet, 4 = OpenSet).
OpenSet passa da «LIVE CONNESSO» a «IN ATTESA DI LIVE…» e la scaletta sparisce.
Causa probabile: AbleSet usa la porta UDP 39051 (OSC), la stessa su cui OpenSet
riceve lo stato da Live; quando Live tace per 3 s OpenSet butta la scaletta.
Non verificato su un Mac: comando di diagnosi dato all'utente (lsof + Log.txt).

## In corso

- [x] v0.5.1: PR #2 (merge `d93fe1d`), tag `v0.5.1` solo locale (nessun push: `release.yml` userebbe lo spazio degli artefatti), zip e guida in `build/release-0.5.1/`
- [x] v0.6.0: PR #3 (merge `279f7fa`), 4 zip e guida PDF anche in `build/release-0.6.0/`; release su GitHub dal tag (vedi sotto), CI verde su Windows, macOS e Ubuntu
- [x] Release senza artefatti delle Actions (scelta dell'utente, 2026-10-22): `release.yml` con un solo job su macOS (PR #4, merge `c70dcd1`), tag `v0.6.0` spostato su `c70dcd1` e pushato: release pubblica https://github.com/Darkglassd3v/openset/releases/tag/v0.6.0 con 4 zip e guida, 0 artefatti (run 39840370127)
  - [x] RED `packaging.test.js`: niente `upload-artifact`/`download-artifact`, un solo job su `macos-latest`, `codesign` del programma arm64, prova sulle PR, pubblicazione solo dai tag
  - [x] GREEN: `.github/workflows/release.yml` (prova sulla PR prima del tag)
- [x] Release più asciutta (richiesta dell'utente, 2026-10-22): la guida PDF solo dentro gli zip (non a parte, si rischia di non scaricarla), al posto dei passi di installazione un changelog breve dal CHANGELOG
  - [x] RED `release-notes.test.js` (una riga per voce, raggruppate, dove sta la guida), `packaging.test.js` (solo gli zip, `body_path: release-notes.md`)
  - [x] GREEN: `scripts/release-notes.js`, `release.yml`, regola aggiornata in `CLAUDE.md` (e in quello globale dell'utente)
  - [x] Release 0.6.0 corretta su GitHub: PDF a parte tolto (resta dentro i 4 zip), note brevi da `scripts/release-notes.js`; PR #5 unita
- [x] Azione di release condivisa `Darkglassd3v/.github/actions/release@v1` (creata il 2026-10-22, CI verde su Ubuntu, Windows, macOS; PR #6 unita, usata anche da dierre): è un'azione e non un workflow riutilizzabile, perché deve girare nel job che costruisce (niente artefatti)
  - [x] RED `packaging.test.js`: `release.yml` la usa, solo gli zip, niente `softprops` né `release-notes`; `scripts/release-notes.js` e il suo test tolti (le note le scrive l'azione)
  - [x] GREEN: `.github/workflows/release.yml`, `CLAUDE.md`
- [ ] v0.6.1 (branch `release/v0.6.1`): corsa in AbleNet corretta (RED + GREEN: `prunePeers()` anche alla fine di `pollPeers`); prima del rilascio: CHANGELOG, versione, PR, tag (trovata dalla CI Windows della PR #6: una lettura del computer di riserva ancora in corso quando lo si toglie dalla lista lo rimetteva nello stato)
- [ ] Prossimo: pacchetto log dal tester (bug della scaletta che sparisce, `superpowers:systematic-debugging`); scegliere dove pubblicare le release (vedi «Da decidere»)

## Da fare

### v0.5.1 — feedback all'avvio e convivenza con AbleSet (hotfix)

#### V1 — Porta riservata a Live
- [x] RED: lo stato di Live arriva su `127.0.0.1:39061` (`statePort`); il vecchio Remote Script sulla 39051 è ancora accettato; porta OSC occupata → OpenSet parte con OSC spento (`oscPort: null`); porta di stato occupata → `start()` rifiuta (istanza doppia); Remote Script: invia a 39061, `script_version` e `cmd_port` (bind della 39050 riuscito) nello stato
- [x] GREEN: `server/index.js`, `remote-script/OpenSet/OpenSet.py`, messaggio di avvio (`[live] state on …`, `[osc] port … busy … Is AbleSet open?`)

#### V2 — La scaletta non sparisce e si vede perché Live non è collegato
- [x] RED: dopo il silenzio di Live restano brani e sezioni (salvo progetto `.als` caricato); `liveIssues` nello stato: `no-live`, `live-silent`, `script-updated`, `script-old`, `cmd-port-busy`, `osc-busy`
- [x] GREEN: server (`useLive`, `liveIssues`) + UI (etichetta «Live non risponde», banner `#issues` con i motivi)

#### V3 — Debug Logs e Create Log Package (AbleSet: Debug → Debug Logs, menu → Create Log Package)
- [x] RED `test/log.test.js`: registro in memoria (ultime 500 righe) e file `openset.log` nella cartella dati (oltre 1 MB → `openset.old.log`); eventi: avvio, porte, Live collegato/staccato, errori; `GET /api/logs`, `GET /api/log-package` (testo con versione, sistema, porte, problemi, log, righe OpenSet dal `Log.txt` di Live) solo da questo computer o con password; il Remote Script manda a OpenSet i suoi errori e l'avvio (con la versione di Live); i messaggi di Live illeggibili finiscono nel log invece di sparire
- [x] GREEN: `server/log.js`, server (`/api/logs`, `/api/log-package`, eventi Live, errori invece di `catch {}` muti), CLI (log nel file, `[crash]` per eccezioni non gestite), Remote Script (`_log` verso OpenSet, una volta per errore ripetuto, `live_version`), UI Opzioni → Debug (Mostra log, Crea pacchetto log); provata nel browser con un Live simulato che tace

#### V4 — Rilascio v0.5.1
- [x] Copertura (righe 99.23%, rami 93.22%), CHANGELOG 0.5.1, guida, INSTALL, README, report TDD, versione 0.5.1
- [x] Build locale: `scripts/build-release-local.sh` + `scripts/assemble-release.sh` (usato anche da `release.yml`); il launcher dell'app firma ad hoc il programma arm64 compilato su Linux
- [x] CI: smoke test `curl | grep -q` falliva (23) con `index.html` oltre 64 KB: ora scarica su file
- [x] PR #2 verso `main`, CI verde su Windows/macOS/Ubuntu, merge commit `d93fe1d`; zip e PDF 0.5.1 in `build/release-0.5.1/` (arm64 senza bytecode, firmato dal launcher)
- Spazio GitHub per gli artefatti esaurito (utente, 2026-10-22): niente tag che avvia `release.yml`; la CI deve solo provare le build; zip e PDF si producono in locale (`build/release-<versione>/`) e l'utente li distribuisce a mano

### v0.6.0 — impostazioni di AbleSet (branch `release/v0.6.0` da `main` dopo la 0.5.1)

#### W1 — Playback
- [x] RED: `engine.test.js` (keepPlayingQueued), `server.test.js` (restartBeforeBack, pause/playPause/stopInsteadOfPause, disableLoopOnJump, reEnableAutomation, backToArrangement, OSC), `test_openset.py` (comandi a Live)
- [x] GREEN: motore (`keepPlayingQueued`), server (impostazioni, `pause`, `playPause`, `reEnableAutomation`, `backToArrangement`, OSC), Remote Script, UI (Opzioni → Riproduzione, pulsante Pausa/Stop, Spazio = play/pausa)
- Voci: Restart Song Before Jumping Back; Stop by Default Instead of Pausing (spazio = stop); Disable Loop When Jumping; Re-Enable Automation on Song Jump; Reset Tracks Back to Arrangement on Song Jump; Always Keep Playing When Jumping to Queued Songs

#### W2 — Section Count-In
- [x] RED: `server.test.js` (impostazioni, seek e play N battute prima, solo del click fino alla sezione o allo stop, niente count-in mentre suona, mai prima di 0), `test_openset.py` (`clickSolo`)
- [x] GREEN: server (`startCountIn`, `countIn.until`), Remote Script (`_click_solo` ripristina solo le tracce che ha messo in solo), UI (Opzioni → Riproduzione)
- Voci: Count-in prima della sezione scelta (1, 2 o 4 battute); solo della traccia click (prima traccia o gruppo con «click», tracce `+CLICK`, «Lifesine») durante il count-in

#### W3 — Setlist
- [x] RED: `engine.test.js` (marcatore `played` a fine brano, anche senza salto), `server.test.js` (il brano finito va tra i tolti, il marcatore non arriva a Live)
- [x] GREEN: motore (`songEnd` aggiunge `played`), server (il brano va in `skip`, registrato nel log), UI (Opzioni → Riproduzione)
- Voce: Remove Played Songs Automatically

#### Ritocchi chiesti dall'utente
- [x] Riquadro dei motivi (2026-10-22): testi professionali, tutto maiuscolo, titolo in ambra + indicazione
- [x] Esportare i log spiegato passo passo (2026-10-22): guida PDF, `INSTALL-*.txt` con il comando per aprire la cartella dei dati su ogni sistema, README, Opzioni → Debug (il file va nella cartella Download)

#### W4 — Colori e Tools
- [x] RED colori: `setlist.test.js` (`[colore]`, ereditato dalle sezioni, `+CC`/`+CLIPCOLORS` per colonna, `+SECTIONS`, locator `>` sulla clip), `als-parser.test.js` (`Color`/`ColorIndex`, `+SECTIONS`), `test_openset.py` (`color` e `+SECTIONS`)
- [x] GREEN colori: `server/setlist.js`, `server/als-parser.js`, Remote Script (`d1b6e6d`), UI (barra e tinta dei brani, sezioni, striscia; provata in Chrome)
- [x] RED Tools: `test_openset.py` (Set Clip Colors from Names, Place/Remove Section Locators senza togliere locator esistenti, rifiutati mentre suona), `server.test.js` (comandi verso Live, non da scollegato o mentre suona), `setlist.test.js` (colonna 0 = red, 6 = teal)
- [x] GREEN Tools: server (rifiutati da scollegato; locator non mentre suona), Remote Script (`_clip_colors_from_names`, `_section_locators`, `COLOR_COLUMNS`), UI (Opzioni → Strumenti), colonne 0 = red e 6 = teal
- Voci: `[colore]` nei locator (18 colori di AbleSet), sezioni con il colore del brano; traccia sezioni con `+CC`/`+CLIPCOLORS` → colore della clip (colonna della tavolozza di Live); flag `+SECTIONS`; UI colorata
- [ ] Tools: Set Clip Colors from Names, Place Locators on Section Clips, Remove Automatically Placed Locators

#### W5 — General
- [x] RED: `launch.test.js` (`appCommand`, fallback, `liveRunning`), `server.test.js` (defaultView, openBrowser start/live/off, floatingWindow, autoLaunchLive con `lastProject`)
- [x] GREEN: `server/launch.js` (`appCommand`, `liveRunning`), server (`SETTING_VALUES`, `openUi`, `afterListen`, `lastProject`), CLI, UI (Opzioni → Generale; vista predefinita al primo stato, salvo scheda già scelta)
- Voci: Default View; Open on Start (alla connessione di Live); Always Open in a Floating Window (Chrome/Edge `--app`); Auto-Launch the Last Live Project

#### W6 — Debug e AbleNet
- [x] RED: `ablenet.test.js` (`nudgeFor`, `syncTarget`), `server.test.js` (impostazioni dei dispositivi, scene, syncPlayback, driftCorrection con battito estrapolato), `test_openset.py` (nudge tenuto per un po')
- [x] GREEN: `server/ablenet.js`, server (`liveBeatNow`/`beatNow`, `peerClock`, `leader`, `syncPlayback`, nudge a ogni lettura), Remote Script (`nudge` tenuto `ms`), UI (impostazioni per dispositivo nella lista, scene, correzione, «Sincronizza ora» / «Live sta suonando»)
- Voci: Device Settings (impostazioni di tutti i dispositivi in una pagina); Connected Scene (principale/riserva); Automatic Drift Correction (Phase Nudge); Sync Playback Now

#### W7 — Voci del menu di AbleSet in Opzioni (solo da questo computer)
- [x] RED: `connect.test.js` (rete preferita, `lanInterfaces`), `server.test.js` (`/api/host/*` da loopback: apri, cartella, nome del computer, Remote Script, esci; `/api/update`; `network` e `/api/connect`)
- [x] GREEN: `server/connect.js` (`lanInterfaces`, rete preferita), server (`/api/host/:action` solo da loopback, `/api/update` con link solo GitHub, `network`), CLI (`installScript`, `quit`), UI (sezione «OpenSet», rete da usare in «Connetti un dispositivo», uscita con doppio tocco)
- Voci: Documentazione, reinstalla Remote Script, apri cartella dati / custom.css, Change Hostname, Preferred Network, Check for Updates, Submit Feedback, Quit

#### G1 — Guida PDF strutturata (richiesta dell'utente, 2026-10-22)
- [x] RED `guide.test.js`: copertina (logo grande, nome, versione), indice cliccabile, capitoli in ordine (prima le funzioni di base: installazione, Live, dispositivi, uso, opzioni, log, problemi; ultime novità e correzioni), intestazione del capitolo ripetuta su ogni pagina, numeri di pagina; CHANGELOG con `### Novità` e `### Correzioni`
- [x] GREEN: `scripts/build-guide.js` (HTML stampato da Chrome), PDF controllato a occhio: 17 pagine, 49 link interni

#### W8 — Rilascio v0.6.0
- [x] Copertura (righe 99.28%, rami 93.47%), CHANGELOG 0.6.0 (Novità e Correzioni), README, report TDD `docs/releases/0.6.0/v0.6.0.tdd.md`, versione 0.6.0 (VERSION, package.json, Remote Script)
- [x] PR #3 verso `main`, CI verde (le build), merge `279f7fa`; build locale dei 4 zip `openset-0.6.0-*.zip` + `OpenSet-0.6.0-Guida.pdf` in `build/release-0.6.0/` (la revisione della PR è l'audit A1-A4)

### Audit completo dopo W7, prima del rilascio W8 (richiesto dall'utente il 2026-10-22: i bug trovati si correggono nella 0.6.0)
- Via libera dell'utente il 2026-10-22: audit, correzioni, commit, push, PR e merge (stato salvato anche con `/ecc:ck save`)
- [x] `ponytail:ponytail-audit` su tutta l'app + `security-review` (LAN, password, OSC, HTTP: fatto, A3) + revisione della logica di riproduzione (fatta: A4) + revisione della UI (fatta: A2)
- [ ] `superpowers:systematic-debugging` sul bug della scaletta che sparisce, con il pacchetto log della 0.5.1 (in attesa del pacchetto)
- [x] agente `ecc:python-reviewer` sul Remote Script (Python 3.7 di Live 11, API di Live): 13 punti, correzioni in A1

#### A1 — Remote Script (da `ecc:python-reviewer`)
- [x] RED `test_openset.py`: solo del click tolto anche se una traccia non risponde; `disconnect()` toglie solo, nudge e listener e non manda più lo stato; lo stop di Live toglie il solo del click (server caduto durante il count-in); invio fallito → cue e clip rimandati, e comunque ogni ~10 s; `_tick` si riprogramma anche dopo un errore; `nudge` con `dir` sconosciuto ignorato e `ms` limitato a 1000; `_section_locators` rimette la testina anche dopo un errore; lettura dei comandi limitata a 64 per tick e `ConnectionResetError` (Windows) saltato; errori uguali una volta al minuto anche se alternati; `jump`/`seek`/`quant` senza valore rifiutati; niente listener del tempo e dei locator (bastano i tick, evita raffiche con l'automazione del tempo)
- [x] RED `server.test.js`: le stesse clip rimandate dallo script ogni ~10 s non ricaricano i testi (`lyricsRev` invariato)
- [x] GREEN: `remote-script/OpenSet/OpenSet.py`, server (clip uguali ignorate)
- Non corretti: lettura dei cue a ogni tick con set molto grandi (non misurato in Live, da rivedere se il pacchetto log mostra rallentamenti); comandi da altri programmi dello stesso computer (la porta 39050 è già solo su 127.0.0.1)
- [x] `ecc:e2e-testing` (Playwright) per i flussi principali della UI: `e2e/ui.spec.js` (A2), in CI su Ubuntu
- [ ] Verificare su Safari/iPad il tempo della prima connessione WebSocket: nel Chrome di test 1-2,4 s (da Node 8 ms, HTTP 3 ms)
- [ ] prima di ogni merge `code-review` sulla PR; ai rilasci grossi `ecc:orch-review`
- Un primo audit generico era partito in background ed è stato fermato su richiesta dell'utente (si rifà con queste skill)

#### A2 — Interfaccia (revisione della UI in Chrome con un Live simulato; nessun XSS trovato)
- Test della UI con Playwright (`@playwright/test`, Chrome di sistema `channel: "chrome"`, nessun browser scaricato), file `e2e/*.spec.js` (non presi da `node --test`), `npm run e2e`
- [x] RED `e2e/ui.spec.js` + `server.test.js` + `ui-compat.test.js`:
  1. cambio di tempo in Live (rampa): scaletta e striscia non si ricostruiscono, il tocco su sezioni/brani e la nota in scrittura non si perdono, niente `/api/setlist-text` a ogni tick
  2. WebSocket caduto: pallino spento, «OpenSet non raggiungibile…», comandi attenuati
  3. Spazio = play/pausa anche dopo un clic su una scheda o un pulsante (il pulsante non tiene il focus)
  4. incolla scaletta con password da un dispositivo sbloccato (manca `authHeaders()`)
  5. token vecchio dopo un riavvio di OpenSet: non conta come tentativo sbagliato (server) e il client lo dimentica
  6. vista all'apertura: vale per i dispositivi nuovi, non sostituisce l'ultima vista del dispositivo
  7. niente `??`, `?.`, `inset` (iPad con iOS 12-14)
  9. Opzioni (dispositivi, ridondanza, MIDI) non ricostruite per latenza e deriva
  10. computer di riserva senza `http://` accettato; nome della scaletta salvata `maxlength=64`
  11. testi: niente «Nessun testo» mentre caricano, errore di rete non resta in memoria
  12. Safe Mode: il pulsante Pausa/Stop torna a aggiornarsi dopo una pressione non confermata
  13. trascinare un brano in giù lo mette sopra la linea ambra
  14. testi: «In riproduzione», «1 brano», errori del server in italiano, `scriptNote` per lo stato del Remote Script
  16. ricerca: risposte arrivate in ritardo ignorate
- [x] GREEN: `public/index.html`, server (limitatore), più 8 (MIDI in una sola scheda con `navigator.locks`) e 15 (campi 16 px sui telefoni: niente zoom di Safari), senza test automatico
- Non corretto: brani con lo stesso nome (ripresa) modificati insieme, perché il protocollo usa il nome (da rivedere con gli id)

#### A3 — Sicurezza (agente `ecc:security-reviewer`, prove su un server vero; nessun XSS, path traversal o RCE dalla rete)
- [x] RED `server.test.js` (+ `editor`, `setlist`, `als-parser`, `launch`):
  1. un frame WebSocket malformato non chiude OpenSet (`ws.on("error")`, `maxPayload` 64 KB)
  2. richieste da altri siti: `Origin` diverso da `Host` rifiutato (WebSocket e POST), `Host` solo IP, `localhost`, `*.local` o nome del computer (DNS rebinding), `X-Frame-Options: DENY`
  3. limitatore della password: il tentativo conta prima di scrypt (richieste in parallelo), password di almeno 6 caratteri
  4. OSC `/subscribe` e `/getValues`: risposta solo all'indirizzo che chiede (niente riflessione verso altri), al massimo 4 iscrizioni per indirizzo; 14. al massimo 64 messaggi per pacchetto
  5. UI: la password non protegge l'OSC (testo corretto)
  6. `editor.js`: righe lunghe non bloccano il server (regex quadratica)
  7. nomi con migliaia di `>` non fanno crollare OpenSet (ricorsione in `parseName`), nomi tagliati a 256 caratteri
  8. `.als`: decompressione limitata (64 MB) e lettura senza regex quadratiche sui tag non chiusi
  9. `setPassword` e `peers` solo da questo computer; 12. computer di riserva senza redirect
  10. `/api/load-als` solo file `.als`; all'avvio automatico si apre solo un `.als`
  13. `midi` vale solo da questo computer (Safe Mode); `mirror` resta accettato da tutti: il computer di riserva spesso non ha il principale nella sua lista, e Safe Mode è una protezione dagli errori, non dagli attacchi
  16. testi: il file si legge solo per un brano della scaletta (nomi riservati di Windows)
  18. `setlist.json` leggibile solo dall'utente (0600)
- [x] GREEN: `server/index.js`, `server/editor.js`, `server/setlist.js`, `server/als-parser.js`, `server/launch.js` (Windows: `explorer`), UI; anche A4.11 (route async con try/catch)
- Non corretti: password e token in chiaro su HTTP (serve HTTPS: versione dedicata); token senza scadenza; Node 18 dentro i programmi (pkg 5.8.1 arriva a Node 18: passare a Node SEA in una versione dedicata); limitatore per /64 IPv6; tetto alle connessioni WebSocket

#### A4 — Motore, server e AbleNet (agenti `ponytail:ponytail-audit` e `ecc:code-reviewer`, confermati con un Live simulato)
- [x] RED `engine.test.js`, `server.test.js`, `setlist.test.js`, `e2e/ui.spec.js`:
  1. con il loop di Live acceso il motore non salta a fine brano o sezione mentre il loop gira (il vamp suona una volta sola)
  2. salto in coda verso il confine naturale (sezione o brano successivo): la coda si svuota quando la testina ci arriva da sola (oggi rifà la sezione/il brano)
  3. dopo uno stop il motore dimentica i confini già scattati (oggi STOP, +SKIP, +LOOP, SONG END non scattano più al secondo passaggio)
  4. una sezione +LOOP raggiunta con un salto o con Play dal suo inizio va in loop
  5. sezioni solo da clip (senza locator): salto alla fine del confine, non una quantizzazione prima (taglia l'ultima battuta)
  6. count-in a battuta 0: niente solo del click (resterebbe acceso per tutto il brano); il pre-roll del count-in non fa scattare lo STOP del brano prima
  7. salti di 4+ battute tra due stati (Live rallentato) non fanno perdere i confini: si decide con l'orologio
  8. Re-Enable Automation e Back to Arrangement al confine, non una quantizzazione prima
  9. Live in silenzio: `is_playing` falso e coda svuotata; al ritorno di Live la coda vecchia non scatta
  10. sezioni dopo la fine del brano ignorate, fine della sezione mai oltre la fine del brano
  11. [fatto in A3] incolla con `\r` o U+2028 (Note di Apple) non chiude il server; route async con try/catch
  12. `setlist.json` scritto in modo atomico (`.tmp` + rename); file illeggibile copiato in `setlist.corrupt-<ora>.json` e registrato nel log
  13. WebSocket: client che non rispondono al ping chiusi, niente invio a chi ha più di 1 MB in coda; battito ogni 2 s e la UI si ricollega se tace per 6 s; `perMessageDeflate` (stato da ~30 KB a ~2 KB)
  14. AbleNet: impostazioni locali (`scene`, `driftCorrection`, `network`, `openBrowser`, `floatingWindow`, `autoLaunchLive`, `defaultView`) non copiate sui computer di riserva; correzione della deriva solo sulla riserva verso il principale; computer tolti dalla lista dimenticati; comandi copiati accettati dai computer di riserva configurati anche con password
  15. OSC: con 32 iscrizioni si toglie la più vecchia; pacchetto a pezzi illeggibile registrato nel log
  16. porta HTTP: si riusa quella dell'ultima volta (80 o 39080), così le icone sull'iPad restano valide
  17. codice morto: `lanAddresses`, `ping`/`pong` del Remote Script
- [x] GREEN: `server/engine.js`, `server/index.js`, `server/setlist.js`, `server/connect.js`, Remote Script, UI (watchdog della connessione, computer di riserva che rifiuta i comandi)
- Non corretti: brani con lo stesso nome (vedi A2); User Library di Live fuori da Documenti (si legge da `Library.cfg` in una versione dedicata; la guida spiega l'installazione a mano); `openset.log` ruotato solo all'avvio

### Esclusi (con motivo)
Show in Dock e licenze (non applicabili); Multi-File Project, Delay Before
Jumping to Song File, Sync Group Solos/Volumes, Mixer, Project Script, Persist
Shared Variables (grandi: versione dedicata se richiesti); Audio Interfaces,
LTC, Follow Current Audio Interface Scene, AbleSet Controller (hardware o Max
for Live).

## Fatto

- [x] v0.6.0 rilasciata (impostazioni di AbleSet, audit completo A1-A4 con test della UI in Playwright, guida PDF strutturata): vedi `docs/releases/0.6.0/v0.6.0.tdd.md`
- [x] v0.5.1 (OpenSet e AbleSet insieme, scaletta conservata, motivi a schermo, log e pacchetto log, build locale): vedi `docs/releases/0.5.1/v0.5.1.tdd.md`
- [x] v0.5.0 rilasciata (modalità di salto, editor, dispositivi, Safe Mode e password, versione nei nomi, icone, guida PDF): vedi `docs/releases/0.5.0/v0.5.0.tdd.md`
- [x] v0.4.0 rilasciata (cartella dati, apertura automatica, installazione del Remote Script, QR, porta 80): vedi `docs/releases/0.4.0/`
- [x] v0.3.1 rilasciata (PWA per iPad/iPhone): vedi `docs/releases/0.3.1/v0.3.1.tdd.md`
- [x] v0.3.0 rilasciata (sezioni e testi dal `.als`, mappa del tempo, durate misurate, annunci vocali, computer di riserva, Palco per dispositivo): vedi `docs/releases/0.3.0/v0.3.0.tdd.md`
- [x] v0.2.0 rilasciata (notazione AbleSet, motore, editor, Palco, OSC/HTTP/MIDI, macOS arm64): vedi `docs/releases/0.2.0/v0.2.0.tdd.md`

## Logo

- [x] Logo "anello aperto + play" (scelto dall'utente il 2026-10-21): `docs/brand/logo.svg`, `docs/brand/logo-wordmark.svg`, icone PWA 180/192/512 rigenerate

## Da decidere con l'utente

- Brani aggiunti a mano dalla UI, senza progetto Live (solo scaletta e testi):
  proposto il 2026-10-20, in attesa di risposta.

## Rimandato

Canvas libero, Bonjour per OSC, scambio automatico dell'audio tra i due
computer (serve hardware), lettura dell'automazione del tempo da Live connesso
(l'API di Live non la espone: si usano le durate misurate).
