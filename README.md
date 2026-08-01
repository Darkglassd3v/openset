# OpenSet

Controller di scaletta **open-source per Ableton Live**, ispirato ad AbleSet.
Trasforma il tuo progetto Live in una scaletta interattiva controllabile dal
browser di qualsiasi telefono, tablet o computer sulla stessa rete Wi-Fi —
senza internet.

## Funzionalità

- **Scaletta automatica** — legge i locator dell'Arrangement di Live e costruisce brani e sezioni navigabili
- **Controllo remoto via browser** — Play, Stop, salto a brani/sezioni, loop di un brano, da qualsiasi dispositivo in rete locale
- **Testi e accordi sincronizzati** — le righe si illuminano e scorrono a tempo con la musica
- **Striscia di avanzamento show** — panoramica dell'intero concerto con playhead in tempo reale
- **Modalità offline** — parser dei file `.als`: vedi la scaletta anche senza Live aperto
- **Cross-platform** — server su Windows, macOS e Linux; eseguibili standalone senza bisogno di installare Node.js

## Download

Scarica lo zip della tua piattaforma dall'ultima [**Release**](../../releases/latest):

| Piattaforma | File |
|---|---|
| Windows x64 | `openset-win-x64.zip` |
| macOS x64 (Apple Silicon via Rosetta) | `openset-macos-x64.zip` |
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
3. Apri `http://localhost:39080` sul PC o `http://<ip>:39080` dal telefono

### macOS

```bash
unzip openset-macos-x64.zip -d openset && cd openset
chmod +x openset
xattr -d com.apple.quarantine openset 2>/dev/null || true
./openset
```

1. Copia `remote-script/OpenSet` in `~/Music/Ableton/User Library/Remote Scripts/`
2. Riavvia Live → Impostazioni → **Link/Tempo/MIDI** →
   Superficie di controllo → **OpenSet** (Input/Output: Nessuno)
3. Apri `http://localhost:39080` sul Mac o `http://<ip>:39080` dal telefono

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

### Da sorgente (tutte le piattaforme, richiede Node.js ≥ 18)

```bash
git clone https://github.com/Darkglassd3v/openset.git
cd openset
npm install
npm start
```

## Come si usa

### Convenzione dei locator (nell'Arrangement di Live)

| Locator | Significato |
|---|---|
| `Nome Brano` | Inizia un nuovo brano |
| `>Ritornello` | Sezione dentro il brano corrente |
| `=END` | Fine del brano precedente (pausa tra i brani) |

### Testi sincronizzati

Crea `lyrics/<Nome Brano>.json` (stesso nome del locator):

```json
{
  "lines": [
    { "beat": 0, "chords": "Am F", "text": "Prima riga" },
    { "beat": 8, "chords": "C G",  "text": "Seconda riga" }
  ]
}
```

`beat` = quarti dall'inizio del brano.

## Architettura

```
Ableton Live 12
   └─ Remote Script "OpenSet" (Python)  ←UDP JSON→  Server (Node.js / binario)
                                                        ├─ HTTP  :39080  (web UI)
                                                        └─ WebSocket     (stato realtime)
Telefono / Tablet  ──Wi-Fi──▶  http://<ip>:39080
```

Porte locali: `39050` (comandi → Live), `39051` (stato ← Live), `39080` (web).

## Roadmap

- Ridondanza a due computer (stile AbleNet)
- Riordino della scaletta dal browser
- Binari nativi arm64 per Apple Silicon

## Licenza

MIT — usalo, modificalo, portalo sul palco.
