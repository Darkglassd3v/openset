const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const { bonjourAnswer, startBonjour } = require("../server/bonjour");

const info = { name: "OpenSet (palco)", host: "palco-openset.local", port: 39051, addresses: ["192.168.1.20"], version: "1.0.0" };
const INSTANCE = "OpenSet (palco)._osc._udp.local";

test("F11: an app browsing for _osc._udp finds OpenSet: PTR, then SRV, TXT (server=ableset, like AbleSet) and A", () => {
  const r = bonjourAnswer({ questions: [{ name: "_osc._udp.local", type: "PTR" }] }, info);
  assert.deepEqual(r.answers, [{ name: "_osc._udp.local", type: "PTR", ttl: 4500, data: INSTANCE }]);
  assert.deepEqual(r.additionals, [
    { name: INSTANCE, type: "SRV", ttl: 120, data: { port: 39051, target: "palco-openset.local", priority: 0, weight: 0 } },
    { name: INSTANCE, type: "TXT", ttl: 4500, data: ["server=ableset", "app=openset", "version=1.0.0"] },
    { name: "palco-openset.local", type: "A", ttl: 120, data: "192.168.1.20" },
  ]);
  assert.equal(bonjourAnswer({ questions: [{ name: "_services._dns-sd._udp.local", type: "PTR" }] }, info).answers[0].data, "_osc._udp.local");
  assert.equal(bonjourAnswer({ questions: [{ name: INSTANCE, type: "SRV" }] }, info).answers[0].type, "SRV");
  assert.equal(bonjourAnswer({ questions: [{ name: INSTANCE, type: "TXT" }] }, info).answers[0].type, "TXT");
  assert.equal(bonjourAnswer({ questions: [{ name: "palco-openset.local", type: "A" }] }, info).answers[0].data, "192.168.1.20");
  assert.equal(bonjourAnswer({ questions: [{ name: "_http._tcp.local", type: "PTR" }] }, info), null); // not ours
  assert.equal(bonjourAnswer({}, info), null);
});

test("F11: started, OpenSet announces itself; stopped, it says goodbye (TTL 0) and closes the socket", () => {
  const sent = [];
  const fake = new EventEmitter();
  fake.respond = (r) => sent.push(r);
  fake.destroy = () => (fake.destroyed = true);
  const b = startBonjour({ mdns: fake, info: () => info });
  assert.ok(sent[0].answers.some((a) => a.type === "PTR" && a.data === INSTANCE));
  fake.emit("query", { questions: [{ name: "_osc._udp.local", type: "PTR" }] });
  fake.emit("query", { questions: [{ name: "_airplay._tcp.local", type: "PTR" }] });
  assert.equal(sent.length, 2);
  b.stop();
  assert.ok(sent.at(-1).answers.every((a) => a.ttl === 0));
  assert.equal(fake.destroyed, true);
  fake.emit("error", new Error("EADDRINUSE")); // a socket error after the end never throws
});

test("V18: the goodbye goes out before the socket closes", async () => {
  const fake = new EventEmitter();
  const order = [];
  fake.respond = (r, cb) => setTimeout(() => { order.push(r.answers.every((a) => a.ttl === 0) ? "goodbye" : "hello"); if (cb) cb(); }, 20);
  fake.destroy = () => order.push("closed");
  const b = startBonjour({ mdns: fake, info: () => info });
  await b.stop();
  assert.deepEqual(order.slice(-2), ["goodbye", "closed"]);
});
