const test = require("node:test");
const assert = require("node:assert/strict");
const { lanAddresses, lanInterfaces, deviceUrls, bonjourName, qrSvg } = require("../server/connect");

const IFACES = {
  lo0: [{ family: "IPv4", internal: true, address: "127.0.0.1" }],
  en0: [
    { family: "IPv6", internal: false, address: "fe80::1" },
    { family: "IPv4", internal: false, address: "192.168.1.50" },
  ],
  utun0: undefined,
};

test("lanAddresses: external IPv4 only", () => {
  assert.deepEqual(lanAddresses(IFACES), ["192.168.1.50"]);
  assert.deepEqual(lanAddresses({}), []);
});

test("deviceUrls: Bonjour name first on macOS, no :80", () => {
  assert.deepEqual(deviceUrls({ platform: "darwin", hostname: "Studio", interfaces: IFACES }, 39080), [
    "http://Studio.local:39080",
    "http://192.168.1.50:39080",
  ]);
  assert.deepEqual(deviceUrls({ platform: "darwin", hostname: "Studio", interfaces: IFACES }, 80), [
    "http://Studio.local",
    "http://192.168.1.50",
  ]);
  assert.deepEqual(deviceUrls({ platform: "win32", hostname: "PC", interfaces: IFACES }, 80), ["http://192.168.1.50"]);
});

test("bonjourName: macOS LocalHostName, else null", () => {
  const calls = [];
  const run = (cmd, args) => { calls.push([cmd, ...args]); return "Studio\n"; };
  assert.equal(bonjourName("darwin", run, "x.fritz.box"), "Studio");
  assert.deepEqual(calls, [["scutil", "--get", "LocalHostName"]]);
  const broken = () => { throw new Error("not found"); };
  assert.equal(bonjourName("darwin", broken, "Studio.fritz.box"), "Studio");
  assert.equal(bonjourName("linux", run, "box"), null);
});

test("qrSvg: scalable SVG with the standard 4-module quiet zone", () => {
  const svg = qrSvg("http://192.168.1.23:39080");
  assert.match(svg, /^<svg /);
  assert.match(svg, /viewBox="0 0 33 33"/); // version 2 (25 modules) + 2 x 4
  assert.notEqual(svg, qrSvg("http://192.168.1.24:39080"));
});

test("Preferred Network: one network's address, or all of them when it is gone", () => {
  const interfaces = {
    en0: [{ family: "IPv4", internal: false, address: "192.168.1.50" }],
    en5: [{ family: "IPv4", internal: false, address: "10.0.0.7" }, { family: "IPv6", internal: false, address: "fe80::1" }],
    lo0: [{ family: "IPv4", internal: true, address: "127.0.0.1" }],
  };
  assert.deepEqual(lanInterfaces(interfaces), [{ name: "en0", address: "192.168.1.50" }, { name: "en5", address: "10.0.0.7" }]);
  assert.deepEqual(deviceUrls({ platform: "linux", interfaces }, 80, "en5"), ["http://10.0.0.7"]);
  assert.deepEqual(deviceUrls({ platform: "linux", interfaces }, 80, "gone0"), ["http://192.168.1.50", "http://10.0.0.7"]);
  assert.deepEqual(deviceUrls({ platform: "darwin", hostname: "Studio", interfaces }, 80, "en0"), ["http://Studio.local", "http://192.168.1.50"]);
});
