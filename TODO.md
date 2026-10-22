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
- [ ] v0.6.0 su `release/v0.6.0` (da `main` d93fe1d): W3 RED

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
- [ ] Remove Played Songs Automatically

#### W4 — Colori e Tools
- [ ] `[colore]` nei locator (18 colori di AbleSet), sezioni con il colore del brano; traccia sezioni con `+CC`/`+CLIPCOLORS` → colore della clip (colonna della tavolozza di Live); flag `+SECTIONS`; UI colorata
- [ ] Tools: Set Clip Colors from Names, Place Locators on Section Clips, Remove Automatically Placed Locators

#### W5 — General
- [ ] Default View; Open on Start (alla connessione di Live); Always Open in a Floating Window (Chrome/Edge `--app`); Auto-Launch the Last Live Project

#### W6 — Debug e AbleNet
- [ ] Device Settings (impostazioni di tutti i dispositivi in una pagina); Connected Scene (principale/riserva); Automatic Drift Correction (Phase Nudge); Sync Playback Now

#### W7 — Voci del menu di AbleSet in Opzioni (solo da questo computer)
- [ ] Documentazione, reinstalla Remote Script, apri cartella dati / custom.css, Change Hostname, Preferred Network, Check for Updates, Submit Feedback, Quit

#### W8 — Rilascio v0.6.0
- [ ] Copertura, CHANGELOG, guida PDF, README, report TDD, PR, CI verde (le build), merge; build locale dei 4 zip `openset-0.6.0-*.zip` + `OpenSet-0.6.0-Guida.pdf` in `build/release-0.6.0/`

### Audit completo dopo W7, prima del rilascio W8 (richiesto dall'utente il 2026-10-22: i bug trovati si correggono nella 0.6.0)
- [ ] `ponytail:ponytail-audit` su tutta l'app + `security-review` (LAN, password, OSC, HTTP)
- [ ] `superpowers:systematic-debugging` sul bug della scaletta che sparisce, con il pacchetto log della 0.5.1
- [ ] agente `ecc:python-reviewer` sul Remote Script (Python 3.7 di Live 11, API di Live)
- [ ] `ecc:e2e-testing` (Playwright) per i flussi principali della UI, oggi senza test automatici
- [ ] prima di ogni merge `code-review` sulla PR; ai rilasci grossi `ecc:orch-review`
- Un primo audit generico era partito in background ed è stato fermato su richiesta dell'utente (si rifà con queste skill)

### Esclusi (con motivo)
Show in Dock e licenze (non applicabili); Multi-File Project, Delay Before
Jumping to Song File, Sync Group Solos/Volumes, Mixer, Project Script, Persist
Shared Variables (grandi: versione dedicata se richiesti); Audio Interfaces,
LTC, Follow Current Audio Interface Scene, AbleSet Controller (hardware o Max
for Live).

## Fatto

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
