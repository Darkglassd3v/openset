// Builds the release guide "OpenSet-<version>-Guida.pdf": what OpenSet is,
// what is new in this version (from CHANGELOG.md) and the step-by-step
// commands for every platform. The HTML is printed to PDF by headless Chrome.
//
// usage: node scripts/build-guide.js <out.pdf> [--html <out.html>]

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");

// "## 1.2.0 — 2026-10-21" headings, each followed by "- item" lines
function changelogSections(md) {
  const sections = [];
  for (const line of md.split(/\r?\n/)) {
    const head = line.match(/^##\s+(\d+\.\d+\.\d+)\s*(?:[—-]\s*(\S+))?/);
    if (head) sections.push({ version: head[1], date: head[2] || "", items: [] });
    else if (sections.length && /^- /.test(line)) sections[sections.length - 1].items.push(line.slice(2).trim());
  }
  return sections;
}

// text content only (no attributes), so quotes in commands stay copyable
const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
// the Markdown used in CHANGELOG.md: **bold** and `code`
const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`(.+?)`/g, "<code>$1</code>");
const list = (items) => `<ul>${items.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`;
const cmd = (...lines) => `<pre>${lines.map(esc).join("\n")}</pre>`;

function guideHtml({ version: v, changelog, logoSvg }) {
  const sections = changelogSections(changelog);
  const current = sections.find((s) => s.version === v);
  if (!current) throw new Error(`CHANGELOG.md has no section for ${v}`);
  const older = sections.filter((s) => s !== current);
  const app = `OpenSet ${v}.app`;
  return `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><title>OpenSet ${v} — Guida</title>
<style>
  @page { size: A4; margin: 16mm 16mm 18mm; }
  body { font: 11pt/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1b1b20; margin: 0; }
  .cover { display: flex; align-items: center; gap: 18px; border-bottom: 3px solid #ffb03a; padding-bottom: 14px; margin-bottom: 8px; }
  .cover svg { width: 84px; height: 84px; border-radius: 18px; flex-shrink: 0; }
  h1 { font-size: 26pt; margin: 0; letter-spacing: -.5px; }
  h1 span { color: #c77d00; }
  .sub { color: #555; margin: 2px 0 0; }
  h2 { font-size: 15pt; margin: 22px 0 6px; padding-bottom: 3px; border-bottom: 1px solid #ddd; break-after: avoid; }
  h3 { font-size: 12pt; margin: 14px 0 4px; break-after: avoid; }
  ol, ul { padding-left: 22px; margin: 6px 0; }
  li { margin: 3px 0; }
  ol > li { break-inside: avoid; }
  pre { background: #f4f2ec; border-left: 3px solid #ffb03a; padding: 7px 10px; margin: 6px 0; font: 9.5pt/1.45 ui-monospace, "SF Mono", Consolas, monospace; white-space: pre-wrap; word-break: break-all; }
  code { font: 9.5pt ui-monospace, "SF Mono", Consolas, monospace; background: #f4f2ec; padding: 0 3px; border-radius: 3px; }
  .new { background: #fff6e6; border: 1px solid #ffd79a; border-radius: 8px; padding: 4px 14px 8px; }
  .note { color: #555; font-size: 10pt; }
  table { border-collapse: collapse; margin: 6px 0; }
  td { padding: 3px 14px 3px 0; vertical-align: top; }
  .older h3 { font-size: 11pt; }
</style></head><body>

<div class="cover">${logoSvg}<div>
  <h1>Open<span>Set</span> ${esc(v)}</h1>
  <p class="sub">Controller di scaletta open-source per Ableton Live · guida all'installazione e all'uso${current.date ? " · " + esc(current.date) : ""}</p>
</div></div>

<p>OpenSet trasforma i locator del tuo progetto Live in una scaletta che comandi dal browser
di qualsiasi computer, telefono o tablet sulla stessa rete, senza internet: brani e sezioni,
fine brano automatica, vista Palco, testi e accordi, annunci vocali, MIDI, OSC compatibile con AbleSet.
Il programma gira sul computer con Live; gli altri dispositivi aprono il suo indirizzo nel browser.</p>

<h2>Novità della versione ${esc(v)}</h2>
<div class="new">${list(current.items)}</div>

<h2>Cosa serve</h2>
<ul>
  <li>Ableton Live 11 o 12 su Windows 10/11 o macOS 11 o più recente.</li>
  <li>Telefoni e tablet sulla stessa rete del computer (Wi-Fi o cavo), senza bisogno di internet.</li>
  <li>Lo zip della tua piattaforma dalla pagina Releases di GitHub (Darkglassd3v/openset).</li>
</ul>

<h2>Windows</h2>
<ol>
  <li>Scarica <code>openset-${v}-win-x64.zip</code>, tasto destro → <b>Estrai tutto</b> (es. in <code>C:\\OpenSet</code>), oppure in PowerShell:
    ${cmd(`Expand-Archive openset-${v}-win-x64.zip -DestinationPath C:\\OpenSet`)}</li>
  <li>Doppio clic su <code>openset-${v}.exe</code>. Se compare Windows SmartScreen: <b>Ulteriori informazioni → Esegui comunque</b>.
    Quando il firewall lo chiede, consenti l'accesso alle <b>reti private</b>.</li>
  <li>Si apre una finestra con <code>OpenSet ${v}</code> e il browser con la scaletta. Per chiudere OpenSet chiudi quella finestra.</li>
  <li>OpenSet copia da solo il Remote Script in <code>Documenti\\Ableton\\User Library\\Remote Scripts\\OpenSet</code>.
    Riavvia Live → Opzioni → Preferenze → <b>Link, Tempo e MIDI</b> → Superficie di controllo: <b>OpenSet</b>, Input e Output su Nessuno.</li>
</ol>
<p class="note">Dal Prompt dei comandi: <code>openset-${v}.exe --no-open</code> (senza browser),
<code>set PORT=39080 &amp;&amp; openset-${v}.exe</code> (porta fissa).</p>

<h2>macOS</h2>
<ol>
  <li>Scarica <code>openset-${v}-macos-arm64.zip</code> (Apple Silicon M1–M4) o <code>openset-${v}-macos-x64.zip</code> (Intel)
    e fai doppio clic per estrarlo. Sposta <code>${esc(app)}</code> nella cartella <b>Applicazioni</b>.</li>
  <li>Primo avvio: l'app non è firmata da Apple. Apri il Terminale e incolla:
    ${cmd(`xattr -dr com.apple.quarantine "/Applications/${app}"`)}
    In alternativa: tasto destro sull'app → <b>Apri</b> → Apri (su macOS 15: Impostazioni di Sistema → Privacy e sicurezza → <b>Apri comunque</b>).</li>
  <li>Doppio clic su <code>${esc(app)}</code>: si apre il Terminale con <code>OpenSet ${v}</code> e il browser con la scaletta.
    Per chiudere OpenSet: <b>Ctrl+C</b> nel Terminale, o chiudi la sua finestra. Se macOS chiede di accettare connessioni in entrata, consenti.</li>
  <li>OpenSet copia da solo il Remote Script in <code>~/Music/Ableton/User Library/Remote Scripts/OpenSet</code>.
    Riavvia Live → Impostazioni → <b>Link, Tempo e MIDI</b> → Superficie di controllo: <b>OpenSet</b>, Input e Output su Nessuno.</li>
</ol>
<p class="note">Dal Terminale, con opzioni:</p>
${cmd(`APP="/Applications/${app}/Contents/Resources/openset-${v}"`, `"$APP" --no-open`, `PORT=39080 "$APP"`)}

<h2>Linux</h2>
<p>Ableton Live non esiste per Linux: usalo come postazione di controllo, o per una scaletta da un file <code>.als</code>.</p>
${cmd(`unzip openset-${v}-linux-x64.zip -d openset && cd openset`, `chmod +x openset-${v}`, `./openset-${v}`, `./openset-${v} "/percorso/Progetto Project/Progetto.als"   # offline`)}
<p class="note">Su Linux la porta 80 richiede root: l'indirizzo è <code>http://localhost:39080</code>.</p>

<h2>Collegare Ableton Live</h2>
<ol>
  <li>Nel progetto metti un <b>locator</b> all'inizio di ogni brano con il suo nome; <code>&gt;Sezione</code> segna una sezione,
    <code>SONG END</code> chiude il brano, <code>STOP</code> ferma la riproduzione.</li>
  <li>In Live: Impostazioni → <b>Link, Tempo e MIDI</b> → Superficie di controllo → <b>OpenSet</b>. La spia in alto a sinistra diventa verde.</li>
  <li>Se hai spostato la User Library di Live, copia a mano la cartella <code>remote-script/OpenSet</code> dello zip nella sua cartella <code>Remote Scripts</code>.</li>
</ol>

<h2>iPad e iPhone</h2>
<ol>
  <li>Collega il dispositivo alla stessa rete del computer.</li>
  <li>In OpenSet sul computer apri <b>Opzioni → Connetti un dispositivo</b> e inquadra il QR code con la fotocamera
    (oppure apri in Safari l'indirizzo stampato all'avvio, su Mac <code>http://&lt;nome-mac&gt;.local</code>).</li>
  <li>Safari → Condividi → <b>Aggiungi alla schermata Home</b>: OpenSet si apre a schermo intero con la sua icona.</li>
  <li>Per lo schermo sempre acceso: Impostazioni → Schermo e luminosità → <b>Blocco automatico → Mai</b>.</li>
</ol>
<p class="note">Android: stessa procedura con Chrome (menu → Aggiungi a schermata Home).</p>

<h2>Aggiornare da una versione precedente</h2>
<ol>
  <li>Chiudi la versione in uso (chiudi la sua finestra o Ctrl+C) e scarica lo zip di OpenSet ${v}.</li>
  <li>Avvia la nuova versione come sopra; puoi cancellare la vecchia cartella o la vecchia app.</li>
  <li>Scalette, testi e <code>custom.css</code> restano nella cartella dati dell'utente:
    macOS <code>~/Library/Application Support/OpenSet</code>, Windows <code>%APPDATA%\\OpenSet</code>, Linux <code>~/.config/openset</code>.</li>
  <li>Il Remote Script viene aggiornato da solo: riavvia Live.</li>
  <li>Se l'icona sulla schermata Home di iPad o iPhone non si apre più (indirizzo cambiato), aggiungila di nuovo.</li>
</ol>

<h2>Scorciatoie da tastiera</h2>
<table>
  <tr><td><code>Spazio</code></td><td>Play / Stop</td></tr>
  <tr><td><code>→</code> <code>PagGiù</code></td><td>Brano successivo</td></tr>
  <tr><td><code>←</code> <code>PagSu</code></td><td>Inizio brano / brano precedente</td></tr>
  <tr><td><code>↓</code> <code>↑</code></td><td>Sezione successiva / precedente</td></tr>
  <tr><td><code>L</code></td><td>Loop della sezione corrente</td></tr>
</table>

<h2>Risoluzione dei problemi</h2>
<ul>
  <li><b>«OpenSet cannot start … already running»</b>: c'è già un OpenSet aperto, o AbleSet (stessa porta 39051). Chiudi l'altro programma.</li>
  <li><b>La spia resta rossa</b>: riavvia Live e controlla che OpenSet sia scelto come Superficie di controllo.</li>
  <li><b>Il telefono non apre l'indirizzo</b>: stessa rete del computer, firewall che consente le reti private, oppure prova l'indirizzo IP invece di <code>.local</code>.</li>
  <li><b>Lo schermo del tablet si spegne</b>: Blocco automatico su Mai (il browser non può impedirlo senza HTTPS).</li>
  <li><b>macOS dice che l'app è danneggiata o non verificata</b>: esegui il comando <code>xattr</code> del passo 2.</li>
</ul>

<h2>Versioni precedenti</h2>
<div class="older">${older.map((s) => `<h3>${esc(s.version)}${s.date ? " — " + esc(s.date) : ""}</h3>${list(s.items)}`).join("")}</div>
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
