// Builds the OpenSet programs as Node single executable applications (SEA): an
// official Node binary (the newest 24 LTS, or NODE_VERSION) with OpenSet injected
// into it. Node 18, which pkg 5.8.1 was stuck on, has no security fixes since April 2025.
//
// 1. esbuild puts the server and its libraries in one CommonJS file (SEA runs one file)
// 2. the Node of this computer's platform, same version, makes the SEA blob from it
// 3. for each platform: the official Node archive, checked against SHASUMS256.txt;
//    a Mac binary loses its signature; postject injects the blob; then Windows gets
//    the OpenSet icon and version (and loses Node's signature, no longer valid), and
//    on a Mac the program is signed ad hoc (Apple Silicon refuses unsigned programs;
//    built elsewhere, the app launcher signs it on first run)
//
// usage: node scripts/build-sea.mjs [--targets linux-x64,win-x64,macos-x64,macos-arm64] [--out build]
// The programs are named as scripts/assemble-release.sh expects (openset-linux, openset-win.exe…).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

// OpenSet's platform names -> Node's
export const TARGETS = {
  "linux-x64": { os: "linux", arch: "x64" },
  "win-x64": { os: "win", arch: "x64" },
  "macos-x64": { os: "darwin", arch: "x64" },
  "macos-arm64": { os: "darwin", arch: "arm64" },
};
export const outName = (target) => ({ "linux-x64": "openset-linux", "win-x64": "openset-win.exe", "macos-x64": "openset-macos", "macos-arm64": "openset-macos-arm64" })[target];

export function nodeArchive(version, target) {
  const { os, arch } = TARGETS[target];
  const base = `node-${version}-${os}-${arch}`;
  const file = base + (os === "win" ? ".zip" : ".tar.gz");
  return { url: `https://nodejs.org/dist/${version}/${file}`, file, inner: os === "win" ? `${base}/node.exe` : `${base}/bin/node` };
}

// Windows' own bsdtar reads zip files; in Git Bash "tar" may be GNU tar, which does not
const TAR = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
const hostTarget = () => `${{ darwin: "macos", win32: "win", linux: "linux" }[process.platform]}-${process.arch}`;

async function newestNode24() {
  const list = await (await fetch("https://nodejs.org/dist/index.json")).json();
  return list.find((r) => r.version.startsWith("v24.") && r.lts).version;
}

async function download(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// the Node binary of one platform, from its official archive, checked, kept in build/node-cache
async function nodeBinary(version, target, sums) {
  const a = nodeArchive(version, target);
  const dir = path.join(ROOT, "build", "node-cache", version, target);
  const bin = path.join(dir, path.basename(a.inner));
  if (fs.existsSync(bin)) return bin;
  fs.mkdirSync(dir, { recursive: true });
  const data = await download(a.url);
  const want = sums.split("\n").find((l) => l.endsWith("  " + a.file));
  const got = crypto.createHash("sha256").update(data).digest("hex");
  if (!want || !want.startsWith(got)) throw new Error(`${a.file}: SHA-256 ${got} does not match SHASUMS256.txt`);
  const archive = path.join(dir, a.file);
  fs.writeFileSync(archive, data);
  if (a.file.endsWith(".zip")) {
    // unzip where it exists (Linux); bsdtar reads zip files on macOS and Windows
    try {
      execFileSync("unzip", ["-o", "-j", archive, a.inner, "-d", dir], { stdio: "ignore" });
    } catch {
      execFileSync(TAR, ["-xf", archive, "-C", dir, a.inner]);
      fs.renameSync(path.join(dir, a.inner), bin);
    }
  } else {
    execFileSync(TAR, ["-xzf", archive, "-C", dir, a.inner]);
    fs.renameSync(path.join(dir, a.inner), bin);
  }
  fs.rmSync(archive);
  return bin;
}

async function main() {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : fallback;
  };
  const targets = arg("--targets", Object.keys(TARGETS).join(",")).split(",");
  for (const t of targets) if (!TARGETS[t]) throw new Error(`unknown target ${t}`);
  const out = path.resolve(ROOT, arg("--out", "build"));
  const version = process.env.NODE_VERSION || (await newestNode24());
  console.log(`OpenSet programs with Node ${version}: ${targets.join(", ")}`);
  const sums = (await download(`https://nodejs.org/dist/${version}/SHASUMS256.txt`)).toString("utf-8");

  const work = path.join(ROOT, "build", "sea");
  fs.mkdirSync(work, { recursive: true });
  const { buildSync } = await import("esbuild");
  buildSync({
    entryPoints: [path.join(ROOT, "server", "index.js")],
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    outfile: path.join(work, "openset.cjs"),
    external: ["bufferutil", "utf-8-validate"], // optional speedups of ws, tried and skipped
    logLevel: "warning",
  });
  const config = path.join(work, "sea-config.json");
  const blob = path.join(work, "sea-prep.blob");
  // no code cache or snapshot: the same blob goes into the programs of every platform
  fs.writeFileSync(config, JSON.stringify({ main: path.join(work, "openset.cjs"), output: blob, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false }));
  execFileSync(await nodeBinary(version, hostTarget(), sums), ["--experimental-sea-config", config], { stdio: "inherit" });

  const { inject } = await import("postject");
  const onMac = process.platform === "darwin";
  fs.mkdirSync(out, { recursive: true });
  for (const target of targets) {
    const file = path.join(out, outName(target));
    fs.copyFileSync(await nodeBinary(version, target, sums), file);
    fs.chmodSync(file, 0o755);
    const mac = target.startsWith("macos");
    if (mac && onMac) execFileSync("codesign", ["--remove-signature", file]);
    await inject(file, "NODE_SEA_BLOB", fs.readFileSync(blob), { sentinelFuse: FUSE, ...(mac ? { machoSegmentName: "NODE_SEA" } : {}) });
    // after the injection: postject's PE reader complains about a program resedit has written
    if (target === "win-x64") {
      const { patch } = await import(pathToFileURL(path.join(ROOT, "scripts", "win-icon.mjs")).href);
      fs.writeFileSync(file, patch(fs.readFileSync(file)));
    }
    if (mac && onMac) execFileSync("codesign", ["--force", "--sign", "-", file]);
    console.log(`${file}: OpenSet with Node ${version}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
