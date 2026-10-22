# Changelog

Tutte le novità di OpenSet, dalla versione più recente. La guida PDF di ogni
rilascio riporta la sezione della sua versione.

## 0.6.1 — 2026-10-23

### Correzioni

- **Due computer**: *Sincronizza ora* e la correzione dello scarto non seguono più un computer di riserva appena tolto dalla lista, anche quando ce ne sono altri; i computer tolti non vengono più letti; se una lettura di una riserva finisce mentre OpenSet si chiude, OpenSet non va più in crash.

## 0.6.0 — 2026-10-22

### Novità

- **Riproduzione come AbleSet**: *Stop invece di pausa* (il pulsante e la barra spaziatrice fermano invece di mettere in pausa), *«Brano precedente» torna prima all'inizio*, *Disattiva il loop quando salti*, *Riattiva l'automazione* e *Riporta le tracce all'Arrangement* a ogni salto di brano, *Con un brano in coda continua a suonare* anche se il brano finisce con STOP.
- **Count-in di sezione**: da fermo la sezione scelta parte 1, 2 o 4 battute prima; con *Solo del click* durante il count-in si sente solo la traccia del click (prima traccia o gruppo con «click», tracce `+CLICK`, Lifesine).
- **Togli i brani suonati**: un brano suonato fino alla fine esce dalla scaletta (si rimette dall'editor).
- **Colori come AbleSet**: `[blue]`, `[red]`… nel nome di brani e sezioni; con `+CC` sulla traccia `Sections` le sezioni prendono il colore delle clip di Live; `+SECTIONS` segna la traccia delle sezioni. Scaletta, sezioni e striscia sono colorate.
- **Strumenti**: *Colori delle clip dai nomi*, *Metti i locator sulle sezioni* e *Togli i locator messi da OpenSet*.
- **Generale**: *Vista all'apertura* per i dispositivi nuovi, *Apri OpenSet nel browser* all'avvio, quando Live si collega o mai, anche in una finestra senza schede, e *Apri Live con l'ultimo progetto*.
- **Due computer**: ogni computer è *principale* o *riserva*; la riserva corregge da sola lo scarto con il phase nudge di Live e da ferma si allinea con *Sincronizza ora*. Le impostazioni di ogni dispositivo si vedono in Opzioni.
- **Menu OpenSet** in Opzioni: apri nel browser o in una finestra, cartella dei dati, reinstalla il Remote Script, cambia il nome del computer, rete da usare per i dispositivi, controlla aggiornamenti, esci.
- **Guida PDF nuova**: copertina, indice cliccabile, capitoli con l'intestazione su ogni pagina, prima le funzioni di base e in fondo novità e correzioni.

### Correzioni

- **Motore**: con il loop di Live acceso non salta più al brano dopo; un salto in coda verso la sezione o il brano successivo non li fa più ripetere; dopo uno stop STOP, `+SKIP`, `+LOOP` e SONG END scattano di nuovo; una sezione `+LOOP` raggiunta con un salto va in loop; i salti verso sezioni senza locator non tagliano più l'ultima battuta; un rallentamento di Live non fa perdere uno STOP.
- **Count-in**: a inizio brano (battuta 0) il click non resta più in solo per tutto il brano, e il pre-roll non fa scattare lo STOP del brano prima.
- **Remote Script**: il solo del click e il phase nudge non restano accesi (traccia cancellata, chiusura dello script, Live fermato durante il count-in); se un pacchetto si perde, scaletta e clip arrivano di nuovo entro 10 s; lo script non si blocca più dopo un errore. Dopo l'aggiornamento riavvia Live.
- **Interfaccia**: un cambio di tempo non ricostruisce più la scaletta (tocchi, note e trascinamenti non si perdono); se il collegamento con OpenSet cade compare «OpenSet non raggiungibile…» e si riapre da solo, anche dopo che l'iPad si è addormentato; Spazio funziona dopo un clic; i testi non restano su «Nessun testo» per un errore di rete; funziona sugli iPad con iOS 12-14; incolla con la password, trascinamento e ricerca corretti; niente zoom di Safari sui campi.
- **Sicurezza**: un messaggio malformato da un dispositivo in rete non chiude più OpenSet; le pagine di altri siti aperte sul computer non possono comandarlo; la password ha almeno 6 caratteri, si imposta solo dal computer con OpenSet e i tentativi in parallelo contano tutti; l'OSC risponde solo a chi chiede; un `.als` difettoso o enorme non blocca il server; `setlist.json` è leggibile solo dall'utente.
- **Dati e rete**: incollare una scaletta da Note di Apple non chiude più OpenSet; `setlist.json` si scrive in modo sicuro e, se illeggibile, viene copiato a parte invece di essere sovrascritto; i dispositivi addormentati non riempiono la memoria; lo stato inviato ai dispositivi è compresso (da ~30 KB a ~2 KB); OpenSet riusa la porta dell'ultima volta, così le icone sull'iPad restano valide; una riserva con la password viene segnalata.
- **Due computer**: la riserva tiene le sue impostazioni (scena, rete, finestre); solo la riserva corregge lo scarto; un computer tolto dalla lista viene dimenticato.

## 0.5.1 — 2026-10-22

- **OpenSet e AbleSet insieme**: Live manda lo stato a OpenSet su una porta privata (`127.0.0.1:39061`), quindi AbleSet aperto sulla porta OSC `39051` non porta più via i messaggi di Live. Se la `39051` è occupata, OpenSet parte con l'OSC spento e lo dice. Dopo l'aggiornamento chiudi e riapri Live.
- **La scaletta non sparisce** quando Live smette di rispondere (set in caricamento, Live chiuso): resta l'ultima ricevuta e l'intestazione dice «Live non risponde».
- **Il motivo è sempre scritto**: un riquadro in alto spiega perché Live non è collegato (Remote Script da aggiornare o vecchio: riavvia Live; porta 39050 occupata; porta OSC occupata; nessun messaggio da Live).
- **Registro e pacchetto log** (come *Debug Logs* e *Create Log Package* di AbleSet): `openset.log` nella cartella dei dati; Opzioni → Debug → *Mostra log* e *Crea pacchetto log*, un file di testo con versione, sistema, porte, stato di Live, registro e le righe di OpenSet dal `Log.txt` di Live. Il Remote Script manda a OpenSet il suo avvio (con la versione di Live) e i suoi errori; anche un crash di OpenSet finisce nel registro.

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
