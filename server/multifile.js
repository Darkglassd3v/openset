// AbleSet's multi-file projects: one Live set (.als) per song, in a folder of any
// structure. The files are the setlist; the loaded one is the song Live plays.

const fs = require("fs");
const path = require("path");
const { parseName } = require("./setlist");

// every .als of the folder and its subfolders, sorted; Live's Backup folders and hidden
// files are left out. key: the path without ".als" (two songs may share a file name)
function scanSongFiles(folder, max = 1000) {
  const out = [];
  const walk = (dir, rel) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= max || e.name.startsWith(".")) continue;
      if (e.isDirectory()) {
        if (e.name !== "Backup") walk(path.join(dir, e.name), rel + e.name + "/");
      } else if (/\.als$/i.test(e.name)) {
        const key = rel + e.name.replace(/\.als$/i, "");
        // a file name cannot hold ":": AbleSet writes durations as [3.42]
        const p = parseName(e.name.replace(/\.als$/i, "").replace(/\[(\d+)\.(\d{2})\]/g, "[$1:$2]"));
        out.push({ key, file: path.join(dir, e.name), name: p.name, description: p.description, color: p.color, duration: p.duration, tags: p.tags });
      }
    }
  };
  walk(folder, "");
  return out.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
}

// the setlist of a multi-file project: the loaded file takes the first song Live reports
// (time, sections, end); the others have no place on Live's timeline until loaded
function fileSongs(files, loaded, liveSongs) {
  const live = (liveSongs || [])[0];
  return files.map((f) => {
    const own = { key: f.key, name: f.name, file: f.key, description: f.description, color: f.color, tags: f.tags };
    if (f.key === loaded && live) return { ...live, ...own, duration: f.duration ?? live.duration };
    return {
      ...own,
      time: Infinity,
      end: null,
      endMarker: null,
      jumpAfterStop: null,
      stopDescription: null,
      duration: f.duration,
      nosong: false,
      transpose: null,
      classes: [],
      sections: [],
      endAt: null,
      playStart: null,
    };
  });
}

module.exports = { scanSongFiles, fileSongs };
