// Optional web app password, checked in constant time, with wrong guesses
// slowed down per device. It works like SCRAM-SHA-256 (RFC 5802): OpenSet stores
// only a check of the password (the stored key), which is not enough to unlock;
// a browser computes the client key from the password and sends a proof made
// with a one-time number, so the password never travels on the network.

const crypto = require("crypto");

const KEY_LEN = 32;
const ITER = 100000; // PBKDF2 rounds: the page computes them in plain JavaScript, on old iPads too
const HEX64 = /^[0-9a-f]{64}$/;
const sha = (b) => crypto.createHash("sha256").update(b).digest();
const hmac = (k, m) => crypto.createHmac("sha256", k).update(m).digest();
// SCRAM: client key from the salted password, and its hash, the stored key
const storedKeyOf = (salted) => sha(hmac(salted, "Client Key"));
// { salt, iter, storedKey }, or { salt, hash } (scrypt) saved by OpenSet 0.6 and older
const validAuth = (a) =>
  !!a &&
  /^[0-9a-f]{32}$/.test(a.salt) &&
  ((HEX64.test(a.storedKey) && Number.isInteger(a.iter) && a.iter >= 1000 && a.iter <= 1e7) || HEX64.test(a.hash));

// setting a password is rare: the sync version keeps the command simple
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const salted = crypto.pbkdf2Sync(password, Buffer.from(salt, "hex"), ITER, KEY_LEN, "sha256");
  return { salt, iter: ITER, storedKey: storedKeyOf(salted).toString("hex") };
}

// checked often, so async: the playback engine keeps running meanwhile
function checkPassword(auth, password) {
  if (!validAuth(auth) || typeof password !== "string" || password.length > 256) return Promise.resolve(false);
  const salt = Buffer.from(auth.salt, "hex");
  return new Promise((resolve) => {
    if (auth.storedKey)
      crypto.pbkdf2(password, salt, auth.iter, KEY_LEN, "sha256", (err, salted) =>
        resolve(!err && crypto.timingSafeEqual(storedKeyOf(salted), Buffer.from(auth.storedKey, "hex")))
      );
    else
      crypto.scrypt(password, salt, KEY_LEN, (err, key) => resolve(!err && crypto.timingSafeEqual(key, Buffer.from(auth.hash, "hex"))));
  });
}

// proof = client key XOR HMAC(stored key, nonce): the stored key gives the HMAC back,
// and the client key found must hash to the stored key. Without the password there is no client key.
function checkProof(auth, nonce, proof) {
  if (!validAuth(auth) || !auth.storedKey || typeof proof !== "string" || !HEX64.test(proof)) return false;
  const stored = Buffer.from(auth.storedKey, "hex");
  const sig = hmac(stored, String(nonce));
  const clientKey = Buffer.from(proof, "hex").map((x, i) => x ^ sig[i]);
  return crypto.timingSafeEqual(sha(clientKey), stored);
}

// IPv6 address as 8 numbers (one way to write it), or null for IPv4
function v6Groups(ip) {
  const a = String(ip).split("%")[0];
  if (!a.includes(":") || /^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(a)) return null;
  const [head, tail = ""] = a.split("::");
  const h = head ? head.split(":") : [];
  const t = a.includes("::") && tail ? tail.split(":") : [];
  return [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t].map((g) => parseInt(g, 16) || 0);
}
// one device: its address, written always the same way
function addrKey(ip) {
  const g = v6Groups(ip);
  return g ? g.join(":") : String(ip).replace(/^::ffff:/i, "");
}
// its IPv6 network: on a LAN every device has an address in the same /64, and one
// device can take a new address in it at will
function netKey(ip) {
  const g = v6Groups(ip);
  return g ? g.slice(0, 4).join(":") + "::/64" : null;
}

// after `max` wrong guesses a device waits `ms` before it can try again; an IPv6 /64
// waits after `netMax`, so changing address at every guess does not help
function createLimiter({ max = 5, netMax = 30, ms = 30000, now = Date.now } = {}) {
  const fails = new Map(); // key -> { count, until }
  const keys = (ip) => (netKey(ip) ? [[addrKey(ip), max], [netKey(ip), netMax]] : [[addrKey(ip), max]]);
  return {
    blocked: (ip) =>
      keys(ip).some(([k, m]) => {
        const f = fails.get(k);
        return !!f && f.count >= m && now() < f.until;
      }),
    fail: (ip) => {
      for (const [k, m] of keys(ip)) {
        const f = fails.get(k) || { count: 0, until: 0 };
        if (f.count >= m && now() >= f.until) f.count = 0; // the wait is over
        f.count++;
        f.until = now() + ms;
        fails.set(k, f);
      }
    },
    // only the device itself: a success nearby must not reset a guesser in the same /64
    ok: (ip) => fails.delete(addrKey(ip)),
  };
}

// a new WebSocket connection: at most perIp per device, perNet per IPv6 /64 and max in
// all; the computer with OpenSet is never refused and does not use up places
function connectionAllowed(clients, ip, local, { perIp, perNet, max }) {
  if (local) return true;
  const others = clients.filter((c) => !c.local);
  const net = netKey(ip);
  return (
    others.filter((c) => addrKey(c.ip) === addrKey(ip)).length < perIp &&
    (!net || others.filter((c) => netKey(c.ip) === net).length < perNet) &&
    others.length < max
  );
}

// browsers unlocked with the password: a token works only from the address that got
// it, until 24 hours pass without use, a new password or a restart
function createTokens({ idleMs = 24 * 3600e3, max = 200, now = Date.now } = {}) {
  const tokens = new Map(); // token -> { key, used }
  return {
    issue: (ip) => {
      const token = crypto.randomBytes(32).toString("hex");
      if (tokens.size >= max) tokens.delete(tokens.keys().next().value);
      tokens.set(token, { key: addrKey(ip), used: now() });
      return token;
    },
    // used on its open connection: a command, or the heartbeat every 2 s
    touch: (token) => {
      const t = typeof token === "string" && tokens.get(token);
      if (t) t.used = now();
    },
    valid: (token, ip) => {
      const t = typeof token === "string" && tokens.get(token);
      if (!t || t.key !== addrKey(ip)) return false;
      if (now() - t.used > idleMs) {
        tokens.delete(token);
        return false;
      }
      t.used = now();
      return true;
    },
    clear: () => tokens.clear(),
  };
}

module.exports = { validAuth, hashPassword, checkPassword, checkProof, createLimiter, createTokens, connectionAllowed };
