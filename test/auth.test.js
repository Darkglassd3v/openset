const test = require("node:test");
const assert = require("node:assert/strict");
const { createLimiter } = require("../server/auth");

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
