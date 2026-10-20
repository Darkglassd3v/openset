# OpenSet

Controller di scaletta **open-source per Ableton Live**, ispirato ad AbleSet.
Trasforma il tuo progetto Live in una scaletta interattiva controllabile dal
browser di qualsiasi telefono, tablet o computer sulla stessa rete Wi-Fi —
senza internet.

## Funzionalità

- **Scaletta automatica** — legge i locator dell'Arrangement di Live (stessa notazione di AbleSet) e costruisce brani e sezioni navigabili, anche da una traccia MIDI `Sections`
- **Fine brano intelligente** — `SONG END` passa al brano successivo della scaletta, `STOP` ferma e prepara il successivo; i salti sono quantizzati e arrivano esattamente sul confine
- **Automazioni** — loop di sezione (`+LOOP`, `+LOOP:4`), pause (`+PAUSE`), sezioni saltate (`+SKIP`), transizioni (`Intro >>> Strofa 2`)
- **Editor della scaletta** — riordina, salta brani, stop dopo un brano, note per il palco, salva/carica più scalette, stampa, durata totale
- **Vista Palco** — brano e sezione in grande, prossimo brano, tempo rimanente nel brano e nello show, battiti, sezioni rapide
- **Testi e accordi sincronizzati** — file JSON o traccia MIDI `+LYRICS` (una clip per riga), accordi ChordPro trasposti per brano
- **Annunci vocali** — nome della sezione successiva e count-in parlato, sul dispositivo che vuoi (cuffie, in-ear)
- **Durate reali** — dall'automazione del tempo del file `.als` o misurate mentre suoni
- **Ridondanza a due computer** — i comandi vengono ripetuti su un secondo computer con OpenSet (stile AbleNet)
- **Controllo remoto** — browser, tastiera e pedali Bluetooth, MIDI (Web MIDI), OSC compatibile AbleSet (TouchOSC, Bitfocus Companion), HTTP
- **Striscia di avanzamento show** — panoramica del concerto, nell'ordine della scaletta, con playhead in tempo reale
- **Modalità offline** — parser dei file `.als`: scaletta, sezioni (anche dalla traccia `Sections`), testi `+LYRICS` e tempi anche senza Live aperto
- **Cross-platform** — Windows, macOS (Apple Silicon nativo e Intel) e Linux; eseguibili standalone senza installare Node.js

## Download

Scarica lo zip della tua piattaforma dall'ultima [**Release**](../../releases/latest):

| Piattaforma | File |
|---|---|
| Windows x64 | `openset-win-x64.zip` |
| macOS Apple Silicon (M1–M4) | `openset-macos-arm64.zip` |
| macOS Intel | `openset-macos-x64.zip` |
| Linux x64 | `openset-linux-x64.zip` |

Ogni zip contiene l'eseguibile, il Remote Script per Live, l'interfaccia web,
il file `openset_<versione>`, `VERSION.txt` e la guida `INSTALL.txt`.

## Installazione

### Windows

```powershell
Expand-Archive openset-win-x64.zip -DestinationPath C:\OpenSet
cd C:\OpenSet
.\openset.exe
```

1. Copia la cartella `remote-script\OpenSet` in
   `C:\Users\<tu>\Documents\Ableton\User Library\Remote Scripts\`
   (crea `Remote Scripts` se non esiste)
2. Riavvia Live → Opzioni → Preferenze → **Link/Tempo/MIDI** →
   Superficie di controllo → **OpenSet** (Input/Output: Nessuno)
3. Apri `http://localhost:39080` sul PC o `http://<ip>:39080` dal telefono.
   Al primo avvio consenti l'accesso alla **rete privata** nel firewall.

### macOS

```bash
unzip openset-macos-arm64.zip -d openset && cd openset   # Mac Intel: openset-macos-x64.zip
chmod +x openset
xattr -d com.apple.quarantine openset 2>/dev/null || true
./openset
```

1. Copia `remote-script/OpenSet` in `~/Music/Ableton/User Library/Remote Scripts/`
2. Riavvia Live → Impostazioni → **Link/Tempo/MIDI** →
   Superficie di controllo → **OpenSet** (Input/Output: Nessuno)
3. Apri `http://localhost:39080` sul Mac o `http://<ip>:39080` dal telefono.
   Se macOS chiede di accettare connessioni in entrata, consenti.

### Linux

```bash
unzip openset-linux-x64.zip -d openset && cd openset
chmod +x openset
./openset
```

Ableton Live non esiste per Linux: usa la macchina Linux come postazione di
controllo remoto, oppure carica un progetto offline:

```bash
./openset "/percorso/Progetto Project/Progetto.als"
```

Se all'avvio compare `OpenSet cannot start: ... (is OpenSet or AbleSet already running?)`,
c'è già un'istanza aperta (o AbleSet, che usa la stessa porta 39051): chiudila.

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
| `*nota` | Ignorato (anche i locator ClyphX `[...]`) |

Al posto dei locator di sezione puoi usare una **traccia MIDI chiamata `Sections`**
con una clip vuota per sezione (il nome della clip è il nome della sezione).

I salti che continuano la riproduzione vengono inviati una quantizzazione prima
del confine: imposta la **quantizzazione globale** di Live (es. 1 battuta, anche
dalle Opzioni di OpenSet) e metti i confini sulla griglia per transizioni esatte.
Gli stop non si possono quantizzare: lascia un attimo di silenzio prima di `STOP`.

### Testi sincronizzati

**Da Live**: crea una traccia MIDI con `+LYRICS` nel nome (es. `Voce +LYRICS`)
e una clip per riga; il nome della clip è il testo. `Voce +LYRICS [+2]` traspone.

**Da file**: crea `lyrics/<Nome Brano>.json` (stesso nome del locator, accenti compresi):

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
  permette di riordinare (↑ ↓), saltare brani, fermarsi dopo un brano, scrivere
  note per il palco, salvare e caricare scalette diverse e stamparle.
  Tutto viene salvato in `setlist.json` accanto all'eseguibile.
- **Palco**: la vista da mettere sul leggio o sul monitor. In Opzioni → *Questo
  dispositivo* scegli cosa mostrare su ogni telefono o tablet (tempi, prossimo
  brano, note, pulsanti delle sezioni, riga del testo corrente e successiva).
- **Opzioni**: *Ferma sempre a fine brano*, *Dopo uno stop porta il cursore al
  brano successivo*, *Avvia la riproduzione quando salti*, quantizzazione di Live,
  mappature MIDI.

### Durate dei brani

In ordine di priorità: la durata scritta nel locator (`[3:20]`), l'automazione
del tempo del file `.als` caricato, la durata **misurata** l'ultima volta che il
brano è stato suonato dall'inizio alla fine senza salti né loop, e infine una
stima a tempo costante. L'automazione del tempo vale offline e anche con Live
connesso, se il `.als` caricato ha gli stessi locator del set aperto. Il `.als` si
carica da Opzioni → *Progetto .als* (dal computer su cui gira OpenSet) oppure
all'avvio: `./openset "/percorso/Progetto Project/Progetto.als"`.
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
2. Sul computer principale, Opzioni → *Ridondanza*: aggiungi `http://<ip-riserva>:39080`.
3. Ogni comando dato al principale (browser, tastiera, MIDI, OSC, HTTP) viene
   ripetuto sulla riserva; la lista mostra se la riserva è raggiungibile, se il
   suo Live è connesso e lo scarto in beat. Puoi collegarli anche in entrambe le
   direzioni.

Il passaggio dell'audio da un computer all'altro resta all'interfaccia audio o al mixer.

### Tastiera, pedali e MIDI

| Tasto | Azione |
|---|---|
| `Spazio` | Play / Stop |
| `→` `PagGiù` | Brano successivo |
| `←` `PagSu` | Inizio brano, poi brano precedente |
| `↓` `↑` | Sezione successiva / precedente |
| `L` | Loop della sezione corrente |

I pedali Bluetooth "volta pagina" inviano proprio questi tasti.
Per il **MIDI** apri `http://localhost:39080` in Chrome o Edge sul computer con
il controller, vai in Opzioni → MIDI, scegli l'azione e premi *Impara da MIDI*.
Le mappature (note, CC, program change) restano salvate.

### Controllo esterno

**OSC** (UDP `39051`, stessi indirizzi di AbleSet): `/global/play`, `/global/stop`,
`/global/playStop`, `/global/continuePlaying`, `/global/tempo`, `/global/tempo/adjust`,
`/global/quantization`, `/setlist/jumpToSong` (numero, negativo, nome o `RANDOM`),
`/setlist/jumpBySongs`, `/setlist/jumpToSection`, `/setlist/jumpBySections`,
`/setlist/jumpToQuickPlaySection`, `/setlist/jumpToTime`, `/loop/enable`,
`/loop/escape`, `/loop/toggle`.
Con `/subscribe [host] <porta>` OpenSet invia gli aggiornamenti
(`/global/isPlaying`, `/global/tempo`, `/setlist/activeSongName`,
`/setlist/activeSectionName`, `/setlist/songs`, `/setlist/nextSongName`, …);
`/getValues <porta>` li invia una volta.

**HTTP**: `POST /api/cmd` con JSON, ad esempio `{"cmd":"next"}`,
`{"cmd":"song","index":2}`, `{"cmd":"section","name":"Ritornello"}`,
`{"cmd":"loopToggle"}`. Lo stato completo è in `GET /api/state`.

**Stile**: un file `custom.css` accanto all'eseguibile viene caricato dall'interfaccia.

## Architettura

```
Ableton Live 12
   └─ Remote Script "OpenSet" (Python)  ←UDP JSON→  Server (Node.js / binario)
                                                        ├─ HTTP  :39080  (web UI, API)
                                                        ├─ WebSocket     (stato realtime)
                                                        └─ OSC   :39051  (TouchOSC, Companion)
Telefono / Tablet  ──Wi-Fi──▶  http://<ip>:39080
```

Porte: `39050` (comandi → Live), `39051` (stato ← Live e OSC), `39080` (web).

## Sviluppo

```bash
npm test                                            # test del server (node:test)
npm run coverage                                    # con copertura
python3 -m unittest discover -s remote-script/tests # test del Remote Script
```

La CI esegue test, build del binario e prova di avvio su Windows, macOS e Linux.

## Roadmap

- Canvas libero (elementi posizionabili a piacere)
- Annuncio Bonjour per i client OSC
- Colori di brani e sezioni

## Licenza

MIT — usalo, modificalo, portalo sul palco.
