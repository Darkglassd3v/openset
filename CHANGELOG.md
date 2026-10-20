# Changelog

Tutte le novità di OpenSet, dalla versione più recente. La guida PDF di ogni
rilascio riporta la sezione della sua versione.

## 0.5.0 — 2026-10-21

- **Modalità di salto con coda** (come AbleSet): in Opzioni scegli *Subito*, *A fine sezione*, *A fine brano*, *Dinamico* o *Manuale*. Mentre suona, il brano o la sezione che tocchi vanno **in coda** (evidenziati, con la barra «In coda»): `J` salta, `⇧J` salta subito, `C` annulla. Via OSC: `/setlist/jumpToQueued`, `/setlist/clearQueuedJump`.
- **Editor della scaletta più veloce**: trascina i brani (anche col dito), **Ctrl+K** cerca per titolo, iniziali o `#tag` e aggiunge il brano in fondo a quelli da suonare, *Togli tutti* / *Rimetti tutti*, **copia e incolla la scaletta come testo** (un brano per riga, `{nota}`, `-- stop --`) con riconoscimento dei titoli scritti male.
- **Versioni precedenti delle scalette salvate**: sovrascrivendo una scaletta, la versione vecchia resta tra i backup e si ripristina dall'editor.
- **Dispositivi con nome**: ogni telefono o tablet ha un nome (anche più tag, es. `ipad-1, palco`) e una vista all'apertura; in Opzioni la lista dei dispositivi collegati con la latenza. Via OSC: `/devices/showPage`, `/devices/reload`, `/devices/lock`, `/devices/unlock`, `/devices/toggleLock`.
- **Blocco del dispositivo**: `⇧L` o *Blocca questo dispositivo* ignora tocchi e tasti; si sblocca tenendo premuto il lucchetto.
- **Safe Mode**: mentre suona, dalla web app non si cambia brano per errore e lo Stop chiede conferma. MIDI e OSC non sono limitati.
- **Password della web app** (facoltativa): gli altri dispositivi la chiedono per comandare e altrimenti restano in sola lettura; il computer con Live non la chiede mai. Salvata solo come hash.
- **Versione sempre visibile**: nel nome dello zip e del programma (`openset-0.5.0.exe`, `OpenSet 0.5.0.app`), all'avvio e nell'intestazione dell'app, con il logo.
- **Icona di OpenSet** sul programma Windows e sull'app macOS, che ora si apre con un doppio clic (Terminale con il registro e il browser).
- **Guida PDF** in ogni zip, con le novità e i passi per Windows, macOS, Linux, iPad e iPhone.

## 0.4.0 — 2026-10-20

- **Dati al sicuro**: scaletta (`setlist.json`), testi (`lyrics/`) e `custom.css` stanno in una cartella dell'utente (macOS `~/Library/Application Support/OpenSet`, Windows `%APPDATA%\OpenSet`, Linux `~/.config/openset`). Al primo avvio OpenSet ci copia i file delle versioni precedenti, senza cancellare gli originali.
- **Doppio clic e via**: all'avvio il browser si apre da solo (`--no-open` per non aprirlo).
- **Remote Script installato da solo** nella User Library di Live, su Windows e macOS. Finché Live non è collegato, la scaletta mostra i passi da fare.
- **Connetti un dispositivo**: in Opzioni ci sono gli indirizzi con il QR code da inquadrare con il telefono.
- **Indirizzo senza numero di porta**: OpenSet usa la porta 80 se è libera (`http://localhost`, `http://<nome-mac>.local`), altrimenti la 39080. `PORT` forza una porta.

## 0.3.1 — 2026-10-20

- **App su iPad e iPhone**: Safari → Condividi → Aggiungi alla schermata Home apre OpenSet a schermo intero, con la sua icona.
- **Schermo sempre acceso** sul computer (`localhost`); sugli altri dispositivi Opzioni spiega come impostare il Blocco automatico.
- Su macOS l'indirizzo Bonjour `<nome-mac>.local`, che resta valido anche se cambia l'IP, è stampato all'avvio.

## 0.3.0 — 2026-10-20

- **Sezioni e testi senza Live**: dalle tracce `Sections` e `+LYRICS` del file `.als`, anche offline.
- **Durate esatte**: dall'automazione del tempo del file `.als`, oppure misurate mentre suoni un brano dall'inizio alla fine.
- **Annunci vocali**: il nome della sezione in arrivo e il count-in parlato, sul dispositivo che scegli.
- **Computer di riserva** (stile AbleNet): i comandi vengono ripetuti su un secondo computer con OpenSet.
- **Vista Palco per dispositivo**: ogni telefono o tablet sceglie cosa mostrare, compresa la riga del testo.
- **Progetto `.als` da Opzioni**: caricamento del file dal computer su cui gira OpenSet.

## 0.2.0 — 2026-10-20

- **Notazione dei locator di AbleSet**: brani, sezioni, `SONG END`, `STOP`, note `{…}`, tag `#…`, durate `[m:ss]`, flag `+LOOP`, `+PAUSE`, `+SKIP`, transizioni `>>>`.
- **Motore dello show**: fine brano, stop, loop, sezioni saltate e transizioni, con salti quantizzati che arrivano esattamente sul confine.
- **Editor della scaletta**: ordine, brani saltati, stop dopo un brano, note per il palco, scalette salvate, stampa, durata totale.
- **Vista Palco**, **testi e accordi** sincronizzati (ChordPro, trasposizione), **scorciatoie** da tastiera e pedali, **MIDI**, **OSC** compatibile con AbleSet, **HTTP**.
- **Eseguibili** per Windows, macOS (anche Apple Silicon) e Linux, senza installare Node.js.

## 0.1.0 — 2026-08-01

- Prima versione: scaletta dai locator di Live, interfaccia web dal telefono, Remote Script per Ableton Live.
