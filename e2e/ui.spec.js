// UI behaviour found by the 0.6.0 audit (A2), in Chrome against a real server and a fake Live
const fs = require("fs");
const path = require("path");
const { test, expect, LAN_IP } = require("./fixtures");

const connected = (page) => expect(page.locator("#connLabel")).toHaveText("Live connesso");
const tab = (page, view) => page.click(`nav button[data-view="${view}"]`);

test("a tempo change in Live keeps the setlist: taps, notes and drags survive", async ({ page, openset }) => {
  await page.goto(openset.url());
  await connected(page);
  const time = page.locator("#setlist .song-time").first();
  const before = await time.textContent();
  await page.locator('#setlist .chip[data-sec="1"]').first().evaluate((el) => { el.dataset.mark = "1"; });
  await page.locator("#strip .strip-seg").first().evaluate((el) => { el.dataset.mark = "1"; });
  for (const tempo of [100, 80, 60]) openset.live({ tempo });
  await expect(page.locator("#bpm")).toHaveText("60 BPM");
  await expect(time).not.toHaveText(before); // durations still follow the tempo
  await expect(page.locator('#setlist .chip[data-mark="1"]')).toHaveCount(1);
  await expect(page.locator('#strip .strip-seg[data-mark="1"]')).toHaveCount(1);

  let texts = 0;
  page.on("request", (r) => { if (r.url().includes("/api/setlist-text")) texts++; });
  await page.click('[data-act="edit"]');
  const note = page.locator("#setlist input.note").first();
  await note.click();
  await note.pressSequentially("Capo 2");
  for (const tempo of [90, 95]) openset.live({ tempo });
  await expect(page.locator("#bpm")).toHaveText("95 BPM");
  await expect(note).toBeFocused();
  await expect(note).toHaveValue("Capo 2");
  expect(texts).toBeLessThanOrEqual(1);
});

test("a dropped connection to OpenSet is shown instead of a frozen «Live connesso»", async ({ page, openset }) => {
  await page.goto(openset.url());
  await connected(page);
  await openset.stop();
  await expect(page.locator("#connLabel")).toHaveText("OpenSet non raggiungibile…");
  await expect(page.locator("#dot")).not.toHaveClass(/\bon\b/);
  await openset.restart();
  await expect(page.locator("#connLabel")).toHaveText("Live connesso", { timeout: 8000 });
});

test("Space plays after a click on a tab", async ({ page, openset }) => {
  await page.goto(openset.url());
  await connected(page);
  await tab(page, "setlist");
  const from = openset.cmds.length;
  await page.keyboard.press(" ");
  await expect.poll(() => openset.cmds.slice(from).some((c) => c.cmd === "play")).toBe(true);
});

test("an unlocked device pastes a setlist when a password is set", async ({ page, openset }) => {
  test.skip(!LAN_IP, "no LAN address");
  await openset.cmd({ cmd: "setPassword", password: "palco-2026" });
  await page.goto(openset.url("/", LAN_IP));
  await connected(page);
  await page.click("#unlockApp");
  await page.fill("#authPw", "palco-2026");
  await page.click("#authGo");
  await expect(page.locator("#unlockApp")).toBeHidden();
  await page.click('[data-act="edit"]');
  await page.click('[data-act="paste"]');
  await page.fill("#pasteText", "Finale\nIntro Song\nPerché");
  await page.click("#pasteApply");
  await expect(page.locator("#pastePanel")).toBeHidden();
  await expect.poll(async () => (await openset.state()).setlist[0].name).toBe("Finale");
});

test("a token from before an OpenSet restart is forgotten", async ({ page, openset }) => {
  test.skip(!LAN_IP, "no LAN address");
  await openset.cmd({ cmd: "setPassword", password: "palco-2026" });
  await page.goto(openset.url("/", LAN_IP));
  await page.evaluate(() => localStorage.setItem("openset.token", "f".repeat(64)));
  await page.reload();
  await connected(page);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("openset.token") || "")).toBe("");
});

test("the default view is for new devices; a device reopens its last view", async ({ page, openset }) => {
  await openset.cmd({ cmd: "settings", defaultView: "stage" });
  await page.goto(openset.url());
  await connected(page);
  await expect(page.locator("#stage")).toBeVisible();
  await tab(page, "setlist");
  await page.reload();
  await connected(page);
  await expect(page.locator("#stage")).toBeHidden();
  await expect(page.locator("#setlist")).toBeVisible();
});

test("Opzioni lists are not rebuilt when only the latency changes", async ({ page, openset }) => {
  await page.goto(openset.url());
  await connected(page);
  await tab(page, "settings");
  await expect(page.locator("#deviceList li").first()).toBeVisible();
  const kept = await page.evaluate(() => {
    const el = document.querySelector("#deviceList li");
    state = { ...state, devices: state.devices.map((d) => ({ ...d, latencyMs: 777 })) };
    render();
    return el.isConnected && el.textContent.includes("777");
  });
  expect(kept).toBe(true);
});

test("a backup computer can be added without http://; setlist names are capped", async ({ page, openset }) => {
  await page.goto(openset.url());
  await connected(page);
  await tab(page, "settings");
  await page.fill("#peerUrl", "127.0.0.1:39999");
  await page.click("#peerAdd");
  await expect.poll(async () => (await openset.state()).peers.map((p) => p.url)).toEqual(["http://127.0.0.1:39999"]);
  await tab(page, "setlist");
  await page.click('[data-act="edit"]');
  await expect(page.locator("#saveName")).toHaveAttribute("maxlength", "64");
});

test("lyrics: no «Nessun testo» while loading, and a failed load is retried", async ({ page, openset }) => {
  fs.mkdirSync(path.join(openset.baseDir, "lyrics"));
  fs.writeFileSync(path.join(openset.baseDir, "lyrics", "Intro Song.json"), JSON.stringify({ lines: [{ beat: 0, text: "Prima riga" }] }));
  let calls = 0;
  await page.route("**/api/lyrics/**", async (route) => {
    if (++calls === 1) return route.abort();
    await new Promise((r) => setTimeout(r, 700));
    return route.continue();
  });
  await page.addInitScript(() => {
    window.sawNone = false;
    new MutationObserver(() => {
      const el = document.getElementById("lyrics");
      if (el && el.textContent.includes("Nessun testo")) window.sawNone = true;
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await page.goto(openset.url());
  await connected(page);
  await tab(page, "lyrics");
  await expect(page.locator("#lyrics")).toContainText("Prima riga", { timeout: 8000 });
  expect(await page.evaluate(() => window.sawNone)).toBe(false);
});

test("Safe Mode: the Pausa/Stop label follows the settings after an unconfirmed press", async ({ page, openset }) => {
  await openset.cmd({ cmd: "settings", safeMode: true });
  openset.live({ is_playing: true });
  await page.goto(openset.url());
  await connected(page);
  await expect(page.locator("#btnStop")).toHaveText("Pausa");
  await page.click("#btnStop");
  await expect(page.locator("#btnStop")).toHaveText("Conferma pausa");
  await expect(page.locator("#btnStop")).toHaveText("Pausa", { timeout: 5000 });
  await openset.cmd({ cmd: "settings", stopInsteadOfPause: true });
  await expect(page.locator("#btnStop")).toHaveText("Stop");
});

test("dragging a song down drops it above the highlighted row", async ({ page, openset }) => {
  await page.goto(openset.url());
  await connected(page);
  await page.click('[data-act="edit"]');
  const a = await page.locator('[data-drag="0"]').boundingBox();
  const b = await page.locator('#setlist .song[data-i="2"]').boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await openset.state()).setlist.map((s) => s.name)).toEqual(["Perché", "Intro Song", "Finale"]);
});

test("Italian texts: the play button state and «1 brano»", async ({ page, openset }) => {
  openset.live({ is_playing: true, cues: [{ name: "Unico", time: 0 }] });
  await page.goto(openset.url());
  await connected(page);
  await expect(page.locator("#btnPlay")).toHaveText("Play");
  await expect(page.locator("#btnPlay")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#setlist .list-foot")).toContainText("1 brano");
  await expect(page.locator("#setlist .list-foot")).not.toContainText("1 brani");
});

test("search: a late answer for an older query is ignored", async ({ page, openset }) => {
  await page.route((url) => url.pathname === "/api/search" && url.searchParams.get("q") === "Pe", async (route) => {
    await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });
  await page.goto(openset.url());
  await connected(page);
  await page.click('[data-act="edit"]');
  await page.click('[data-act="search"]');
  await page.fill("#searchInput", "Pe");
  await page.fill("#searchInput", "Fi");
  await expect(page.locator("#searchList")).toContainText("Finale");
  await page.waitForTimeout(1200);
  await expect(page.locator("#searchList")).toContainText("Finale");
  await expect(page.locator("#searchList")).not.toContainText("Perché");
});

test("A4: a connection that goes quiet (sleeping iPad, half-open Wi-Fi) is noticed and reopened", async ({ page, openset }) => {
  const state = await openset.state();
  let n = 0;
  await page.routeWebSocket(/.*/, (ws) => {
    if (n++ === 0) ws.send(JSON.stringify({ type: "state", state })); // then silence, with the socket left open
    else ws.connectToServer();
  });
  await page.goto(openset.url());
  await connected(page);
  await expect(page.locator("#connLabel")).toHaveText("OpenSet non raggiungibile…", { timeout: 9000 });
  await expect(page.locator("#connLabel")).toHaveText("Live connesso", { timeout: 9000 });
});

test("C2: two songs with the same name (a reprise) are edited one at a time", async ({ page, openset }) => {
  openset.live({ cues: [{ name: "Uno", time: 0 }, { name: "Due", time: 8 }, { name: "Uno", time: 16 }] });
  await page.goto(openset.url());
  await connected(page);
  await page.click('[data-act="edit"]');
  await page.click('#setlist [data-act="skip"][data-i="2"]');
  await expect.poll(async () => (await openset.state()).setlist.map((s) => [s.key, s.skip])).toEqual([["Uno", false], ["Due", false], ["Uno#2", true]]);
  await page.fill('#setlist input.note[data-i="0"]', "prima");
  await page.press('#setlist input.note[data-i="0"]', "Enter");
  await expect.poll(async () => (await openset.state()).setlist.map((s) => s.notes)).toEqual(["prima", "", ""]);
});

test("C3: unlocking sends a proof made from the password, never the password", async ({ page, openset }) => {
  test.skip(!LAN_IP, "no LAN address");
  await openset.cmd({ cmd: "setPassword", password: "palco-2026" });
  const sent = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => sent.push(String(f.payload))));
  await page.goto(openset.url("/", LAN_IP));
  await connected(page);
  await page.click("#unlockApp");
  await page.fill("#authPw", "palco-2026");
  await page.click("#authGo");
  await expect(page.locator("#unlockApp")).toBeHidden({ timeout: 10000 });
  expect(sent.some((p) => p.includes('"proof"'))).toBe(true);
  expect(sent.filter((p) => p.includes("palco-2026"))).toEqual([]);
});

test("C7: the first state arrives quickly after the page opens", async ({ page, openset }) => {
  // measured in the page, from the start of the navigation: browser start-up does not count
  await page.addInitScript(() => {
    const W = window.WebSocket;
    window.WebSocket = function (u) {
      const ws = new W(u);
      ws.addEventListener("message", () => { if (!window.firstMessageAt) window.firstMessageAt = performance.now(); });
      return ws;
    };
    window.WebSocket.prototype = W.prototype;
  });
  await page.goto(openset.url());
  await connected(page);
  // ~50 ms on a developer computer; 1-2.4 s was the delay of the chrome-devtools tool used to measure
  expect(await page.evaluate(() => window.firstMessageAt)).toBeLessThan(1000);
});

test("R1: two taps on Sblocca unlock; «Controllo la password…» does not stay", async ({ page, openset }) => {
  test.skip(!LAN_IP, "no LAN address");
  await openset.cmd({ cmd: "setPassword", password: "palco-2026" });
  await page.goto(openset.url("/", LAN_IP));
  await connected(page);
  await page.click("#unlockApp");
  await page.fill("#authPw", "palco-2026");
  await page.click("#authGo");
  await page.click("#authGo", { force: true }).catch(() => {}); // a second tap while the key is computed
  await expect(page.locator("#unlockApp")).toBeHidden({ timeout: 10000 });
  await page.waitForTimeout(500);
  await expect(page.locator("#unlockApp")).toBeHidden();
  await expect(page.locator("#authStatus")).toHaveText("");
});

test("S2: Enter and a tap on Sblocca together unlock once", async ({ page, openset }) => {
  test.skip(!LAN_IP, "no LAN address");
  await openset.cmd({ cmd: "setPassword", password: "palco-2026" });
  const sent = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => sent.push(String(f.payload))));
  await page.goto(openset.url("/", LAN_IP));
  await connected(page);
  await page.click("#unlockApp");
  await page.fill("#authPw", "palco-2026");
  await page.press("#authPw", "Enter");
  await page.press("#authPw", "Enter");
  await expect(page.locator("#unlockApp")).toBeHidden({ timeout: 10000 });
  expect(sent.filter((p) => p.includes('"proof"')).length).toBe(1);
});

test("S2: after another iPad updates a 0.6 password, this one unlocks without sending it", async ({ page, browser, openset }) => {
  test.skip(!LAN_IP, "no LAN address");
  await openset.stop();
  const salt = require("crypto").randomBytes(16).toString("hex");
  const hash = require("crypto").scryptSync("palco-2026", Buffer.from(salt, "hex"), 32).toString("hex");
  fs.writeFileSync(path.join(openset.baseDir, "setlist.json"), JSON.stringify({ auth: { salt, hash } }));
  await openset.restart();
  const other = await browser.newPage();
  const sent = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => sent.push(String(f.payload))));
  await page.goto(openset.url("/", LAN_IP));
  await other.goto(openset.url("/", LAN_IP));
  await connected(page);
  await connected(other);
  await other.click("#unlockApp");
  await other.fill("#authPw", "palco-2026");
  await other.click("#authGo");
  await expect(other.locator("#unlockApp")).toBeHidden({ timeout: 10000 });
  await expect(page.locator("#authPanel")).toBeHidden(); // nothing pops up on this iPad
  await page.click("#unlockApp");
  await page.fill("#authPw", "palco-2026");
  await page.click("#authGo");
  await expect(page.locator("#unlockApp")).toBeHidden({ timeout: 10000 });
  expect(sent.filter((p) => p.includes("palco-2026"))).toEqual([]);
  await other.close();
});

test("T2: with a password OpenSet cannot read, the page sends nothing and says to set it again", async ({ page, openset }) => {
  test.skip(!LAN_IP, "no LAN address");
  await openset.stop();
  fs.writeFileSync(path.join(openset.baseDir, "setlist.json"), JSON.stringify({ auth: { scheme: "argon2id", salt: "zz" } }));
  await openset.restart();
  const sent = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => sent.push(String(f.payload))));
  await page.goto(openset.url("/", LAN_IP));
  await connected(page);
  await page.click("#unlockApp");
  await page.fill("#authPw", "palco-2026");
  await page.click("#authGo");
  await expect(page.locator("#authStatus")).toContainText("computer");
  expect(sent.filter((p) => p.includes("palco-2026"))).toEqual([]);
});

test("F3: with two singers each device picks its +LYRICS track, and keeps it", async ({ page, openset }) => {
  await openset.clips([
    { name: "Leo +LYRICS", clips: [{ name: "Riga di Leo", start: 0, end: 4 }] },
    { name: "Backing Vox +LYRICS", clips: [{ name: "Riga dei cori", start: 0, end: 4 }] },
  ]);
  await page.goto(openset.url());
  await connected(page);
  await tab(page, "lyrics");
  await expect(page.locator("#lyrics")).toContainText("Riga di Leo");
  await page.selectOption("#lyrTrack", "backing-vox");
  await expect(page.locator("#lyrics")).toContainText("Riga dei cori");
  await page.reload();
  await connected(page);
  await expect(page.locator("#lyrics")).toContainText("Riga dei cori");
  await expect(page.locator("#lyrTrack")).toHaveValue("backing-vox");
});
