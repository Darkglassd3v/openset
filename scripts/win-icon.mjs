// Puts the OpenSet icon and version into the Windows program, after OpenSet has been
// injected into the Node binary (scripts/build-sea.mjs); the injected blob is kept.
//
// usage: node scripts/win-icon.mjs <program.exe>          (patches it in place)
//        node scripts/win-icon.mjs --check <program.exe>

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as ResEdit from "resedit";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = createRequire(import.meta.url)(path.join(root, "package.json"));
const ICO = path.join(root, "docs", "brand", "openset.ico");
const LANG = 1033; // en-US, as in Node's own resources
const CODEPAGE = 1200;

// the certificate is dropped: it would not match the program after the injection
export function patch(data) {
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

export function check(file) {
  const res = ResEdit.NtExecutableResource.from(ResEdit.NtExecutable.from(fs.readFileSync(file), { ignoreCert: true }));
  const group = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries)[0];
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
  const strings = vi && vi.getStringValues({ lang: LANG, codepage: CODEPAGE });
  if (!group || group.icons.length !== ResEdit.Data.IconFile.from(fs.readFileSync(ICO)).icons.length)
    throw new Error(`${file}: OpenSet icon missing`);
  if (!strings || strings.ProductVersion !== version) throw new Error(`${file}: version ${version} missing`);
  console.log(`${file}: OpenSet icon (${group.icons.length} sizes) and version ${version} found`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "--check") check(process.argv[3]);
  else {
    fs.writeFileSync(process.argv[2], patch(fs.readFileSync(process.argv[2])));
    console.log(`${process.argv[2]}: OpenSet icon and version ${version}`);
  }
}
