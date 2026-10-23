const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// the page's own SHA-256 (crypto.subtle exists only on HTTPS, OpenSet runs on plain HTTP)
const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf-8");
const from = html.indexOf("// pbkdf2: begin");
const ctx = vm.createContext({ TextEncoder });
if (from >= 0) vm.runInContext(html.slice(from, html.indexOf("// pbkdf2: end")), ctx);

const salt = "00112233445566778899aabbccddeeff";
const pbkdf2 = (pw, iter) => crypto.pbkdf2Sync(pw, Buffer.from(salt, "hex"), iter, 32, "sha256");

test("C3: the page computes the same PBKDF2 key as OpenSet", () => {
  assert.equal(typeof ctx.pbkdf2Hex, "function", "pbkdf2Hex in index.html");
  assert.equal(ctx.pbkdf2Hex("palco-2026", salt, 1000), pbkdf2("palco-2026", 1000).toString("hex"));
  assert.equal(ctx.pbkdf2Hex("perché ✓ €", salt, 3), pbkdf2("perché ✓ €", 3).toString("hex")); // UTF-8
  assert.equal(ctx.pbkdf2Hex("x".repeat(100), salt, 2), pbkdf2("x".repeat(100), 2).toString("hex")); // longer than a block
});

test("R2: the page computes the same SCRAM proof as OpenSet expects", () => {
  assert.equal(typeof ctx.scramProof, "function", "scramProof in index.html");
  const nonce = "ab".repeat(16);
  const ck = crypto.createHmac("sha256", pbkdf2("palco-2026", 1000)).update("Client Key").digest();
  const sig = crypto.createHmac("sha256", crypto.createHash("sha256").update(ck).digest()).update(nonce).digest();
  assert.equal(ctx.scramProof("palco-2026", salt, 1000, nonce), Buffer.from(ck.map((x, i) => x ^ sig[i])).toString("hex"));
});

test("R2: 100000 iterations take well under a second here (no memory churn for old iPads)", () => {
  const t = process.hrtime.bigint();
  ctx.scramProof("palco-2026", salt, 100000, "ab".repeat(16));
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  assert.ok(ms < 400, `${ms.toFixed(0)} ms`);
});
