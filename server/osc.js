// Minimal OSC 1.0 codec, no dependency. Decodes messages and (nested)
// bundles with i f d s T F N arguments; encodes strings and numbers
// (numbers and booleans as float32, which TouchOSC and Companion accept).

function readString(buf, off) {
  const end = buf.indexOf(0, off);
  if (end < 0) throw new Error("OSC: unterminated string");
  return [buf.toString("utf-8", off, end), (end + 4) & ~3];
}

function decode(buf, out = []) {
  if (buf.length >= 16 && buf.toString("latin1", 0, 8) === "#bundle\0") {
    let off = 16; // after the 8-byte time tag
    while (off + 4 <= buf.length) {
      const size = buf.readInt32BE(off);
      off += 4;
      if (size < 0 || off + size > buf.length) throw new Error("OSC: bad bundle element size");
      decode(buf.subarray(off, off + size), out);
      off += size;
    }
    return out;
  }
  if (buf[0] !== 0x2f) throw new Error("OSC: not a message");
  let [address, off] = readString(buf, 0);
  const args = [];
  if (off < buf.length) {
    let tags;
    [tags, off] = readString(buf, off);
    if (tags[0] !== ",") throw new Error("OSC: missing type tags");
    for (const t of tags.slice(1)) {
      switch (t) {
        case "i": args.push(buf.readInt32BE(off)); off += 4; break;
        case "f": args.push(buf.readFloatBE(off)); off += 4; break;
        case "d": args.push(buf.readDoubleBE(off)); off += 8; break;
        case "s": { let s; [s, off] = readString(buf, off); args.push(s); break; }
        case "T": args.push(true); break;
        case "F": args.push(false); break;
        case "N": args.push(null); break;
        default: throw new Error("OSC: unsupported type tag " + t);
      }
    }
  }
  out.push({ address, args });
  return out;
}

function str(s) {
  const b = Buffer.from(s + "\0", "utf-8");
  return Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
}

function encode(address, args = []) {
  let tags = ",";
  const parts = [];
  for (const a of args) {
    if (typeof a === "string") {
      tags += "s";
      parts.push(str(a));
    } else {
      const b = Buffer.alloc(4);
      b.writeFloatBE(Number(a) || 0);
      tags += "f";
      parts.push(b);
    }
  }
  return Buffer.concat([str(address), str(tags), ...parts]);
}

module.exports = { encode, decode };
