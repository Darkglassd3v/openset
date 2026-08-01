# OpenSet Remote Script for Ableton Live 11/12
# Bridges Live's API to the OpenSet Node server over UDP (JSON messages).
# Install: copy the "OpenSet" folder into your User Library / Remote Scripts
# then select "OpenSet" as a Control Surface in Live's Link/MIDI preferences.

import json
import socket

try:
    # Live 11/12 modern framework
    from ableton.v2.control_surface import ControlSurface
except ImportError:
    # Legacy fallback
    from _Framework.ControlSurface import ControlSurface

SERVER_ADDR = ("127.0.0.1", 39051)   # where the Node server listens
LISTEN_PORT = 39050                  # where this script listens for commands
TICK_MS = 100                        # state broadcast interval


class OpenSet(ControlSurface):
    def __init__(self, c_instance):
        super(OpenSet, self).__init__(c_instance)
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._sock.setblocking(False)
        try:
            self._sock.bind(("127.0.0.1", LISTEN_PORT))
        except OSError:
            self.log_message("OpenSet: port %d busy" % LISTEN_PORT)
        self._song = self.song if not callable(self.song) else self.song()
        self._alive = True
        self._add_listeners()
        self._tick()
        self.log_message("OpenSet connected")

    # ---------- lifecycle ----------

    def disconnect(self):
        self._alive = False
        try:
            self._sock.close()
        except Exception:
            pass
        super(OpenSet, self).disconnect()

    def _tick(self):
        if not self._alive:
            return
        self._poll_commands()
        self._send_state()
        # schedule_message(delay_in_ticks, callback) — ~10 Hz
        self.schedule_message(1, self._tick)

    # ---------- Live -> server ----------

    def _add_listeners(self):
        s = self._song
        try:
            s.add_is_playing_listener(self._send_state)
            s.add_tempo_listener(self._send_state)
            s.add_cue_points_listener(self._send_state)
        except Exception as e:
            self.log_message("OpenSet listener error: %s" % e)

    def _send(self, obj):
        try:
            self._sock.sendto(json.dumps(obj).encode("utf-8"), SERVER_ADDR)
        except Exception:
            pass

    def _send_state(self):
        s = self._song
        try:
            cues = [{"name": c.name, "time": c.time} for c in s.cue_points]
            cues.sort(key=lambda c: c["time"])
            self._send({
                "type": "state",
                "is_playing": s.is_playing,
                "tempo": s.tempo,
                "beat": s.current_song_time,
                "sig_num": s.signature_numerator,
                "sig_den": s.signature_denominator,
                "loop": s.loop,
                "loop_start": s.loop_start,
                "loop_length": s.loop_length,
                "cues": cues,
            })
        except Exception as e:
            self.log_message("OpenSet state error: %s" % e)

    # ---------- server -> Live ----------

    def _poll_commands(self):
        while True:
            try:
                data, _addr = self._sock.recvfrom(65536)
            except (BlockingIOError, OSError):
                break
            try:
                self._handle(json.loads(data.decode("utf-8")))
            except Exception as e:
                self.log_message("OpenSet cmd error: %s" % e)

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
            t = float(msg.get("time", 0))
            for c in s.cue_points:
                if abs(c.time - t) < 0.001:
                    c.jump()
                    return
            s.current_song_time = t
        elif cmd == "seek":
            s.current_song_time = float(msg.get("time", 0))
        elif cmd == "loop":
            on = bool(msg.get("on", False))
            if "start" in msg and "length" in msg:
                s.loop_start = float(msg["start"])
                s.loop_length = float(msg["length"])
            s.loop = on
        elif cmd == "tempo":
            s.tempo = float(msg.get("bpm", s.tempo))
        elif cmd == "ping":
            self._send({"type": "pong"})


def create_instance(c_instance):
    return OpenSet(c_instance)
