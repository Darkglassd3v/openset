// Puts the OpenSet icon and version into the Windows program.
//
// pkg 5.8 builds the .exe by appending its payload to a copy of a Node base
// binary, so editing the finished .exe would break the payload. The base binary
// in pkg's cache is patched instead and saved as "built-*": pkg-fetch uses that
// file when no verified "fetched-*" binary is present.
// shortcut: tied to pkg 5.8.1 (cache tag v3.4, Node 18), revisit when pkg changes.
//
// usage: npx pkg-fetch@3.4.2 -n node18 -p win -a x64   (downloads the base)
//        node scripts/win-icon.mjs                     (patches it)
//        node scripts/win-icon.mjs --check <program.exe>
// needs: npm install --no-save resedit@3.1.0

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as ResEdit from "resedit";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = createRequire(import.meta.url)(path.join(root, "package.json"));
const ICO = path.join(root, "docs", "brand", "openset.ico");
const LANG = 1033; // en-US, as in Node's own resources
const CODEPAGE = 1200;

function patch(data) {
  const exe = ResEdit.NtExecutable.from(data, { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const icons = ResEdit.Data.IconFile.from(fs.readFileSync(ICO)).icons.map((i) => i.data);
  const group = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries)[0];
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, group ? group.id : 1, group ? group.lang : LANG, icons);
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0] || ResEdit.Resource.VersionInfo.createEmpty();
  const [major, minor, patchLevel] = version.split(".").map(Number);
  vi.setFileVersion(major, minor, patchLevel, 0, LANG);
  vi.setProductVersion(major, minor, patchLevel, 0, LANG);
  vi.setStringValues(
    { lang: LANG, codepage: CODEPAGE },
    {
      ProductName: "OpenSet",
      FileDescription: `OpenSet ${version}`,
      ProductVersion: version,
      FileVersion: version,
      OriginalFilename: `openset-${version}.exe`,
      InternalName: "openset",
      CompanyName: "OpenSet",
      LegalCopyright: "MIT License",
    }
  );
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  return Buffer.from(exe.generate());
}

function check(file) {
  const res = ResEdit.NtExecutableResource.from(ResEdit.NtExecutable.from(fs.readFileSync(file), { ignoreCert: true }));
  const group = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries)[0];
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
  const strings = vi && vi.getStringValues({ lang: LANG, codepage: CODEPAGE });
  if (!group || group.icons.length !== ResEdit.Data.IconFile.from(fs.readFileSync(ICO)).icons.length)
    throw new Error(`${file}: OpenSet icon missing`);
  if (!strings || strings.ProductVersion !== version) throw new Error(`${file}: version ${version} missing`);
  console.log(`${file}: OpenSet icon (${group.icons.length} sizes) and version ${version} found`);
}

if (process.argv[2] === "--check") check(process.argv[3]);
else {
  const cache = path.join(process.env.PKG_CACHE_PATH || path.join(os.homedir(), ".pkg-cache"), "v3.4");
  const fetched = fs.readdirSync(cache).find((f) => /^fetched-v18\.\d+\.\d+-win-x64$/.test(f));
  if (!fetched) throw new Error(`no Windows base binary in ${cache}: run pkg-fetch first`);
  const built = path.join(cache, fetched.replace("fetched-", "built-"));
  fs.writeFileSync(built, patch(fs.readFileSync(path.join(cache, fetched))));
  fs.unlinkSync(path.join(cache, fetched)); // otherwise pkg keeps using the original
  console.log(`patched ${built} with the OpenSet icon and version ${version}`);
}
