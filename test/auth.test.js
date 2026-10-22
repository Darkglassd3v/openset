const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { createLimiter, createTokens, hashPassword, checkPassword, checkProof, validAuth } = require("../server/auth");

test("C3: wrong passwords are counted per IPv6 /64 network, not per address", () => {
  const l = createLimiter({ max: 2, ms: 1000, now: () => 0 });
  // an IPv6 device can take a new address in its /64 for every guess
  l.fail("2001:db8:1:2::5");
  l.fail("2001:db8:1:2:ffff::1");
  assert.equal(l.blocked("2001:0db8:0001:0002:0:0:0:9"), true);
  assert.equal(l.blocked("2001:db8:1:3::1"), false);
  // IPv4: one address is one device
  l.fail("10.0.0.1");
  l.fail("10.0.0.1");
  assert.equal(l.blocked("10.0.0.1"), true);
  assert.equal(l.blocked("10.0.0.2"), false);
});

test("C3: an unlock token expires after 24 hours without use and works only from its address", () => {
  let t = 0;
  const tokens = createTokens({ now: () => t });
  const tok = tokens.issue("192.168.1.20");
  assert.match(tok, /^[0-9a-f]{64}$/);
  assert.equal(tokens.valid(tok, "192.168.1.20"), true);
  assert.equal(tokens.valid(tok, "192.168.1.21"), false); // copied to another device
  t += 23 * 3600e3;
  assert.equal(tokens.valid(tok, "192.168.1.20"), true); // used: the 24 hours start again
  t += 23 * 3600e3;
  assert.equal(tokens.valid(tok, "192.168.1.20"), true);
  t += 24 * 3600e3 + 1;
  assert.equal(tokens.valid(tok, "192.168.1.20"), false);
  assert.equal(tokens.valid("f".repeat(64), "192.168.1.20"), false);
  // IPv6: the same /64 network, where the device changes address on its own
  const v6 = tokens.issue("2001:db8:1:2::5");
  assert.equal(tokens.valid(v6, "2001:db8:1:2:aaaa::7"), true);
  tokens.clear(); // new password
  assert.equal(tokens.valid(v6, "2001:db8:1:2::5"), false);
});

test("C3: at most 200 unlock tokens are kept, the oldest one goes first", () => {
  const tokens = createTokens({ now: () => 0 });
  const first = tokens.issue("10.0.0.1");
  for (let i = 0; i < 200; i++) tokens.issue("10.0.0.2");
  assert.equal(tokens.valid(first, "10.0.0.1"), false);
});

test("C3: the password is stored as a PBKDF2 key that a browser can compute too", async () => {
  const a = hashPassword("palco-2026");
  assert.match(a.salt, /^[0-9a-f]{32}$/);
  assert.equal(a.iter, 25000);
  assert.equal(a.key, crypto.pbkdf2Sync("palco-2026", Buffer.from(a.salt, "hex"), a.iter, 32, "sha256").toString("hex"));
  assert.equal(validAuth(a), true);
  assert.equal(await checkPassword(a, "palco-2026"), true);
  assert.equal(await checkPassword(a, "palco-2027"), false);
});

test("C3: a proof is the HMAC of a one-time number with the key; a password saved by an older OpenSet still works", async () => {
  const a = hashPassword("palco-2026");
  const nonce = "ab".repeat(16);
  const proof = crypto.createHmac("sha256", Buffer.from(a.key, "hex")).update(nonce).digest("hex");
  assert.equal(checkProof(a, nonce, proof), true);
  assert.equal(checkProof(a, "cd".repeat(16), proof), false);
  assert.equal(checkProof(a, nonce, "00".repeat(32)), false);
  assert.equal(checkProof(a, nonce, "zz"), false);
  const salt = crypto.randomBytes(16).toString("hex");
  const legacy = { salt, hash: crypto.scryptSync("palco-2026", Buffer.from(salt, "hex"), 32).toString("hex") };
  assert.equal(validAuth(legacy), true);
  assert.equal(await checkPassword(legacy, "palco-2026"), true);
  assert.equal(checkProof(legacy, nonce, proof), false); // no key to prove with: the page sends the password once
});
