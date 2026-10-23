const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// the canvas templates (${…}) as the page evaluates them: a small safe language, never JavaScript
const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf-8");
const from = html.indexOf("// canvas-expr: begin");
const ctx = vm.createContext({});
if (from >= 0) vm.runInContext(html.slice(from, html.indexOf("// canvas-expr: end")), ctx);
const values = { "/global/tempo": [120.4], "/global/isPlaying": [0], "/setlist/songs": ["A", "B"], "/global/timeSignature": [6, 8] };
const fns = {
  osc: (k, i = 0) => (values[k] === undefined ? undefined : i === "all" ? values[k] : values[k][i]),
  shared: (k, fb) => (k === "scena" ? "verse" : fb),
  local: (_k, fb) => fb,
  formatDuration: (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`,
  now: () => 1000,
};
const ev = (e) => ctx.cvExpr(e, fns);

test("V1: canvas templates: values, arithmetic, conditions and a few safe methods", () => {
  assert.equal(typeof ctx.cvExpr, "function", "cvExpr between // canvas-expr: begin and end");
  assert.equal(ev('osc("/global/tempo")'), 120.4);
  assert.equal(ev('Math.round(osc("/global/tempo")) + 1'), 121);
  assert.equal(ev('osc("/global/isPlaying") ? "Suona" : "Fermo"'), "Fermo");
  assert.equal(ev('!osc("/global/isPlaying") && shared("scena", "") === "verse"'), true);
  assert.equal(ev("osc('/global/timeSignature', 1) * 2 - 4 / 2 % 3"), 14);
  assert.equal(ev('osc("/setlist/songs", "all").length'), 2);
  assert.equal(ev('osc("/setlist/songs", "all")[1]'), "B");
  assert.equal(ev('osc("/global/tempo").toFixed(0) + " BPM"'), "120 BPM");
  assert.equal(ev('formatDuration(135)'), "2:15");
  assert.equal(ev('shared("nope", "x").toUpperCase()'), "X");
  assert.equal(ev("(1 + 2) * 3 >= 9 || false"), true);
  assert.equal(ev("null"), null);
});

test("V1: canvas templates never run JavaScript: anything else is refused", () => {
  assert.equal(typeof ctx.cvExpr, "function");
  for (const e of [
    "constructor",
    'osc.constructor("return 1")()',
    'osc("/global/tempo")["constructor"]',
    'shared("x", "").constructor',
    "this",
    "window",
    "document.title",
    "(() => 1)()",
    "a = 1",
    'Math.constructor',
    "fetch('/api/cmd')",
    "`x`",
    'osc("x").__proto__',
  ])
    // refused by the language itself (the error comes from the page's realm: matched by its message)
    assert.throws(() => ctx.cvExpr(e, fns), (err) => /^canvas: /.test(err.message), e);
});
