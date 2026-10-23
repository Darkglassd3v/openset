# OpenSet

<p align="center"><img src="docs/brand/logo-wordmark.svg" alt="OpenSet" width="360"></p>

Controller di scaletta **open-source per Ableton Live**, ispirato ad AbleSet.
Trasforma il tuo progetto Live in una scaletta interattiva controllabile dal
browser di qualsiasi telefono, tablet o computer sulla stessa rete Wi-Fi —
senza internet.

## Funzionalità

- **Scaletta automatica** — legge i locator dell'Arrangement di Live (stessa notazione di AbleSet) e costruisce brani e sezioni navigabili, anche da una traccia MIDI `Sections`
- **Fine brano intelligente** — `SONG END` passa al brano successivo della scaletta, `STOP` ferma e prepara il successivo; i salti sono quantizzati e arrivano esattamente sul confine
- **Automazioni** — loop di sezione (`+LOOP`, `+LOOP:4`), pause (`+PAUSE`), sezioni saltate (`+SKIP`), transizioni (`Intro >>> Strofa 2`)
- **Impostazioni di AbleSet** — stop invece di pausa, count-in di sezione con il solo del click, brani suonati tolti dalla scaletta, riattiva l'automazione e Back to Arrangement a ogni brano, vista all'apertura, apertura automatica del browser e di Live
- **Colori** — `[blue]` nei nomi di brani e sezioni, colori delle clip con `+CC`; strumenti per colorare le clip dai nomi e mettere i locator sulle sezioni
- **Editor della scaletta** — trascina i brani (anche col dito), Ctrl+K per cercare e aggiungere, copia/incolla la scaletta come testo, salta brani, stop dopo un brano, note per il palco, scalette salvate con le versioni precedenti, stampa, durata totale
- **Modalità di salto** — subito, a fine sezione, a fine brano, dinamica o manuale, con la coda (`J`, `⇧J`, `C`) come in AbleSet
- **Dispositivi** — nome e tag per ogni telefono o tablet, vista all'apertura, blocco (`⇧L`), lista dei collegati, comandi OSC `/devices/...`
- **Safe Mode e password** — niente cambi di brano per errore mentre suona; password facoltativa (almeno 6 caratteri, si imposta dal computer con OpenSet) per comandare dagli altri dispositivi
- **Vista Palco** — brano e sezione in grande, prossimo brano, tempo rimanente nel brano e nello show, battiti, sezioni rapide
- **Testi e accordi sincronizzati** — file JSON o traccia MIDI `+LYRICS` (una clip per riga), accordi ChordPro trasposti per brano
- **Annunci vocali** — nome della sezione successiva e count-in parlato, sul dispositivo che vuoi (cuffie, in-ear)
- **Durate reali** — dall'automazione del tempo del file `.als` o misurate mentre suoni
- **Ridondanza a due computer** — i comandi vengono ripetuti su un secondo computer con OpenSet (stile AbleNet); la riserva corregge da sola lo scarto e si sincronizza con *Sincronizza ora*
- **Controllo remoto** — browser, tastiera e pedali Bluetooth, MIDI (Web MIDI), OSC compatibile AbleSet (TouchOSC, Bitfocus Companion), HTTP
- **Striscia di avanzamento show** — panoramica del concerto, nell'ordine della scaletta, con playhead in tempo reale
- **Modalità offline** — parser dei file `.als`: scaletta, sezioni (anche dalla traccia `Sections`), testi `+LYRICS` e tempi anche senza Live aperto
- **Diagnostica** — registro `openset.log`, Opzioni → Debug con *Mostra log* e *Crea pacchetto log* (con le righe di OpenSet dal `Log.txt` di Live); se Live non risponde la scaletta resta e un riquadro dice il motivo
- **Cross-platform** — Windows, macOS (Apple Silicon nativo e Intel) e Linux; eseguibili standalone senza installare Node.js

## Download

Scarica lo zip della tua piattaforma dall'ultima [**Release**](../../releases/latest):

| Piattaforma | File |
|---|---|
| Windows x64 | `openset-<versione>-win-x64.zip` |
| macOS Apple Silicon (M1–M4) | `openset-<versione>-macos-arm64.zip` |
| macOS Intel | `openset-<versione>-macos-x64.zip` |
| Linux x64 | `openset-<versione>-linux-x64.zip` |

Ogni zip contiene il programma con la versione nel nome (`openset-0.6.2.exe`,
`OpenSet 0.6.2.app`, `openset-0.6.2`), il Remote Script per Live, l'interfaccia
web, `VERSION.txt`, la guida `INSTALL.txt` e **`OpenSet-<versione>-Guida.pdf`**
con le novità e i passi per ogni piattaforma. Le novità di ogni versione sono in
[CHANGELOG.md](CHANGELOG.md). La versione è stampata all'avvio e mostrata
nell'intestazione dell'app.

Negli esempi qui sotto sostituisci `0.6.2` con la versione che hai scaricato.

## Installazione

### Windows

```powershell
Expand-Archive openset-0.6.2-win-x64.zip -DestinationPath C:\OpenSet
```

1. Doppio clic su `C:\OpenSet\openset-0.6.2.exe` (ha l'icona di OpenSet): il browser si apre da solo.
   Se compare SmartScreen: *Ulteriori informazioni → Esegui comunque*.
   Al primo avvio consenti l'accesso alla **rete privata** nel firewall.
2. OpenSet copia da solo il Remote Script nella User Library di Live
   (`Documents\Ableton\User Library\Remote Scripts\OpenSet`).
3. Riavvia Live → Opzioni → Preferenze → **Link, Tempo e MIDI** →
   Superficie di controllo → **OpenSet** (Input/Output: Nessuno).

### macOS

Estrai `openset-0.6.2-macos-arm64.zip` (Mac Intel: `openset-0.6.2-macos-x64.zip`)
e sposta **`OpenSet 0.6.2.app`** in Applicazioni. L'app non è firmata da Apple:
al primo avvio togli la quarantena (oppure tasto destro → Apri):

```bash
xattr -dr com.apple.quarantine "/Applications/OpenSet 0.6.2.app"
```

1. Doppio clic sull'app: si apre il Terminale con OpenSet (Ctrl+C o chiudere la
   finestra lo ferma) e il browser. Se macOS chiede di accettare connessioni in
   entrata, consenti: servono a telefono, tablet e controller OSC.
2. OpenSet copia da solo il Remote Script in
   `~/Music/Ableton/User Library/Remote Scripts/OpenSet`.
3. Riavvia Live → Impostazioni → **Link, Tempo e MIDI** →
   Superficie di controllo → **OpenSet** (Input/Output: Nessuno).

Se hai spostato la User Library di Live, OpenSet la trova da solo nelle
impostazioni di Live (`Library.cfg`). Se non la trova, la scaletta vuota mostra
cosa copiare a mano: la cartella `remote-script/OpenSet` dello zip va in
`Remote Scripts`.

### Linux

```bash
unzip openset-0.6.2-linux-x64.zip -d openset && cd openset
chmod +x openset-0.6.2
./openset-0.6.2
```

Ableton Live non esiste per Linux: usa la macchina Linux come postazione di
controllo remoto, oppure carica un progetto offline:

```bash
./openset-0.6.2 "/percorso/Progetto Project/Progetto.als"
```

Se all'avvio compare `OpenSet cannot start: ... (is OpenSet or AbleSet already running?)`,
c'è già un'istanza di OpenSet aperta: chiudila. OpenSet e AbleSet possono restare
aperti insieme: se AbleSet occupa la porta OSC 39051, OpenSet parte con l'OSC spento
e lo segnala.
`--no-open` avvia OpenSet senza aprire il browser.

### Indirizzo e altri dispositivi

OpenSet usa la porta **80** se è libera, così l'indirizzo non ha numeri:
`http://localhost` sul computer, `http://<ip>` o `http://<nome-mac>.local`
da telefono e tablet sulla stessa rete. Se la porta 80 è occupata (o su Linux,
dove serve root) usa la **39080**. `PORT=39080 ./openset-0.6.2` forza una porta.

In **Opzioni → Connetti un dispositivo** ci sono gli indirizzi con il loro
**QR code**: inquadralo con la fotocamera del telefono e si apre OpenSet.

### iPad e iPhone come app

Il server gira sul computer con Live; iPad e iPhone si collegano dalla stessa rete.

1. Inquadra il QR code in Opzioni, o apri in Safari l'indirizzo stampato
   all'avvio. Su Mac usa `http://<nome-mac>.local`, che resta valido anche se
   cambia l'IP.
2. Condividi → **Aggiungi alla schermata Home**: OpenSet si apre a schermo
   intero con la sua icona.
3. Via Wi-Fi il browser non può tenere acceso lo schermo (serve HTTPS):
   imposta Impostazioni → Schermo e luminosità → **Blocco automatico → Mai**.
   Sul computer (`localhost`) lo schermo resta acceso da solo.

Aggiornando dalla 0.3.x l'indirizzo perde `:39080`: aggiungi di nuovo l'icona
alla schermata Home, oppure avvia OpenSet con `PORT=39080`.

### Dove sono i dati

Scaletta (`setlist.json`), testi (`lyrics/`) e `custom.css` stanno in una
cartella dell'utente, che non si perde spostando o cancellando il programma:

| Sistema | Cartella |
|---|---|
| macOS | `~/Library/Application Support/OpenSet` |
| Windows | `%APPDATA%\OpenSet` |
| Linux | `~/.config/openset` (o `$XDG_CONFIG_HOME/openset`) |

Al primo avvio della 0.4.0 OpenSet copia lì i file che le versioni precedenti
tenevano accanto al programma (gli originali restano dove sono). Il percorso è
stampato all'avvio (`[data] ...`).

Nella stessa cartella c'è il registro `openset.log` (oltre 1 MB il precedente
diventa `openset.old.log`).

**Esportare i log** (se qualcosa non funziona):

1. Subito dopo il problema lascia aperti OpenSet e Live.
2. Nella pagina di OpenSet apri **Opzioni** e scorri fino a **Debug**.
3. Premi **Crea pacchetto log**: il browser salva `openset-<versione>-log-<data>.txt`
   nella cartella **Download** (versione, sistema, porte, stato di Live, registro e
   righe di OpenSet dal `Log.txt` di Live).
4. Invia il file con due righe: cosa stavi facendo e cosa è successo.

Se la pagina non si apre, invia `openset.log` dalla cartella dei dati:
macOS `open ~/Library/Application\ Support/OpenSet`, Windows `Win+R` →
`explorer %APPDATA%\OpenSet`, Linux `xdg-open ~/.config/openset`.

### Da sorgente (tutte le piattaforme, richiede Node.js ≥ 18)

```bash
git clone https://github.com/Darkglassd3v/openset.git
cd openset
npm install
npm start
```

## Come si usa

### Notazione dei locator (nell'Arrangement di Live)

È la stessa di AbleSet, quindi i set esistenti funzionano così come sono.

| Locator | Significato |
|---|---|
| `Nome Brano` | Inizia un nuovo brano |
| `>Ritornello` | Sezione dentro il brano corrente |
| `>>Ritornello` | Sezione rapida: pulsante grande nella vista Palco |
| `SONG END` (o `=END`) | Fine del brano: salta al successivo della scaletta e continua |
| `STOP`, `AUTOSTOP` (o `=STOP`) | Fine del brano: ferma la riproduzione e prepara il successivo |
| `. Nome Brano` | Ferma la riproduzione prima di questo brano |
| `STOP +JUMP` / `STOP +STAY` | Dopo lo stop salta (o resta) indipendentemente dalle opzioni |
| `>Ritornello +LOOP` | Loop della sezione finché non lo disattivi; `+LOOP:4` la suona 4 volte |
| `>Ritornello +PAUSE` | Ferma la riproduzione all'inizio della sezione |
| `>Assolo +SKIP` | La sezione viene saltata |
| `>Extra +END` | Da qui in poi le sezioni non contano nella durata del brano |
| `>Intro >>> Strofa 2` | Dopo l'Intro salta alla sezione "Strofa 2" (`>>> SONG END` chiude il brano) |
| `Brano {Capo 2}` | Descrizione, mostrata in scaletta e sul palco |
| `Brano #rock #bis` | Tag |
| `Brano [3:20]` | Durata impostata a mano |
| `Interludio [nosong]` | Non conta nella numerazione dei brani |
| `Brano [+2]`, `Brano [-3b]` | Traspone gli accordi (b = bemolli) |
| `Brano [.grande]` | Classe CSS per `custom.css` |
| `Brano [blue]` | Colore del brano e delle sue sezioni (colori di AbleSet) |
| `*nota` | Ignorato (anche i locator ClyphX `[...]`) |

Al posto dei locator di sezione puoi usare una **traccia MIDI chiamata `Sections`**
(o con `+SECTIONS` nel nome) con una clip vuota per sezione (il nome della clip è
il nome della sezione). Con `+CC` nel nome della traccia le sezioni prendono il
colore delle clip.

I salti che continuano la riproduzione vengono inviati una quantizzazione prima
del confine: imposta la **quantizzazione globale** di Live (es. 1 battuta, anche
dalle Opzioni di OpenSet) e metti i confini sulla griglia per transizioni esatte.
Gli stop non si possono quantizzare: lascia un attimo di silenzio prima di `STOP`.

### Testi sincronizzati

**Da Live**: crea una traccia MIDI con `+LYRICS` nel nome (es. `Voce +LYRICS`)
e una clip per riga; il nome della clip è il testo. `Voce +LYRICS [+2]` traspone.

**Da file**: crea `lyrics/<Nome Brano>.json` nella [cartella dei dati](#dove-sono-i-dati) (stesso nome del locator, accenti compresi):

```json
{
  "lines": [
    { "beat": 0, "chords": "Am F", "text": "Prima riga" },
    { "beat": 8, "text": "[C]Seconda riga con [G]accordi" }
  ]
}
```

`beat` = quarti dall'inizio del brano. Gli accordi si scrivono in una riga
`chords` separata oppure in linea con la sintassi ChordPro (`[Am]`).

### Scaletta, Palco e Opzioni

- **Scaletta**: tocca un brano o una sezione per saltarci. **Modifica scaletta**
  permette di riordinare (trascinando la maniglia ⠿ o con ↑ ↓), saltare brani,
  fermarsi dopo un brano, scrivere note per il palco, salvare e caricare scalette
  diverse (sovrascrivendo, la versione precedente resta tra i backup) e stamparle.
  **+ Aggiungi** o `Ctrl+K` cerca un brano per titolo, iniziali o `#tag` e lo
  aggiunge in fondo a quelli da suonare; *Togli tutti* parte da una scaletta vuota.
  **Copia** / **Incolla** (o `Ctrl+C` / `Ctrl+V` nell'editor) scambiano la
  scaletta come testo, un brano per riga: `{nota}` accanto al titolo, una riga
  `-- stop --` per fermarsi dopo il brano sopra; i titoli scritti male vengono
  riconosciuti lo stesso.
  Tutto viene salvato in `setlist.json` nella [cartella dei dati](#dove-sono-i-dati).
- **Modalità di salto** (Opzioni → *Quando saltare mentre suona*): *Subito* salta
  con la quantizzazione di Live; *A fine sezione*, *A fine brano*, *Dinamico*
  (sezioni a fine sezione, brani a fine brano) e *Manuale* (allo stop) mettono
  in **coda** il brano o la sezione che tocchi mentre suona: la barra «In coda»
  ha *Salta* (`J`), *Subito* (`⇧J`) e *Annulla* (`C`).
- **Palco**: la vista da mettere sul leggio o sul monitor. In Opzioni → *Questo
  dispositivo* scegli cosa mostrare su ogni telefono o tablet (tempi, prossimo
  brano, note, pulsanti delle sezioni, riga del testo corrente e successiva).
- **Opzioni**: *Ferma sempre a fine brano*, *Dopo uno stop porta il cursore al
  brano successivo*, *Avvia la riproduzione quando salti*, quantizzazione di Live,
  modalità di salto, *Stop invece di pausa*, count-in di sezione (con il solo del
  click), *Togli i brani suonati*, riattiva l'automazione e Back to Arrangement a
  ogni brano, vista all'apertura per i dispositivi nuovi, apertura del browser e
  di Live, strumenti per colori e locator, mappature MIDI. La guida PDF le spiega
  una per una.
- **Questo dispositivo**: nome (anche più tag separati da virgola, es.
  `ipad-1, palco`), vista all'apertura e **blocco** (`⇧L` o *Blocca questo
  dispositivo*): un dispositivo bloccato ignora tocchi e tasti, si sblocca tenendo
  premuto il lucchetto. In *Dispositivi collegati* vedi tutti i browser aperti.
- **Sicurezza**: il **Safe Mode** impedisce di cambiare brano dalla web app mentre
  suona e chiede conferma prima dello stop (MIDI e OSC non sono limitati). Con una
  **password** (almeno 6 caratteri, si imposta dal computer con OpenSet) gli altri
  dispositivi restano in sola lettura finché non toccano *Sblocca*; il computer con
  Live non la chiede mai. Non protegge l'OSC: per quello usa il firewall. I
  computer di riserva con password non ricevono i comandi ripetuti dal principale
  (la lista della ridondanza lo segnala).

### Durate dei brani

In ordine di priorità: la durata scritta nel locator (`[3:20]`), l'automazione
del tempo del file `.als` caricato, la durata **misurata** l'ultima volta che il
brano è stato suonato dall'inizio alla fine senza salti né loop, e infine una
stima a tempo costante. L'automazione del tempo vale offline e anche con Live
connesso, se il `.als` caricato ha gli stessi locator del set aperto. Il `.als` si
carica da Opzioni → *Progetto .als* (dal computer su cui gira OpenSet) oppure
all'avvio: `./openset-0.6.2 "/percorso/Progetto Project/Progetto.als"`.
Salva il progetto in Live prima di caricarlo, così il file è aggiornato.

Le durate misurate si azzerano da *Modifica scaletta*.

### Annunci vocali

In Opzioni → *Questo dispositivo* attiva l'annuncio del brano, della sezione
successiva (due battute prima) e il count-in parlato sull'ultima battuta. La voce
è quella del browser e esce dall'uscita audio di quel dispositivo: collega il
telefono o il computer all'in-ear o al mixer.

### Ridondanza a due computer

1. Su entrambi i computer apri lo stesso set, avvia OpenSet e attiva **Ableton Link**
   in Live (tiene insieme tempo e fase).
2. Sul computer principale, Opzioni → *Ridondanza*: aggiungi l'indirizzo della riserva (`http://<ip-riserva>`, con `:39080` se la riserva non usa la porta 80).
3. Ogni comando dato al principale (browser, tastiera, MIDI, OSC, HTTP) viene
   ripetuto sulla riserva; la lista mostra se la riserva è raggiungibile, se il
   suo Live è connesso e lo scarto in beat. Puoi collegarli anche in entrambe le
   direzioni.
4. Sulla riserva scegli *Questo computer è: la riserva* e attiva la **correzione
   automatica dello scarto** (phase nudge di Live); da ferma, *Sincronizza ora* la
   fa partire a tempo col principale. Scena, rete e finestre restano di ogni computer.

Il passaggio dell'audio da un computer all'altro resta all'interfaccia audio o al mixer.

### Tastiera, pedali e MIDI

| Tasto | Azione |
|---|---|
| `Spazio` | Play / Stop |
| `→` `PagGiù` | Brano successivo |
| `←` `PagSu` | Inizio brano, poi brano precedente |
| `↓` `↑` | Sezione successiva / precedente |
| `L` | Loop della sezione corrente |
| `J` / `⇧J` / `C` | Salta al brano o alla sezione in coda / subito / annulla |
| `⇧L` | Blocca o sblocca questo dispositivo |
| `Ctrl+K` | Aggiungi brani alla scaletta |
| `Ctrl+C` / `Ctrl+V` | Nell'editor: copia / incolla la scaletta come testo |

I pedali Bluetooth "volta pagina" inviano proprio questi tasti.
Per il **MIDI** apri OpenSet (`http://localhost`) in Chrome o Edge sul computer con
il controller, vai in Opzioni → MIDI, scegli l'azione e premi *Impara da MIDI*.
Le mappature (note, CC, program change) restano salvate.

### Controllo esterno

**OSC** (UDP `39051`, stessi indirizzi di AbleSet): `/global/play`, `/global/stop`,
`/global/playStop`, `/global/continuePlaying`, `/global/tempo`, `/global/tempo/adjust`,
`/global/quantization`, `/setlist/jumpToSong` (numero, negativo, nome o `RANDOM`),
`/setlist/jumpBySongs`, `/setlist/jumpToSection`, `/setlist/jumpBySections`,
`/setlist/jumpToQuickPlaySection`, `/setlist/jumpToTime`, `/setlist/jumpToQueued`,
`/setlist/clearQueuedJump`, `/loop/enable`, `/loop/escape`, `/loop/toggle`,
`/devices/showPage`, `/devices/reload`, `/devices/lock`, `/devices/unlock`,
`/devices/toggleLock` (con `all`, un nome o tag, o un IP).
Con `/subscribe [host] <porta>` OpenSet invia gli aggiornamenti
(`/global/isPlaying`, `/global/tempo`, `/setlist/activeSongName`,
`/setlist/activeSectionName`, `/setlist/songs`, `/setlist/nextSongName`,
`/setlist/queuedName`, `/devices/names`, `/settings/safeMode`, …);
`/getValues <porta>` li invia una volta.

**HTTP**: `POST /api/cmd` con JSON, ad esempio `{"cmd":"next"}`,
`{"cmd":"song","index":2}`, `{"cmd":"section","name":"Ritornello"}`,
`{"cmd":"loopToggle"}`. Lo stato completo è in `GET /api/state`. Con una
password impostata, da un altro computer aggiungi l'header
`X-OpenSet-Password: <password>` (5 tentativi sbagliati bloccano l'indirizzo per 30 s;
con IPv6 tutta la sua rete /64). Questo header porta la password in chiaro: usalo solo
da programmi su una rete fidata. L'app web invece non la manda mai: manda una prova
calcolata dalla password.
Le richieste da pagine di altri siti vengono rifiutate.

**Stile**: un file `custom.css` nella [cartella dei dati](#dove-sono-i-dati) viene caricato dall'interfaccia.

## Architettura

```
Ableton Live 12
   └─ Remote Script "OpenSet" (Python)  ←UDP JSON→  Server (Node.js / binario)
                                                        ├─ HTTP  :80 o :39080 (web UI, API)
                                                        ├─ WebSocket     (stato realtime)
                                                        └─ OSC   :39051  (TouchOSC, Companion)
Telefono / Tablet  ──Wi-Fi──▶  http://<ip>  (QR in Opzioni)
```

Porte: `39050` (comandi → Live), `39061` (stato ← Live, solo da questo computer),
`39051` (OSC, la stessa di AbleSet), `80` o `39080` (web).

## Sviluppo

```bash
npm test                                            # test del server (node:test)
npm run coverage                                    # con copertura
python3 -m unittest discover -s remote-script/tests # test del Remote Script
npm run e2e                                         # test della UI nel browser (Playwright sul Chrome di sistema)
node scripts/build-guide.js build/guida.pdf         # guida PDF (Chrome headless)
```

La CI esegue test, build del binario e prova di avvio su Windows, macOS e Linux,
più i test della UI in Chrome su Linux.

## Roadmap

- Canvas libero (elementi posizionabili a piacere)
- Annuncio Bonjour per i client OSC

## Licenza

MIT — usalo, modificalo, portalo sul palco.
