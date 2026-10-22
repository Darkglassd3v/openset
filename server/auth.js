// Optional web app password: stored as a salted scrypt hash, checked in
// constant time, with wrong guesses slowed down per address.

const crypto = require("crypto");

const KEY_LEN = 32;
const validAuth = (a) => !!a && /^[0-9a-f]{32}$/.test(a.salt) && /^[0-9a-f]{64}$/.test(a.hash);

// setting a password is rare: the sync version keeps the command simple
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: crypto.scryptSync(password, Buffer.from(salt, "hex"), KEY_LEN).toString("hex") };
}

// checked often, so async: the playback engine keeps running meanwhile
function checkPassword(auth, password) {
  if (!validAuth(auth) || typeof password !== "string" || password.length > 256) return Promise.resolve(false);
  return new Promise((resolve) =>
    crypto.scrypt(password, Buffer.from(auth.salt, "hex"), KEY_LEN, (err, key) =>
      resolve(!err && crypto.timingSafeEqual(key, Buffer.from(auth.hash, "hex")))
    )
  );
}

// who is counted: an IPv4 address, or an IPv6 /64 network (a device picks a new
// address in its /64 at will, so one per guess would never be slowed down)
function limitKey(ip) {
  const a = String(ip).split("%")[0].replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "");
  if (!a.includes(":")) return a;
  const [head, tail = ""] = a.split("::");
  const h = head ? head.split(":") : [];
  const t = a.includes("::") && tail ? tail.split(":") : [];
  const groups = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return groups.slice(0, 4).map((g) => parseInt(g, 16) || 0).join(":") + "::/64";
}

// after `max` wrong guesses an address waits `ms` before it can try again
function createLimiter({ max = 5, ms = 30000, now = Date.now } = {}) {
  const fails = new Map(); // limitKey -> { count, until }
  return {
    blocked: (ip) => {
      const f = fails.get(limitKey(ip));
      return !!f && f.count >= max && now() < f.until;
    },
    fail: (ip) => {
      const k = limitKey(ip);
      const f = fails.get(k) || { count: 0, until: 0 };
      if (f.count >= max && now() >= f.until) f.count = 0; // the wait is over
      f.count++;
      f.until = now() + ms;
      fails.set(k, f);
    },
    ok: (ip) => fails.delete(limitKey(ip)),
  };
}

module.exports = { validAuth, hashPassword, checkPassword, createLimiter };
