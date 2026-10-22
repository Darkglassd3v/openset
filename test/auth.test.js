const test = require("node:test");
const assert = require("node:assert/strict");
const { createLimiter, createTokens } = require("../server/auth");

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
