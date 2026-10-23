# OpenSet Remote Script for Ableton Live 11/12
# Bridges Live's API to the OpenSet Node server over UDP (JSON messages).
# Install: copy the "OpenSet" folder into your User Library / Remote Scripts
# then select "OpenSet" as a Control Surface in Live's Link/MIDI preferences.

import binascii
import json
import os
import re
import socket
import time

try:
    # Live 11/12 modern framework
    from ableton.v2.control_surface import ControlSurface
except ImportError:
    # Legacy fallback
    from _Framework.ControlSurface import ControlSurface

VERSION = "0.6.2"                    # OpenSet version, same as package.json (checked by the tests)
SERVER_ADDR = ("127.0.0.1", 39061)   # where the Node server listens; 39051 is AbleSet's OSC port
LISTEN_PORT = 39050                  # where this script listens for commands
TICK_MS = 100                        # state broadcast interval
MAX_DATAGRAM = 8000                  # macOS caps loopback UDP datagrams at 9216 bytes
CHUNK_CHARS = 1000                   # bigger messages go in chunks; room for JSON escaping
CLIPS_EVERY = 20                     # ticks between scans of Sections/+LYRICS clips (~2 s)
CUES_EVERY = 10                      # ticks between reads of the locators (~1 s): hundreds of them weigh on Live
RESEND_EVERY = 100                   # ticks between full resends of cues and clips (~10 s): a lost chunk is not forever
MAX_COMMANDS = 64                    # commands read per tick: a flooding sender cannot freeze Live
LOG_EVERY = 60                       # seconds before the same message is logged again


# AbleSet color -> column of Live's palette (first row), for "Set Clip Colors from Names"
COLOR_COLUMNS = {
    "red": 0, "rose": 0, "orange": 1, "amber": 2, "yellow": 3, "lime": 4, "green": 5, "emerald": 6,
    "teal": 6, "cyan": 7, "sky": 8, "blue": 9, "indigo": 10, "violet": 10, "purple": 11,
    "fuchsia": 12, "pink": 12, "gray": 13,
}
COLOR_TAG = re.compile(r"\[\s*([A-Za-z]+)\s*\]")


def _is_sections(name):
    return name.strip().lower().startswith("sections") or "+SECTIONS" in name.split()


def _live_version():
    try:
        import Live
        app = Live.Application.get_application()
        return "%d.%d.%d" % (app.get_major_version(), app.get_minor_version(), app.get_bugfix_version())
    except Exception:
        return None


def _quantization(value):
    # Live wants its own enum; plain ints are kept outside Live (tests)
    try:
        import Live
        return Live.Song.Quantization.values[value]
    except Exception:
        return value


class OpenSet(ControlSurface):
    def __init__(self, c_instance):
        super(OpenSet, self).__init__(c_instance)
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._sock.setblocking(False)
        self._cmd_port = True     # False: commands from OpenSet cannot reach this script
        try:
            self._sock.bind(("127.0.0.1", LISTEN_PORT))
        except OSError:
            self._cmd_port = False
        self._song = self.song if not callable(self.song) else self.song()
        self._live_version = _live_version()
        self._logged = {}         # message -> last time it was logged
        self._was_playing = False
        self._alive = True
        self._ticks = 0
        self._chunk_id = int(time.time() * 1000) % 1000000000
        self._cues_sent = None    # last cues sent, resent only when they change
        self._clips_sent = None
        self._soloed = []         # tracks soloed for a count-in, unsoloed after it
        self._nudge_ticks = 0     # ticks left with a phase nudge button held
        # sent only to OpenSet with the state: commands without it (another program) are ignored
        self._key = binascii.hexlify(os.urandom(16)).decode("ascii")
        self._log("OpenSet script %s started (Live %s)" % (VERSION, self._live_version or "unknown"))
        if not self._cmd_port:
            self._log("OpenSet: port %d busy" % LISTEN_PORT)
        self._add_listeners()
        self._tick()
        self.log_message("OpenSet connected")

    # ---------- lifecycle ----------

    def disconnect(self):
        self._alive = False
        try:
            # nothing stays held once the script stops: click solo, phase nudge, listener
            self._click_solo(False)
            self._song.nudge_up = self._song.nudge_down = False
            self._song.remove_is_playing_listener(self._send_state)
        except Exception:
            pass
        try:
            self._sock.close()
        except Exception:
            pass
        super(OpenSet, self).disconnect()

    def _tick(self):
        if not self._alive:
            return
        try:
            self._poll_commands()
            if self._nudge_ticks:
                self._nudge_ticks -= 1
                if not self._nudge_ticks:
                    self._song.nudge_up = False
                    self._song.nudge_down = False
            playing = self._song.is_playing
            if self._soloed and self._was_playing and not playing:
                self._click_solo(False)  # a count-in solo never outlives playback, even without the server
            self._was_playing = playing
            if self._ticks % RESEND_EVERY == 0:
                self._cues_sent = self._clips_sent = None
            self._send_state(self._ticks % CUES_EVERY == 0 or self._cues_sent is None)
            if self._ticks % CLIPS_EVERY == 0:
                self._send_clips()
        except Exception as e:
            self._log("OpenSet tick error: %s" % e)
        self._ticks += 1
        # schedule_message(delay_in_ticks, callback) — ~10 Hz
        self.schedule_message(1, self._tick)

    # ---------- Live -> server ----------

    def _log(self, msg):
        # Live's Log.txt is hard to find for users: OpenSet's log gets it too.
        # An error repeated at every tick is logged once a minute.
        now = time.time()
        if now - self._logged.get(msg, now - LOG_EVERY) < LOG_EVERY:
            return
        if len(self._logged) > 100:
            self._logged = {}
        self._logged[msg] = now
        self.log_message(msg)
        self._send({"type": "log", "msg": msg})

    def _add_listeners(self):
        s = self._song
        try:
            # tempo and locators go out at every tick; their notifications would flood the server
            s.add_is_playing_listener(self._send_state)
        except Exception as e:
            self._log("OpenSet listener error: %s" % e)

    def _send(self, obj):
        data = json.dumps(obj)  # ASCII only, so len() is the byte size
        try:
            if len(data) <= MAX_DATAGRAM:
                self._sock.sendto(data.encode("utf-8"), SERVER_ADDR)
                return True
            self._chunk_id += 1
            parts = [data[i:i + CHUNK_CHARS] for i in range(0, len(data), CHUNK_CHARS)]
            for i, part in enumerate(parts):
                chunk = {"type": "chunk", "id": self._chunk_id, "i": i, "n": len(parts), "data": part}
                self._sock.sendto(json.dumps(chunk).encode("utf-8"), SERVER_ADDR)
            return True
        except Exception:
            return False  # inside Live a send error must never raise

    def _send_state(self, read_cues=True):
        s = self._song
        try:
            state = {
                "type": "state",
                "is_playing": s.is_playing,
                "tempo": s.tempo,
                "beat": s.current_song_time,
                "sig_num": s.signature_numerator,
                "sig_den": s.signature_denominator,
                "loop": s.loop,
                "loop_start": s.loop_start,
                "loop_length": s.loop_length,
                "quant": int(s.clip_trigger_quantization),
                "script_version": VERSION,
                "live_version": self._live_version,
                "cmd_port": self._cmd_port,
                "key": self._key,
            }
            key = self._cues_sent
            if read_cues:
                cues = [{"name": c.name, "time": c.time} for c in s.cue_points]
                cues.sort(key=lambda c: c["time"])
                key = json.dumps(cues)
                if key != self._cues_sent:
                    state["cues"] = cues
            if self._send(state):
                self._cues_sent = key  # only once delivered to the socket
        except Exception as e:
            self._log("OpenSet state error: %s" % e)

    def _send_clips(self):
        # clips of the "Sections" track and of "+LYRICS" tracks (Live 11+ API)
        tracks = []
        try:
            all_tracks = list(self._song.tracks)
        except Exception as e:
            # never let a scan error break the _tick loop
            self._log("OpenSet clips error: %s" % e)
            return
        for t in all_tracks:
            try:
                name = t.name
                if not (_is_sections(name) or "+LYRICS" in name):
                    continue
                clips = getattr(t, "arrangement_clips", None)
                if clips is None:
                    continue
                tracks.append({
                    "name": name,
                    "clips": [self._clip(c) for c in clips],
                })
            except Exception as e:
                self._log("OpenSet clips error: %s" % e)
        key = json.dumps(tracks)
        if key != self._clips_sent and self._send({"type": "clips", "tracks": tracks}):
            self._clips_sent = key

    @staticmethod
    def _clip(c):
        clip = {"name": c.name, "start": c.start_time, "end": c.end_time}
        color = getattr(c, "color_index", None)  # Live 11+: for +CC section colors
        if color is not None:
            clip["color"] = color
        return clip

    # ---------- server -> Live ----------

    def _poll_commands(self):
        for _ in range(MAX_COMMANDS):
            try:
                data, _addr = self._sock.recvfrom(65536)
            except ConnectionResetError:
                continue  # Windows: an old "port unreachable" from a send while the server was down
            except OSError:
                break
            try:
                msg = json.loads(data.decode("utf-8"))
                if not isinstance(msg, dict) or msg.get("key") != self._key:
                    self._log("OpenSet: a command without OpenSet's key was ignored")
                    continue
                self._handle(msg)
            except Exception as e:
                self._log("OpenSet cmd error: %s" % e)

    def _handle(self, msg):
        s = self._song
        cmd = msg.get("cmd")
        if cmd == "play":
            s.start_playing()
        elif cmd == "continue":
            s.continue_playing()
        elif cmd == "stop":
            s.stop_playing()
        elif cmd == "jump":
            # jump to a cue point by beat time
            t = float(msg["time"])
            for c in s.cue_points:
                if abs(c.time - t) < 0.001:
                    c.jump()
                    return
            s.current_song_time = t
        elif cmd == "seek":
            s.current_song_time = float(msg["time"])
        elif cmd == "loop":
            on = bool(msg.get("on", False))
            if "start" in msg and "length" in msg:
                s.loop_start = float(msg["start"])
                s.loop_length = float(msg["length"])
            s.loop = on
        elif cmd == "tempo":
            s.tempo = float(msg.get("bpm", s.tempo))
        elif cmd == "quant":
            s.clip_trigger_quantization = _quantization(int(msg["value"]))
        elif cmd == "setClipColorsFromNames":
            self._clip_colors_from_names()
        elif cmd in ("placeSectionLocators", "removeSectionLocators"):
            self._section_locators(cmd == "placeSectionLocators")
        elif cmd == "nudge":
            # AbleNet drift correction: hold Live's phase nudge button for a moment (1 s at most)
            if msg.get("dir") not in ("up", "down"):
                return
            up = msg["dir"] == "up"
            s.nudge_up = up
            s.nudge_down = not up
            self._nudge_ticks = max(1, min(int(msg.get("ms", 200)), 1000) // TICK_MS)
        elif cmd == "clickSolo":
            self._click_solo(bool(msg.get("on")))
        elif cmd == "reEnableAutomation":
            s.re_enable_automation()
        elif cmd == "backToArrangement":
            s.back_to_arranger = False  # False sends every track back to the Arrangement
        elif cmd == "resync":
            self._cues_sent = None
            self._clips_sent = None


    def _clip_colors_from_names(self):
        # AbleSet tool: "Verse [blue]" on a +CC/+CLIPCOLORS track becomes a blue clip named "Verse"
        for t in list(self._song.tracks):
            words = t.name.split()
            if "+CC" not in words and "+CLIPCOLORS" not in words:
                continue
            for c in getattr(t, "arrangement_clips", None) or []:
                tag = next((m for m in COLOR_TAG.finditer(c.name) if m.group(1).lower() in COLOR_COLUMNS), None)
                if tag:
                    c.color_index = COLOR_COLUMNS[tag.group(1).lower()]
                    c.name = " ".join((c.name[:tag.start()] + c.name[tag.end():]).split())

    def _section_locators(self, place):
        # AbleSet tools: a ">" locator on each section clip (jumpable while playing), or remove them.
        # set_or_delete_cue() toggles a cue at the playhead, so positions with other locators are left alone.
        s = self._song
        if s.is_playing:
            self._log("OpenSet: stop playback before placing or removing section locators")
            return
        track = next((t for t in s.tracks if _is_sections(t.name)), None)
        if track is None:
            return
        back = s.current_song_time
        try:
            for start in [c.start_time for c in getattr(track, "arrangement_clips", None) or []]:
                here = [c for c in s.cue_points if abs(c.time - start) < 1e-3]
                if place and not here:
                    s.current_song_time = start
                    s.set_or_delete_cue()
                    for c in s.cue_points:
                        if abs(c.time - start) < 1e-3:
                            c.name = ">"
                elif not place and len(here) == 1 and here[0].name == ">":
                    s.current_song_time = start
                    s.set_or_delete_cue()
        finally:
            s.current_song_time = back  # the next Play starts where the user left it
            self._cues_sent = None  # the new locators go out at the next tick, not within a second

    def _click_solo(self, on):
        # AbleSet: the first track or group with "click", +CLICK tracks and Lifesine
        old, self._soloed = self._soloed, []
        for t in old:
            try:
                t.solo = False
            except Exception:
                pass  # a deleted track must not keep the others soloed
        if not on:
            return
        tracks = list(self._song.tracks)
        first = next((t for t in tracks if "click" in t.name.lower()), None)
        for t in tracks:
            if (t is first or "+CLICK" in t.name or t.name.strip().lower() == "lifesine") and not t.solo:
                t.solo = True
                self._soloed.append(t)


def create_instance(c_instance):
    return OpenSet(c_instance)
