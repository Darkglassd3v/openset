// OSC announced on the network with Bonjour (mDNS/DNS-SD), like AbleSet: apps such as
// TouchOSC find OpenSet with «Browse». The service is _osc._udp with the TXT value
// server=ableset (AbleSet's), so tools that look for AbleSet find OpenSet too.

const SERVICE = "_osc._udp.local";
const LIST = "_services._dns-sd._udp.local";

// the answer to an mDNS query, or null when it is not about OpenSet.
// info: { name, host, port, addresses (IPv4), version }
function bonjourAnswer(query, info, ttl = null) {
  const instance = `${info.name}.${SERVICE}`;
  const t = (n) => (ttl === null ? n : ttl);
  const ptr = { name: SERVICE, type: "PTR", ttl: t(4500), data: instance };
  const srv = { name: instance, type: "SRV", ttl: t(120), data: { port: info.port, target: info.host, priority: 0, weight: 0 } };
  const txt = { name: instance, type: "TXT", ttl: t(4500), data: ["server=ableset", "app=openset", `version=${info.version}`] };
  const a = info.addresses.map((ip) => ({ name: info.host, type: "A", ttl: t(120), data: ip }));
  const answers = [];
  const additionals = [];
  for (const q of (query && query.questions) || []) {
    const any = q.type === "ANY";
    if (q.name === SERVICE && (q.type === "PTR" || any)) {
      answers.push(ptr);
      additionals.push(srv, txt, ...a);
    } else if (q.name === LIST && (q.type === "PTR" || any)) answers.push({ name: LIST, type: "PTR", ttl: t(4500), data: SERVICE });
    else if (q.name === instance && (q.type === "SRV" || any)) {
      answers.push(srv);
      additionals.push(...a);
    } else if (q.name === instance && q.type === "TXT") answers.push(txt);
    else if (q.name === info.host && (q.type === "A" || any)) answers.push(...a);
  }
  return answers.length ? { answers, additionals: additionals.filter((x) => !answers.includes(x)) } : null;
}

// mdns: a multicast-dns instance; info(): the details now (addresses change with the network)
function startBonjour({ mdns, info }) {
  const everything = (ttl) => {
    const r = bonjourAnswer({ questions: [{ name: SERVICE, type: "PTR" }] }, info(), ttl);
    return { answers: [...r.answers, ...r.additionals] };
  };
  const say = (r) => {
    try {
      mdns.respond(r);
    } catch {} // a network that goes away must not stop OpenSet
  };
  mdns.on("query", (q) => {
    const r = bonjourAnswer(q, info());
    if (r) say(r);
  });
  mdns.on("error", () => {}); // e.g. no multicast on this network: OSC works without Bonjour
  say(everything(null));
  const again = setTimeout(() => say(everything(null)), 1000); // mDNS announces twice
  return {
    // goodbye (browsers drop OpenSet at once), and the socket closes once it has gone out
    stop() {
      clearTimeout(again);
      return new Promise((resolve) => {
        let done = false;
        const end = () => {
          if (done) return;
          done = true;
          try {
            mdns.destroy();
          } catch {}
          resolve();
        };
        setTimeout(end, 500); // a network that never answers does not hold OpenSet's exit
        try {
          mdns.respond(everything(0), end);
        } catch {
          end();
        }
      });
    },
  };
}

module.exports = { bonjourAnswer, startBonjour };
