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

test("C3: the page computes the same PBKDF2 key and proof as OpenSet", () => {
  assert.equal(typeof ctx.pbkdf2Hex, "function", "pbkdf2Hex in index.html");
  const salt = "00112233445566778899aabbccddeeff";
  const want = (pw, iter) => crypto.pbkdf2Sync(pw, Buffer.from(salt, "hex"), iter, 32, "sha256").toString("hex");
  assert.equal(ctx.pbkdf2Hex("palco-2026", salt, 1000), want("palco-2026", 1000));
  assert.equal(ctx.pbkdf2Hex("perché ✓ €", salt, 3), want("perché ✓ €", 3)); // UTF-8
  assert.equal(ctx.pbkdf2Hex("x".repeat(100), salt, 2), want("x".repeat(100), 2)); // longer than a SHA-256 block
  const key = want("palco-2026", 1000);
  const nonce = "ab".repeat(16);
  assert.equal(ctx.hmacHex(key, nonce), crypto.createHmac("sha256", Buffer.from(key, "hex")).update(nonce).digest("hex"));
});
