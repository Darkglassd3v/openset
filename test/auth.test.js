const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { createLimiter, createTokens, hashPassword, checkPassword, checkProof, validAuth, connectionAllowed } = require("../server/auth");

test("R1: wrong passwords block that device; only many from one IPv6 network block the network", () => {
  const l = createLimiter({ max: 2, netMax: 4, ms: 1000, now: () => 0 });
  l.fail("2001:db8:1:2::5");
  l.fail("2001:db8:1:2::5");
  assert.equal(l.blocked("2001:db8:1:2::5"), true);
  // on a LAN every device has an address in the same /64: the band's iPads are not blocked
  assert.equal(l.blocked("2001:db8:1:2::6"), false);
  // someone taking a new address for every guess: the whole /64 waits after 4
  l.fail("2001:db8:1:2::7");
  l.fail("2001:db8:1:2::8");
  assert.equal(l.blocked("2001:db8:1:2::9"), true);
  assert.equal(l.blocked("2001:db8:1:3::1"), false);
  l.ok("2001:db8:1:2::6"); // a success nearby does not reset the guesser's count
  assert.equal(l.blocked("2001:db8:1:2::9"), true);
  // the same address written in another way
  const m = createLimiter({ max: 1, now: () => 0 });
  m.fail("2001:DB8::1");
  assert.equal(m.blocked("2001:db8:0:0::1"), true);
  // IPv4: one address is one device
  m.fail("10.0.0.1");
  assert.equal(m.blocked("10.0.0.1"), true);
  assert.equal(m.blocked("10.0.0.2"), false);
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
  // IPv6: the exact address; another device of the same Wi-Fi has another one in the same /64
  const v6 = tokens.issue("2001:db8:1:2::5");
  assert.equal(tokens.valid(v6, "2001:db8:1:2:aaaa::7"), false);
  assert.equal(tokens.valid(v6, "2001:DB8:1:2:0:0:0:5"), true);
  tokens.clear(); // new password
  assert.equal(tokens.valid(v6, "2001:db8:1:2::5"), false);
});

test("C3: at most 200 unlock tokens are kept, the oldest one goes first", () => {
  const tokens = createTokens({ now: () => 0 });
  const first = tokens.issue("10.0.0.1");
  for (let i = 0; i < 200; i++) tokens.issue("10.0.0.2");
  assert.equal(tokens.valid(first, "10.0.0.1"), false);
});

// SCRAM-SHA-256 (RFC 5802): what the page computes from the password
const sha = (b) => crypto.createHash("sha256").update(b).digest();
const hmac = (k, m) => crypto.createHmac("sha256", k).update(m).digest();
const clientKey = (pw, a) => hmac(crypto.pbkdf2Sync(pw, Buffer.from(a.salt, "hex"), a.iter, 32, "sha256"), "Client Key");
const scramProof = (pw, a, nonce) => {
  const ck = clientKey(pw, a);
  const sig = hmac(sha(ck), nonce);
  return Buffer.from(ck.map((x, i) => x ^ sig[i])).toString("hex");
};

test("R2: only a check of the password is stored (SCRAM stored key), with 100000 iterations", async () => {
  const a = hashPassword("palco-2026");
  assert.match(a.salt, /^[0-9a-f]{32}$/);
  assert.equal(a.iter, 100000);
  assert.equal(a.storedKey, sha(clientKey("palco-2026", a)).toString("hex"));
  assert.equal(a.key, undefined);
  assert.equal(validAuth(a), true);
  assert.equal(await checkPassword(a, "palco-2026"), true);
  assert.equal(await checkPassword(a, "palco-2027"), false);
});

test("R2: a proof made from the password unlocks; what is in setlist.json does not", async () => {
  const a = hashPassword("palco-2026");
  const nonce = "ab".repeat(16);
  const proof = scramProof("palco-2026", a, nonce);
  assert.equal(checkProof(a, nonce, proof), true);
  assert.equal(checkProof(a, "cd".repeat(16), proof), false);
  assert.equal(checkProof(a, nonce, "00".repeat(32)), false);
  assert.equal(checkProof(a, nonce, "zz"), false);
  // someone with a copy of setlist.json: the stored key alone gives no valid proof
  const stored = Buffer.from(a.storedKey, "hex");
  assert.equal(checkProof(a, nonce, hmac(stored, nonce).toString("hex")), false);
  assert.equal(checkProof(a, nonce, Buffer.from(stored.map((x, i) => x ^ hmac(stored, nonce)[i])).toString("hex")), false);
  const salt = crypto.randomBytes(16).toString("hex");
  const legacy = { salt, hash: crypto.scryptSync("palco-2026", Buffer.from(salt, "hex"), 32).toString("hex") };
  assert.equal(validAuth(legacy), true);
  assert.equal(await checkPassword(legacy, "palco-2026"), true);
  assert.equal(checkProof(legacy, nonce, proof), false); // no key to prove with: the page sends the password once
});

test("R1: using an unlocked device keeps its unlock alive", () => {
  let t = 0;
  const tokens = createTokens({ now: () => t });
  const tok = tokens.issue("10.0.0.1");
  t += 23 * 3600e3;
  tokens.touch(tok); // a command or a heartbeat on the open connection
  t += 23 * 3600e3;
  assert.equal(tokens.valid(tok, "10.0.0.1"), true);
});

test("R1: connections: per address, per IPv6 network and in all; this computer is never refused", () => {
  const c = (ip, local = false) => ({ ip, local });
  const cfg = { perIp: 2, perNet: 3, max: 4 };
  assert.equal(connectionAllowed([c("10.0.0.1"), c("10.0.0.1")], "10.0.0.1", false, cfg), false);
  assert.equal(connectionAllowed([c("10.0.0.1"), c("10.0.0.1")], "10.0.0.2", false, cfg), true);
  // one IPv6 device changing address cannot open more than perNet
  assert.equal(connectionAllowed([c("2001:db8::1"), c("2001:db8::2"), c("2001:db8::3")], "2001:db8::4", false, cfg), false);
  const four = [c("10.0.0.1"), c("10.0.0.2"), c("10.0.0.3"), c("10.0.0.4")];
  assert.equal(connectionAllowed(four, "10.0.0.5", false, cfg), false);
  assert.equal(connectionAllowed(four, "127.0.0.1", true, cfg), true);
  // the computer with OpenSet does not use up the places of the band
  assert.equal(connectionAllowed([...four.slice(0, 3), c("127.0.0.1", true), c("127.0.0.1", true)], "10.0.0.9", false, cfg), true);
});
