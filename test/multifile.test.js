const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const S = require("../server/setlist");
const { scanSongFiles, fileSongs } = require("../server/multifile");

// a multi-file project: one .als per song, in any folder structure, like AbleSet's
function project(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openset-multi-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const put = (rel, body = "x") => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  };
  put("02 Why We Are {capo 2} [blue] [3.42].als");
  put("Roads Project/Roads.als");
  put("Roads Project/Backup/Roads [2026-10-01 120000].als"); // Live's backups: not songs
  put("Roads Project/Ableton Project Info/x.cfg");
  put(".Trash/Old.als");
  put("notes.txt");
  put("01 Intro.als");
  return dir;
}

test("F9: every .als of the folder and its subfolders is a song; Live's Backup folders and hidden ones are not", (t) => {
  const dir = project(t);
  const files = scanSongFiles(dir);
  assert.deepEqual(files.map((f) => f.key), ["01 Intro", "02 Why We Are {capo 2} [blue] [3.42]", "Roads Project/Roads"]);
  assert.equal(files[2].file, path.join(dir, "Roads Project", "Roads.als"));
  // AbleSet's notation in the file name: "." for ":" in durations
  assert.deepEqual([files[1].name, files[1].description, files[1].color, files[1].duration], ["02 Why We Are", "capo 2", "blue", 222]);
  assert.deepEqual(scanSongFiles(path.join(dir, "nope")), []);
});

test("F9: the loaded file is the song Live plays, with its sections; the other files wait to be loaded", (t) => {
  const files = scanSongFiles(project(t));
  const live = S.buildSetlist([{ name: "Why We Are", time: 0 }, { name: ">Verse", time: 8 }, { name: "SONG END", time: 64 }]);
  const songs = fileSongs(files, "02 Why We Are {capo 2} [blue] [3.42]", live);
  assert.deepEqual(songs.map((s) => [s.key, s.name, s.file]), [
    ["01 Intro", "01 Intro", "01 Intro"],
    ["02 Why We Are {capo 2} [blue] [3.42]", "02 Why We Are", "02 Why We Are {capo 2} [blue] [3.42]"],
    ["Roads Project/Roads", "Roads", "Roads Project/Roads"],
  ]);
  const loaded = songs[1];
  assert.deepEqual([loaded.time, loaded.playStart, loaded.end, loaded.sections.map((x) => x.name)], [0, 0, 64, ["Verse"]]);
  assert.deepEqual([loaded.description, loaded.color, loaded.duration], ["capo 2", "blue", 222]);
  const waiting = songs[0];
  assert.deepEqual([waiting.time, waiting.playStart, waiting.sections], [Infinity, null, []]);
  assert.equal(S.songAt(songs, 10), 1);
  // Live not there yet: every file waits
  assert.equal(fileSongs(files, "01 Intro", [])[0].playStart, null);
});
