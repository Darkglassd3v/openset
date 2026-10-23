// Builds the release guide "OpenSet-<version>-Guida.pdf": a cover, a clickable
// index, then chapters from installing to troubleshooting, and last the news and
// fixes of this version (from CHANGELOG.md). The HTML is printed to PDF by
// headless Chrome; each chapter's header sits in a <thead>, which Chrome repeats
// on every page of the chapter.
//
// usage: node scripts/build-guide.js <out.pdf> [--html <out.html>]

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");

// "## 1.2.0 — 2026-10-21" headings, each followed by "- item" lines,
// optionally grouped by "### Novità" / "### Correzioni"
function changelogSections(md) {
  const sections = [];
  for (const line of md.split(/\r?\n/)) {
    const head = line.match(/^##\s+(\d+\.\d+\.\d+)\s*(?:[—-]\s*(\S+))?/);
    const sub = line.match(/^###\s+(.+)/);
    const cur = sections[sections.length - 1];
    if (head) sections.push({ version: head[1], date: head[2] || "", items: [], groups: [] });
    else if (cur && sub) cur.groups.push({ title: sub[1].trim(), items: [] });
    else if (cur && /^- /.test(line)) {
      const item = line.slice(2).trim();
      cur.items.push(item);
      if (!cur.groups.length) cur.groups.push({ title: "", items: [] });
      cur.groups[cur.groups.length - 1].items.push(item);
    }
  }
  return sections;
}

// text content only (no attributes), so quotes in commands stay copyable
const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
// the Markdown used in CHANGELOG.md: **bold**, *italic* and `code`
const inline = (t) =>
  esc(t)
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.+?)\*/g, "<i>$1</i>");
const list = (items) => `<ul>${items.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`;
const cmd = (...lines) => `<pre>${lines.map(esc).join("\n")}</pre>`;
const steps = (...items) => `<ol class="steps">${items.map((i) => `<li>${i}</li>`).join("")}</ol>`;
const tip = (html) => `<div class="box tip"><span class="label">Suggerimento</span>${html}</div>`;
const warn = (html) => `<div class="box warn"><span class="label">Attenzione</span>${html}</div>`;
const h3 = (id, title) => `<h3 id="${id}">${title}</h3>`;
const table = (head, rows) =>
  `<table class="grid"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;

function chapters(v, current, older) {
  const app = `OpenSet ${v}.app`;
  return [
    {
      id: "benvenuto",
      title: "Benvenuto",
      desc: "Cos'è OpenSet, come funziona e cosa serve",
      body: `
<p class="lead">OpenSet trasforma i locator del tuo progetto Ableton Live in una scaletta che comandi dal browser
di qualsiasi computer, telefono o tablet sulla stessa rete, senza internet. È gratuito, open source e usa la stessa
notazione di AbleSet: i set già preparati funzionano così come sono.</p>
${h3("come-funziona", "Come funziona")}
<div class="flow">
  <div class="node"><b>Ableton Live</b><span>il tuo set con i locator, più il Remote Script OpenSet</span></div>
  <div class="arrow">⇄</div>
  <div class="node accent"><b>OpenSet</b><span>il programma che gira sul computer con Live</span></div>
  <div class="arrow">⇄</div>
  <div class="node"><b>Telefoni, tablet, computer</b><span>aprono OpenSet nel browser, sulla stessa rete</span></div>
</div>
<p>Brani e sezioni, fine brano automatica, salti in coda, vista Palco per il leggio, testi e accordi, annunci vocali,
pedali, MIDI, OSC compatibile con AbleSet e un secondo computer di riserva.</p>
${h3("cosa-serve", "Cosa serve")}
<ul>
  <li>Ableton Live 11 o 12 su Windows 10/11 o macOS 11 o più recente.</li>
  <li>Telefoni e tablet sulla stessa rete del computer (Wi-Fi o cavo); internet non serve.</li>
  <li>Lo zip della tua piattaforma, dalla pagina Releases di GitHub (Darkglassd3v/openset) o da chi te l'ha mandato.</li>
</ul>
${h3("primi-passi", "I primi passi")}
<div class="cards">
  <a class="card" href="#installazione"><i>1</i><b>Installa</b><span>Windows, macOS o Linux</span></a>
  <a class="card" href="#live"><i>2</i><b>Collega Live</b><span>superficie di controllo e locator</span></a>
  <a class="card" href="#dispositivi"><i>3</i><b>Apri sui dispositivi</b><span>QR code, iPad, iPhone, Android</span></a>
  <a class="card" href="#uso"><i>4</i><b>Suona</b><span>scaletta, Palco, tasti e pedali</span></a>
</div>`,
    },
    {
      id: "installazione",
      title: "Installazione",
      desc: "Windows, macOS, Linux e aggiornamenti",
      body: `
<p class="lead">Ogni zip contiene il programma con la versione nel nome, il Remote Script per Live e questa guida.
OpenSet copia da solo il Remote Script nella User Library di Live.</p>
${h3("windows", "Windows")}
${steps(
  `Scarica <code>openset-${v}-win-x64.zip</code>, tasto destro → <b>Estrai tutto</b> (es. in <code>C:\\OpenSet</code>), oppure in PowerShell:
   ${cmd(`Expand-Archive openset-${v}-win-x64.zip -DestinationPath C:\\OpenSet`)}`,
  `Doppio clic su <code>openset-${v}.exe</code>. Se compare Windows SmartScreen: <b>Ulteriori informazioni → Esegui comunque</b>.
   Quando il firewall lo chiede, consenti l'accesso alle <b>reti private</b>.`,
  `Si apre una finestra con <code>OpenSet ${v}</code> e il browser con la scaletta. Per chiudere OpenSet chiudi quella finestra.`,
  `OpenSet copia il Remote Script in <code>Documenti\\Ableton\\User Library\\Remote Scripts\\OpenSet</code>.
   Riavvia Live e scegli OpenSet come superficie di controllo (capitolo <a href="#live">Collegare Ableton Live</a>).`
)}
<p class="note">Dal Prompt dei comandi: <code>openset-${v}.exe --no-open</code> (senza browser),
<code>set PORT=39080 &amp;&amp; openset-${v}.exe</code> (porta fissa).</p>
${h3("macos", "macOS")}
${steps(
  `Scarica <code>openset-${v}-macos-arm64.zip</code> (Apple Silicon M1–M4) o <code>openset-${v}-macos-x64.zip</code> (Intel),
   fai doppio clic per estrarlo e sposta <code>${esc(app)}</code> nella cartella <b>Applicazioni</b>.`,
  `Primo avvio: l'app non è firmata da Apple. Apri il Terminale e incolla:
   ${cmd(`xattr -dr com.apple.quarantine "/Applications/${app}"`)}
   In alternativa: tasto destro sull'app → <b>Apri</b> → Apri (su macOS 15: Impostazioni di Sistema → Privacy e sicurezza → <b>Apri comunque</b>).`,
  `Doppio clic su <code>${esc(app)}</code>: si apre il Terminale con <code>OpenSet ${v}</code> e il browser con la scaletta.
   Per chiudere OpenSet: <b>Ctrl+C</b> nel Terminale, o chiudi la sua finestra. Se macOS chiede di accettare connessioni in entrata, consenti.`,
  `OpenSet copia il Remote Script in <code>~/Music/Ableton/User Library/Remote Scripts/OpenSet</code>.
   Riavvia Live e scegli OpenSet come superficie di controllo.`
)}
<p class="note">Dal Terminale, con opzioni:</p>
${cmd(`APP="/Applications/${app}/Contents/Resources/openset-${v}"`, `codesign -v "$APP" || codesign --force --sign - "$APP"`, `"$APP" --no-open`, `PORT=39080 "$APP"`)}
${h3("linux", "Linux")}
<p>Ableton Live non esiste per Linux: usalo come postazione di controllo, o per una scaletta da un file <code>.als</code>.</p>
${cmd(`unzip openset-${v}-linux-x64.zip -d openset && cd openset`, `chmod +x openset-${v}`, `./openset-${v}`, `./openset-${v} "/percorso/Progetto Project/Progetto.als"   # offline`)}
<p class="note">Su Linux la porta 80 richiede root: l'indirizzo è <code>http://localhost:39080</code>.</p>
${h3("aggiornare", "Aggiornare da una versione precedente")}
${steps(
  `Chiudi la versione in uso (chiudi la sua finestra o Ctrl+C) e scarica lo zip di OpenSet ${v}.`,
  `Avvia la nuova versione come sopra; puoi cancellare la vecchia cartella o la vecchia app.`,
  `Il Remote Script viene aggiornato da solo: <b>riavvia Live</b>.`,
  `Se l'icona sulla schermata Home di iPad o iPhone non si apre più (indirizzo cambiato), aggiungila di nuovo.`
)}
${h3("dati", "Dove sono i dati")}
<p>Scalette, testi, registro e <code>custom.css</code> restano nella cartella dati dell'utente, anche quando aggiorni:</p>
${table(["Sistema", "Cartella"], [
  ["macOS", "<code>~/Library/Application Support/OpenSet</code>"],
  ["Windows", "<code>%APPDATA%\\OpenSet</code>"],
  ["Linux", "<code>~/.config/openset</code>"],
])}
<p class="note">Da OpenSet: Opzioni → <b>OpenSet</b> → <b>Cartella dei dati</b>.</p>`,
    },
    {
      id: "live",
      title: "Collegare Ableton Live",
      desc: "Superficie di controllo, locator, sezioni, colori e testi",
      body: `
<p class="lead">OpenSet legge i locator dell'Arrangement di Live: ogni brano inizia con un locator con il suo nome.</p>
${h3("superficie", "La superficie di controllo")}
${steps(
  `In Live apri Impostazioni (su Windows: Opzioni → Preferenze) → <b>Link, Tempo e MIDI</b>.`,
  `In una riga libera di <b>Superficie di controllo</b> scegli <b>OpenSet</b>, con Input e Output su Nessuno.`,
  `La spia in alto a sinistra di OpenSet diventa verde e compare «Live connesso».`
)}
${tip(`Se hai spostato la User Library di Live, OpenSet la trova da solo nelle impostazioni di Live. Se non la trova, copia a mano
la cartella <code>remote-script/OpenSet</code> dello zip nella sua cartella <code>Remote Scripts</code>, oppure usa
Opzioni → OpenSet → <b>Reinstalla il Remote Script</b>.`)}
${h3("locator", "Preparare il progetto: i locator")}
${table(["Locator", "Significato"], [
  ["<code>Nome Brano</code>", "Inizia un nuovo brano"],
  ["<code>&gt;Ritornello</code>", "Sezione del brano corrente"],
  ["<code>&gt;&gt;Ritornello</code>", "Sezione rapida: pulsante grande nella vista Palco"],
  ["<code>SONG END</code> (o <code>=END</code>)", "Fine del brano: passa al successivo della scaletta e continua"],
  ["<code>STOP</code> (o <code>=STOP</code>)", "Fine del brano: ferma la riproduzione e prepara il successivo"],
  ["<code>&gt;Ritornello +LOOP</code>", "Loop della sezione finché non lo togli; <code>+LOOP:4</code> la suona 4 volte"],
  ["<code>&gt;Ritornello +PAUSE</code>", "Ferma la riproduzione all'inizio della sezione"],
  ["<code>&gt;Assolo +SKIP</code>", "La sezione viene saltata"],
  ["<code>&gt;Intro &gt;&gt;&gt; Strofa 2</code>", "Dopo l'Intro salta alla sezione «Strofa 2»"],
  ["<code>Brano {Capo 2}</code> · <code>Brano #rock</code>", "Descrizione e tag, mostrati in scaletta e sul palco"],
  ["<code>Brano [3:20]</code>", "Durata scritta a mano"],
  ["<code>Brano [blue]</code>", "Colore del brano (anche delle sue sezioni)"],
  ["<code>*nota</code>", "Ignorato"],
])}
<p>Al posto dei locator di sezione puoi usare una <b>traccia MIDI chiamata <code>Sections</code></b> (o con <code>+SECTIONS</code>
nel nome) con una clip vuota per sezione: il nome della clip è il nome della sezione.</p>
${tip(`Imposta la <b>quantizzazione globale</b> di Live (es. 1 battuta, anche da Opzioni → Riproduzione) e metti i confini sulla
griglia: i salti arrivano esatti. Gli stop non si possono quantizzare: lascia un attimo di silenzio prima di <code>STOP</code>.`)}
${h3("colori", "Colori")}
<p>I colori di AbleSet (<code>red</code>, <code>orange</code>, <code>amber</code>, <code>yellow</code>, <code>lime</code>, <code>green</code>,
<code>teal</code>, <code>cyan</code>, <code>sky</code>, <code>blue</code>, <code>indigo</code>, <code>purple</code>, <code>pink</code>, <code>gray</code> e altri)
si scrivono tra parentesi quadre nel nome. Con <code>+CC</code> nel nome della traccia <code>Sections</code> le sezioni prendono il
colore delle clip di Live. Opzioni → Strumenti → <b>Colori delle clip dai nomi</b> colora le clip scritte come
<code>Strofa [blue]</code>.</p>
${h3("testi", "Testi e accordi")}
<p><b>Da Live</b>: una traccia MIDI con <code>+LYRICS</code> nel nome (es. <code>Voce +LYRICS</code>) e una clip per riga; il nome
della clip è il testo, <code>[Am]</code> mette un accordo. <code>Voce +LYRICS [+2]</code> traspone gli accordi.</p>
<p><b>Da file</b>: <code>lyrics/&lt;Nome Brano&gt;.json</code> nella cartella dei dati, con lo stesso nome del locator:</p>
${cmd(`{ "lines": [`, `  { "beat": 0, "chords": "Am F", "text": "Prima riga" },`, `  { "beat": 8, "text": "[C]Seconda riga con [G]accordi" }`, `] }`)}`,
    },
    {
      id: "dispositivi",
      title: "Telefoni e tablet",
      desc: "Collegare, installare come app, nome e blocco",
      body: `
<p class="lead">Ogni dispositivo sulla stessa rete apre OpenSet nel browser: nessuna app da installare.</p>
${h3("collegare", "Collegare un dispositivo")}
${steps(
  `Collega il dispositivo alla stessa rete del computer.`,
  `In OpenSet sul computer apri <b>Opzioni → Connetti un dispositivo</b> e inquadra il QR code con la fotocamera
   (oppure apri l'indirizzo stampato all'avvio; su Mac anche <code>http://&lt;nome-mac&gt;.local</code>).`,
  `Con più reti (Wi-Fi e cavo) scegli in <b>Rete da usare</b> quella dei dispositivi.`
)}
${h3("ipad-iphone", "iPad e iPhone")}
${steps(
  `Apri l'indirizzo in Safari, poi Condividi → <b>Aggiungi alla schermata Home</b>: OpenSet si apre a schermo intero con la sua icona.`,
  `Per lo schermo sempre acceso: Impostazioni → Schermo e luminosità → <b>Blocco automatico → Mai</b>.`
)}
<p class="note">Android: stessa procedura con Chrome (menu → Aggiungi a schermata Home).</p>
${h3("questo-dispositivo", "Questo dispositivo")}
<p>In Opzioni → <b>Questo dispositivo</b> ogni telefono o tablet ha le sue impostazioni:</p>
<ul>
  <li><b>Nome</b> (anche più tag separati da virgola, es. <code>ipad-1, palco</code>) e <b>vista all'apertura</b>.</li>
  <li>Cosa mostrare nella vista <b>Palco</b>: tempi, battiti, prossimo brano, note, pulsanti delle sezioni, riga del testo.</li>
  <li><b>Annunci vocali</b> del brano, della sezione successiva e del count-in: la voce esce da quel dispositivo (in-ear, mixer).</li>
  <li><b>Blocco</b>: <code>⇧ L</code> o <i>Blocca questo dispositivo</i>; un dispositivo bloccato ignora tocchi e tasti e si sblocca tenendo premuto il lucchetto.</li>
</ul>
<p>In <b>Dispositivi collegati</b> vedi tutti i browser aperti, con latenza e impostazioni.</p>`,
    },
    {
      id: "uso",
      title: "Usare OpenSet",
      desc: "Viste, comandi, coda dei salti, editor, tastiera e MIDI",
      body: `
${h3("viste", "Le viste")}
${table(["Vista", "A cosa serve"], [
  ["<b>Scaletta</b>", "Brani e sezioni: tocca per saltare. In fondo la durata totale e <i>Modifica scaletta</i>."],
  ["<b>Palco</b>", "Per il leggio o il monitor: brano, sezione, tempi rimanenti, prossimo brano, note."],
  ["<b>Testi</b>", "Testo e accordi del brano, con la riga corrente evidenziata."],
  ["<b>Opzioni</b>", "Impostazioni di OpenSet e di questo dispositivo."],
])}
<p>In alto la spia e lo stato di Live; un riquadro spiega il motivo se Live non è collegato. In basso:
<b>‹ Prec</b>, <b>Play</b>, <b>Pausa</b> (o <b>Stop</b>), <b>Loop</b>, <b>Succ ›</b> e la striscia della scaletta con la posizione.</p>
${h3("coda", "Salti e coda")}
<p>In Opzioni → Riproduzione scegli <b>Quando saltare mentre suona</b>: <i>Subito</i> (con la quantizzazione di Live),
<i>A fine sezione</i>, <i>A fine brano</i>, <i>Dinamico</i> o <i>Manuale</i> (allo stop). Nelle ultime quattro il brano o la sezione
che tocchi mentre suona va <b>in coda</b>: la barra «In coda» ha <i>Salta</i> (<code>J</code>), <i>Subito</i> (<code>⇧ J</code>) e
<i>Annulla</i> (<code>C</code>).</p>
${h3("editor", "Modificare la scaletta")}
<ul>
  <li>Riordina trascinando la maniglia ⠿ (anche col dito) o con ↑ ↓; <i>Salta</i> toglie un brano, <i>Stop dopo</i> ferma dopo di lui.</li>
  <li><b>+ Aggiungi</b> o <code>Ctrl K</code> cerca per titolo, iniziali o <code>#tag</code>; <i>Togli tutti</i> parte da una scaletta vuota.</li>
  <li><b>Copia</b> e <b>Incolla</b> scambiano la scaletta come testo: un brano per riga, <code>{nota}</code> accanto al titolo,
    una riga <code>-- stop --</code> per fermarsi; i titoli scritti male vengono riconosciuti.</li>
  <li><b>Salva</b> e <b>Carica</b> scalette diverse; sovrascrivendo, la versione precedente resta tra i backup.</li>
</ul>
${h3("tastiera", "Tastiera e pedali")}
${table(["Tasto", "Azione"], [
  ["<code>Spazio</code>", "Play / Pausa (o Stop)"],
  ["<code>→</code> <code>PagGiù</code>", "Brano successivo"],
  ["<code>←</code> <code>PagSu</code>", "Inizio brano, poi brano precedente"],
  ["<code>↓</code> <code>↑</code>", "Sezione successiva / precedente"],
  ["<code>L</code>", "Loop della sezione corrente"],
  ["<code>J</code> · <code>⇧ J</code> · <code>C</code>", "Salta al brano o alla sezione in coda · subito · annulla la coda"],
  ["<code>⇧ L</code>", "Blocca o sblocca questo dispositivo"],
  ["<code>Ctrl K</code>", "Aggiungi brani alla scaletta"],
  ["<code>Ctrl C</code> · <code>Ctrl V</code>", "Nell'editor: copia o incolla la scaletta come testo"],
])}
<p class="note">I pedali Bluetooth «volta pagina» inviano le frecce e PagSu/PagGiù.</p>
${h3("midi", "MIDI")}
<p>Apri OpenSet (<code>http://localhost</code>) in Chrome o Edge sul computer con il controller, vai in Opzioni → <b>MIDI</b>,
scegli l'azione e premi <b>Impara da MIDI</b>, poi il tasto del controller. Note, CC e program change restano salvati.
Il MIDI funziona da una sola scheda del browser alla volta.</p>
${h3("durate", "Durate dei brani")}
<p>In ordine: la durata scritta nel locator (<code>[3:20]</code>), l'automazione del tempo del file <code>.als</code> caricato
(Opzioni → Progetto .als), la durata misurata l'ultima volta che il brano è stato suonato per intero, infine una stima a
tempo costante. Le durate misurate si azzerano da <i>Modifica scaletta</i>.</p>`,
    },
    {
      id: "opzioni",
      title: "Opzioni",
      desc: "Riproduzione, count-in, sicurezza, strumenti, due computer",
      body: `
${h3("generale", "Generale")}
<ul>
  <li><b>Vista all'apertura</b>: la vista dei dispositivi nuovi; gli altri riaprono l'ultima usata.</li>
  <li><b>Apri OpenSet nel browser</b>: all'avvio di OpenSet, quando Live si collega, o mai; anche in una finestra senza schede (Chrome o Edge).</li>
  <li><b>Apri Live con l'ultimo progetto</b> all'avvio di OpenSet, se Live non è già aperto.</li>
</ul>
${h3("riproduzione", "Riproduzione")}
<ul>
  <li><b>Ferma sempre a fine brano</b>; <b>dopo uno stop porta il cursore al brano successivo</b>; <b>avvia la riproduzione quando salti</b>.</li>
  <li><b>Quantizzazione dei salti in Live</b> e <b>Quando saltare mentre suona</b> (capitolo <a href="#uso">Usare OpenSet</a>).</li>
  <li><b>Stop invece di pausa</b>: anche la barra spaziatrice ferma invece di mettere in pausa.</li>
  <li><b>«Brano precedente» torna prima all'inizio</b>; <b>disattiva il loop quando salti</b>; con un brano in coda <b>continua a suonare</b> anche se il brano finisce con STOP.</li>
  <li><b>Riattiva l'automazione</b> e <b>riporta le tracce all'Arrangement</b> a ogni salto di brano.</li>
  <li><b>Togli dalla scaletta i brani suonati</b> fino alla fine (si rimettono dall'editor).</li>
</ul>
${h3("count-in", "Count-in")}
<p>Da fermo, la sezione scelta parte 1, 2 o 4 battute prima, per provare un punto preciso. Con <b>Solo del click</b> durante
il count-in si sente solo la traccia del click (prima traccia o gruppo con «click», tracce <code>+CLICK</code>, Lifesine).</p>
${h3("sicurezza", "Sicurezza")}
<ul>
  <li><b>Safe Mode</b>: mentre suona, dalla web app non si cambia brano per errore e lo Stop chiede conferma. MIDI e OSC non sono limitati.</li>
  <li><b>Password</b> (almeno 6 caratteri, si imposta dal computer con OpenSet): gli altri dispositivi restano in sola lettura finché non
    toccano <b>Sblocca</b>. Il computer con OpenSet non la chiede mai. L'OSC resta aperto a tutta la rete.
    La password non passa sulla rete: il dispositivo manda solo una prova calcolata da lei, e OpenSet ne conserva solo una
    verifica che non basta per sbloccare. Un dispositivo sbloccato resta sbloccato finché lo usi; dopo 24 ore senza usarlo,
    o se si ricollega da un'altra rete (con IPv4 anche da un altro indirizzo), la chiede di nuovo. Scegli una password lunga, meglio una frase: chi ascolta la rete del
    locale vede la prova e potrebbe provare a indovinare una password corta. OpenSet usa HTTP senza cifratura (come AbleSet):
    su una rete Wi-Fi che usano anche altri, chi legge il traffico può copiare lo sblocco di un dispositivo. Meglio una rete
    Wi-Fi della band, con la sua password.</li>
</ul>
${h3("strumenti", "Strumenti")}
<ul>
  <li><b>Colori delle clip dai nomi</b>: <code>Strofa [blue]</code> sulla traccia <code>+CC</code> diventa una clip blu chiamata «Strofa».</li>
  <li><b>Metti i locator sulle sezioni</b> della traccia Sections, e <b>Togli i locator messi da OpenSet</b> (a Live fermo).</li>
</ul>
${h3("ridondanza", "Due computer (ridondanza)")}
${steps(
  `Su entrambi i computer apri lo stesso set, avvia OpenSet e attiva <b>Ableton Link</b> in Live.`,
  `Sul principale, Opzioni → <b>Ridondanza</b>: aggiungi l'indirizzo della riserva (es. <code>192.168.1.20:39080</code>).
   Sulla riserva scegli <b>Questo computer è: la riserva</b>.`,
  `Ogni comando dato al principale viene ripetuto sulla riserva; la lista mostra se è raggiungibile, se il suo Live è
   connesso e lo scarto in beat.`,
  `Sulla riserva attiva la <b>correzione automatica dello scarto</b>; da ferma, <b>Sincronizza ora</b> la fa partire a tempo col principale.`
)}
${warn(`Una riserva con la password rifiuta i comandi del principale: la lista lo segnala. Togli la password sulla riserva.`)}
${h3("menu", "Menu OpenSet e controllo esterno")}
<p>Dal computer con OpenSet: <b>Apri nel browser</b>, <b>Apri in una finestra</b>, <b>Cartella dei dati</b>, <b>Reinstalla il Remote Script</b>,
<b>Cambia il nome del computer</b>, <b>Controlla aggiornamenti</b>, <b>Esci da OpenSet</b> (tocca due volte).</p>
<p><b>OSC</b> sulla porta UDP <code>39051</code> con gli indirizzi di AbleSet (<code>/global/play</code>, <code>/setlist/jumpToSong</code>,
<code>/subscribe</code>…); <b>HTTP</b>: <code>POST /api/cmd</code> con JSON, es. <code>{"cmd":"next"}</code>. Un file <code>custom.css</code>
nella cartella dei dati cambia lo stile.</p>`,
    },
    {
      id: "log",
      title: "Diagnostica e log",
      desc: "Pacchetto log, file di registro, OpenSet con AbleSet",
      body: `
<p class="lead">Se qualcosa non funziona, manda il <b>pacchetto log</b>: un file di testo con tutto quello che serve per capire
il problema (versione, sistema, porte, stato di Live, registro di OpenSet e righe di OpenSet dal <code>Log.txt</code> di Live).</p>
${h3("pacchetto-log", "Esportare il pacchetto log")}
${steps(
  `Subito dopo il problema, lascia aperti OpenSet e Live.`,
  `Nella pagina di OpenSet (sul computer, o da telefono e tablet) apri <b>Opzioni</b> e scorri fino a <b>Debug</b>.`,
  `Premi <b>Crea pacchetto log</b>. Il browser salva <code>openset-&lt;versione&gt;-log-&lt;data&gt;.txt</code>
   nella cartella <b>Download</b>. Se è impostata una password, da telefono e tablet premi prima <b>Sblocca</b>.`,
  `Invia quel file (email, WhatsApp, Telegram) con due righe: cosa stavi facendo e cosa è successo.`
)}
<p><b>Mostra log</b>, accanto, fa vedere il registro sullo schermo.</p>
${h3("pagina-non-si-apre", "Se la pagina di OpenSet non si apre")}
<p>Il registro è anche nel file <code>openset.log</code> (e <code>openset.old.log</code>, se c'è) nella cartella dei dati.
Aprila e invia quei file.</p>
${table(["Sistema", "Come aprire la cartella"], [
  ["macOS", `nel Terminale: ${cmd("open ~/Library/Application\\ Support/OpenSet")}`],
  ["Windows", `premi <code>Win</code> + <code>R</code>, scrivi e premi Invio: ${cmd("explorer %APPDATA%\\OpenSet")}`],
  ["Linux", cmd("xdg-open ~/.config/openset")],
])}
<p>Se OpenSet si chiude appena aperto, copia anche il testo della sua finestra (Terminale su macOS e Linux,
finestra nera su Windows): l'errore è nelle ultime righe.</p>
${h3("ableset", "OpenSet e AbleSet insieme")}
<p>Possono restare aperti insieme. Live manda lo stato a OpenSet su una porta privata (<code>127.0.0.1:39061</code>).
La porta OSC <code>39051</code> è la stessa di AbleSet: se AbleSet la occupa, OpenSet parte con l'OSC spento e lo scrive
nel riquadro in alto. In Live tieni attive solo le superfici di controllo che usi.</p>`,
    },
    {
      id: "problemi",
      title: "Risoluzione dei problemi",
      desc: "I messaggi più comuni e cosa fare",
      body: `
${table(["Cosa vedi", "Cosa fare"], [
  ["<b>«OpenSet cannot start … already running»</b>", "C'è già un OpenSet aperto: chiudilo e riprova."],
  ["<b>Riquadro «Live non risponde»</b>", "La scaletta resta quella ricevuta per ultima; il riquadro dice il motivo (set in caricamento, Remote Script da aggiornare: riavvia Live). Se non passa, crea il pacchetto log."],
  ["<b>«OpenSet non raggiungibile…»</b>", "Il dispositivo ha perso il collegamento con il computer: si ricollega da solo. Controlla il Wi-Fi e che OpenSet sia aperto."],
  ["<b>La spia resta rossa</b>", "Riavvia Live e controlla che OpenSet sia scelto come superficie di controllo."],
  ["<b>Il telefono non apre l'indirizzo</b>", "Stessa rete del computer, firewall che consente le reti private; prova l'indirizzo IP invece di <code>.local</code>."],
  ["<b>Lo schermo del tablet si spegne</b>", "Blocco automatico su Mai: il browser non può impedirlo senza HTTPS."],
  ["<b>macOS dice che l'app è danneggiata</b>", "Esegui il comando <code>xattr</code> del capitolo <a href=\"#macos\">macOS</a>."],
  ["<b>«Sola lettura» sul telefono</b>", "È impostata una password: tocca <b>Sblocca</b> e inseriscila."],
  ["<b>Toccando un brano non succede niente</b>", "Mentre suona è attivo il Safe Mode, oppure il brano è in coda: guarda la barra «In coda»."],
  ["<b>La riserva «rifiuta i comandi»</b>", "La riserva ha una password: toglila su quel computer."],
])}
${tip(`Per qualsiasi altro problema: <a href="#pacchetto-log">esporta il pacchetto log</a> e mandalo con due righe di spiegazione.`)}`,
    },
    {
      id: "novita",
      title: `Novità e correzioni della versione ${v}`,
      desc: "Cosa cambia in questa versione, e le versioni precedenti",
      body: `
${current.date ? `<p class="lead">Rilasciata il ${esc(current.date)}.</p>` : ""}
${current.groups
  .map((g, i) => (g.title ? h3(`gruppo-${i + 1}`, esc(g.title)) : "") + `<div class="${/correz/i.test(g.title) ? "box fixes" : "box new"}">${list(g.items)}</div>`)
  .join("\n")}
${older.length ? h3("versioni-precedenti", "Versioni precedenti") : ""}
<div class="older">${older.map((s) => `<h4>${esc(s.version)}${s.date ? " — " + esc(s.date) : ""}</h4>${list(s.items)}`).join("")}</div>`,
    },
  ];
}

const CSS = (v) => `
  @page { size: A4; margin: 15mm 15mm 17mm;
    @bottom-center { content: "OpenSet ${v} · Guida · pagina " counter(page); font: 8pt system-ui, sans-serif; color: #8a8a90; } }
  @page :first { margin: 0; @bottom-center { content: none; } }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
  body { font: 10.5pt/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1b1b20; margin: 0; }
  a { color: #b56f00; text-decoration: none; }
  code { font: 9pt ui-monospace, "SF Mono", Consolas, monospace; background: #f4f2ec; padding: 0 3px; border-radius: 3px; }
  pre { background: #f4f2ec; border-left: 3px solid #ffb03a; border-radius: 0 6px 6px 0; padding: 7px 10px; margin: 6px 0;
    font: 9pt/1.45 ui-monospace, "SF Mono", Consolas, monospace; white-space: pre-wrap; word-break: break-all; }

  /* cover */
  .cover { height: 297mm; overflow: hidden; background: #0d0d11; color: #e8e6df; display: flex; flex-direction: column; align-items: center;
    justify-content: center; text-align: center; padding: 30mm; break-after: page; position: relative; }
  .cover-logo svg { width: 70mm; height: 70mm; border-radius: 14mm; box-shadow: 0 0 0 1px #2a2a33; }
  .cover h1 { font-size: 46pt; font-weight: 800; letter-spacing: -1.5px; margin: 12mm 0 0; }
  .cover h1 span, .brand span { color: #ffb03a; }
  .cover-tag { font-size: 14pt; color: #b9b7b0; margin: 3mm 0 0; }
  .cover-version { display: inline-block; margin: 10mm 0 0; padding: 2.5mm 7mm; border-radius: 99px; background: #ffb03a;
    color: #0d0d11; font-weight: 800; font-size: 13pt; }
  .cover-sub { margin: 6mm 0 0; color: #b9b7b0; }
  .cover-foot { position: absolute; bottom: 16mm; left: 0; right: 0; font-size: 9pt; color: #77757d; }

  /* index */
  .toc-page { break-after: page; }
  .toc-page h1 { font-size: 24pt; margin: 4mm 0 2mm; letter-spacing: -.5px; }
  .toc-page .lead { color: #555; margin: 0 0 8mm; }
  .toc ol { list-style: none; padding: 0; margin: 0; }
  .toc > ol > li { border-bottom: 1px solid #ecebe6; padding: 3.2mm 0; break-inside: avoid; }
  .toc > ol > li > a { display: flex; align-items: baseline; gap: 4mm; color: #1b1b20; }
  .toc .n { flex: none; width: 8mm; height: 8mm; border-radius: 50%; background: #0d0d11; color: #ffb03a; font-weight: 800;
    display: inline-flex; align-items: center; justify-content: center; font-size: 10pt; }
  .toc .t { font-weight: 700; font-size: 12pt; }
  .toc .d { color: #77757d; font-size: 9.5pt; margin-left: auto; text-align: right; }
  .toc ul { list-style: none; padding: 1mm 0 0 12mm; margin: 0; display: flex; flex-wrap: wrap; gap: 0 5mm; font-size: 9pt; }
  .toc ul a { color: #6b6b72; }

  /* chapters: the header band repeats on every page of the chapter */
  .chapter { break-before: page; }
  table.frame { width: 100%; border-collapse: collapse; }
  table.frame > thead { display: table-header-group; }
  table.frame > * > tr > td { padding: 0; }
  .band { display: flex; align-items: center; gap: 2.5mm; padding-bottom: 2mm; margin-bottom: 5mm; border-bottom: 2px solid #ffb03a;
    font-size: 8.5pt; color: #6b6b72; }
  .band svg { width: 5mm; height: 5mm; border-radius: 1.2mm; }
  .band .where { font-weight: 700; color: #1b1b20; text-transform: uppercase; letter-spacing: .08em; }
  .band .brand { margin-left: auto; font-weight: 700; color: #1b1b20; }
  h2 { font-size: 21pt; margin: 0 0 3mm; letter-spacing: -.4px; display: flex; align-items: center; gap: 3mm; break-after: avoid; }
  h2 .num { flex: none; width: 10mm; height: 10mm; border-radius: 2.5mm; background: #0d0d11; color: #ffb03a; font-size: 14pt;
    display: inline-flex; align-items: center; justify-content: center; }
  h3 { font-size: 12.5pt; margin: 7mm 0 2mm; padding-left: 3mm; border-left: 3px solid #ffb03a; break-after: avoid; }
  h4 { font-size: 10.5pt; margin: 4mm 0 1mm; }
  .lead { font-size: 11.5pt; color: #3a3a40; }
  .note { color: #555; font-size: 9.5pt; }
  ul { padding-left: 5mm; margin: 2mm 0; }
  li { margin: 1.2mm 0; }

  /* numbered steps */
  ol.steps { list-style: none; counter-reset: step; padding: 0; margin: 3mm 0; }
  ol.steps > li { counter-increment: step; position: relative; padding: 0 0 0 10mm; margin: 0 0 3.5mm; break-inside: avoid; }
  ol.steps > li::before { content: counter(step); position: absolute; left: 0; top: 0; width: 6.5mm; height: 6.5mm; border-radius: 50%;
    background: #ffb03a; color: #0d0d11; font-weight: 800; font-size: 9pt; display: flex; align-items: center; justify-content: center; }

  /* boxes */
  .box { border-radius: 2.5mm; padding: 3mm 4mm; margin: 4mm 0; break-inside: avoid; }
  .box > .label { display: block; font-size: 8.5pt; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 1mm; }
  .tip { background: #fff6e6; border: 1px solid #ffd79a; }
  .tip > .label { color: #b56f00; }
  .warn { background: #fdecec; border: 1px solid #f3b4b4; }
  .warn > .label { color: #b23b3b; }
  .new { background: #fff6e6; border: 1px solid #ffd79a; }
  .fixes { background: #eef6ef; border: 1px solid #b9dcbd; }
  .older { font-size: 9.5pt; color: #444; }

  /* tables */
  table.grid { width: 100%; border-collapse: collapse; margin: 3mm 0; font-size: 9.5pt; }
  table.grid th { text-align: left; background: #0d0d11; color: #e8e6df; padding: 2mm 3mm; font-weight: 600; }
  table.grid td { padding: 2mm 3mm; border-bottom: 1px solid #ecebe6; vertical-align: top; }
  table.grid tr { break-inside: avoid; }
  table.grid td pre { margin: 1mm 0 0; }

  /* "how it works" and first steps */
  .flow { display: flex; align-items: stretch; gap: 3mm; margin: 4mm 0; }
  .node { flex: 1; border: 1.5px solid #d8d6cf; border-radius: 3mm; padding: 3mm 4mm; text-align: center; }
  .node b { display: block; font-size: 11pt; }
  .node span { font-size: 9pt; color: #66646b; }
  .node.accent { background: #0d0d11; border-color: #0d0d11; color: #e8e6df; }
  .node.accent b { color: #ffb03a; }
  .node.accent span { color: #b9b7b0; }
  .arrow { align-self: center; font-size: 16pt; color: #ffb03a; }
  .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin: 4mm 0; }
  .card { display: block; border: 1.5px solid #ecebe6; border-radius: 3mm; padding: 3mm; color: #1b1b20; }
  .card i { font-style: normal; display: inline-flex; width: 6.5mm; height: 6.5mm; border-radius: 50%; background: #ffb03a; color: #0d0d11;
    font-weight: 800; align-items: center; justify-content: center; font-size: 9pt; }
  .card b { display: block; margin-top: 2mm; }
  .card span { font-size: 8.5pt; color: #77757d; }
`;

function guideHtml({ version: v, changelog, logoSvg }) {
  const sections = changelogSections(changelog);
  const current = sections.find((s) => s.version === v);
  if (!current) throw new Error(`CHANGELOG.md has no section for ${v}`);
  const older = sections.filter((s) => s !== current);
  const chs = chapters(v, current, older);
  const subs = (body) => [...body.matchAll(/<h3 id="([\w-]+)">(.*?)<\/h3>/g)].map((m) => [m[1], m[2]]);

  const toc = chs
    .map(
      (c, i) => `<li><a href="#${c.id}"><span class="n">${i + 1}</span><span class="t">${esc(c.title)}</span><span class="d">${esc(c.desc)}</span></a>
      <ul>${subs(c.body).map(([id, t]) => `<li><a href="#${id}">${t}</a></li>`).join("")}</ul></li>`
    )
    .join("\n");

  const body = chs
    .map(
      (c, i) => `<section class="chapter" id="${c.id}">
<table class="frame"><thead><tr><td><div class="band">${logoSvg}<span class="where">${i + 1} · ${esc(c.title)}</span><span class="brand">Open<span>Set</span> ${esc(v)}</span></div></td></tr></thead>
<tbody><tr><td>
<h2><span class="num">${i + 1}</span>${esc(c.title)}</h2>
${c.body}
</td></tr></tbody></table>
</section>`
    )
    .join("\n\n");

  return `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><title>OpenSet ${v} — Guida</title>
<style>${CSS(esc(v))}</style></head><body>

<section class="cover">
  <div class="cover-logo">${logoSvg}</div>
  <h1>Open<span>Set</span></h1>
  <p class="cover-tag">Controller di scaletta per Ableton Live</p>
  <p class="cover-version">Versione ${esc(v)}</p>
  <p class="cover-sub">Guida all'installazione e all'uso${current.date ? " · " + esc(current.date) : ""}</p>
  <p class="cover-foot">Open source e gratuito · github.com/Darkglassd3v/openset</p>
</section>

<div class="toc-page">
  <h1>Indice</h1>
  <p class="lead">Tocca un capitolo per andarci. Prima le funzioni di base, in fondo le novità e le correzioni di questa versione.</p>
  <nav class="toc"><ol>
${toc}
  </ol></nav>
</div>

${body}
</body></html>
`;
}

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    try {
      return execFileSync("which", [name], { encoding: "utf-8" }).trim();
    } catch {}
  }
  throw new Error("Chrome not found: set CHROME to its path");
}

if (require.main === module) {
  const out = path.resolve(process.argv[2] || "OpenSet-Guida.pdf");
  const htmlArg = process.argv.indexOf("--html");
  const { version } = require("../package.json");
  const html = guideHtml({
    version,
    changelog: fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf-8"),
    logoSvg: fs.readFileSync(path.join(ROOT, "docs", "brand", "logo.svg"), "utf-8"),
  });
  const htmlFile = htmlArg > 0 ? path.resolve(process.argv[htmlArg + 1]) : path.join(fs.mkdtempSync(path.join(os.tmpdir(), "openset-guide-")), "guida.html");
  fs.writeFileSync(htmlFile, html);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync(findChrome(), [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-pdf-header-footer",
    `--print-to-pdf=${out}`,
    "file://" + htmlFile,
  ], { stdio: "ignore" });
  if (!fs.existsSync(out)) throw new Error("Chrome did not write " + out);
  console.log(`${out} (OpenSet ${version})`);
}

module.exports = { changelogSections, guideHtml };
