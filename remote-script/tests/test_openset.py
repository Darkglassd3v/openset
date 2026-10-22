# Tests for the OpenSet Remote Script with a fake Live API.
# Run: python3 -m unittest discover -s remote-script/tests

import importlib
import json
import os
import socket
import sys
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))


class FakeControlSurface(object):
    def __init__(self, c_instance):
        self._c_instance = c_instance
        self.logged = []
        self.scheduled = []

    def song(self):
        return self._c_instance

    def log_message(self, msg):
        self.logged.append(msg)

    def schedule_message(self, delay, callback):
        self.scheduled.append((delay, callback))

    def disconnect(self):
        pass


cs = types.ModuleType("ableton.v2.control_surface")
cs.ControlSurface = FakeControlSurface
sys.modules["ableton"] = types.ModuleType("ableton")
sys.modules["ableton.v2"] = types.ModuleType("ableton.v2")
sys.modules["ableton.v2.control_surface"] = cs

package = importlib.import_module("OpenSet")
script = importlib.import_module("OpenSet.OpenSet")
DEFAULT_SERVER_ADDR = script.SERVER_ADDR  # before setUp points it at the test socket
with open(os.path.join(HERE, "..", "..", "package.json")) as f:
    VERSION = json.load(f)["version"]


class FakeCue(object):
    def __init__(self, name, time):
        self.name = name
        self.time = time
        self.jumped = False

    def jump(self):
        self.jumped = True


class FakeClip(object):
    def __init__(self, name, start, end):
        self.name = name
        self.start_time = start
        self.end_time = end


class FakeTrack(object):
    def __init__(self, name, clips=None):
        self.name = name
        if clips is not None:
            self.arrangement_clips = clips


class FakeSong(object):
    def __init__(self):
        self.is_playing = False
        self.tempo = 120.0
        self.current_song_time = 0.0
        self.signature_numerator = 4
        self.signature_denominator = 4
        self.loop = False
        self.loop_start = 0.0
        self.loop_length = 4.0
        self.clip_trigger_quantization = 4
        self.cue_points = [FakeCue("Song B", 32.0), FakeCue("Song A", 0.0)]
        self.tracks = []
        self.calls = []
        self.listeners = []

    def start_playing(self):
        self.calls.append("start")

    def continue_playing(self):
        self.calls.append("continue")

    def stop_playing(self):
        self.calls.append("stop")

    def add_is_playing_listener(self, cb):
        self.listeners.append(cb)

    def add_tempo_listener(self, cb):
        self.listeners.append(cb)

    def add_cue_points_listener(self, cb):
        self.listeners.append(cb)


class OpenSetTest(unittest.TestCase):
    def setUp(self):
        self.rx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.rx.bind(("127.0.0.1", 0))
        self.rx.settimeout(0.2)
        script.SERVER_ADDR = self.rx.getsockname()
        script.LISTEN_PORT = 0
        self.song = FakeSong()
        self.os = script.OpenSet(self.song)

    def tearDown(self):
        self.os.disconnect()
        self.rx.close()

    def received(self):
        """All messages sent so far, with chunked ones reassembled."""
        out, chunks = [], {}
        while True:
            try:
                data, _ = self.rx.recvfrom(65536)
            except socket.timeout:
                return out
            self.assertLessEqual(len(data), 8192)  # macOS loopback datagram limit is 9216
            msg = json.loads(data.decode("utf-8"))
            if msg.get("type") == "chunk":
                parts = chunks.setdefault(msg["id"], {})
                parts[msg["i"]] = msg["data"]
                if len(parts) == msg["n"]:
                    out.append(json.loads("".join(parts[i] for i in range(msg["n"]))))
            else:
                out.append(msg)

    def states(self):
        return [m for m in self.received() if m.get("type") == "state"]

    # ---------- Live -> server ----------

    def test_initial_state_has_sorted_cues_and_quantization(self):
        state = self.states()[0]
        self.assertEqual([c["name"] for c in state["cues"]], ["Song A", "Song B"])
        self.assertEqual(state["quant"], 4)
        self.assertEqual(state["tempo"], 120.0)
        self.assertIn(self.os._send_state, self.song.listeners)

    def test_state_goes_to_the_private_state_port(self):
        # 39051 is AbleSet's OSC port: Live's state must not share it
        self.assertEqual(DEFAULT_SERVER_ADDR, ("127.0.0.1", 39061))

    def test_state_reports_script_version_and_command_port(self):
        state = self.states()[0]
        self.assertEqual(state["script_version"], VERSION)
        self.assertIs(state["cmd_port"], True)

    def test_busy_command_port_is_reported(self):
        blocker = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        blocker.bind(("127.0.0.1", 0))
        self.addCleanup(blocker.close)
        script.LISTEN_PORT = blocker.getsockname()[1]
        self.received()
        other = script.OpenSet(FakeSong())
        self.addCleanup(other.disconnect)
        self.assertIs(self.states()[0]["cmd_port"], False)
        self.assertTrue(any("busy" in m for m in other.logged))

    def test_start_is_reported_to_openset(self):
        logs = [m["msg"] for m in self.received() if m.get("type") == "log"]
        self.assertIn("OpenSet script %s started (Live unknown)" % VERSION, logs)

    def test_errors_are_sent_to_openset_too(self):
        class BadName(object):
            @property
            def name(self):
                raise RuntimeError("track gone")

        self.song.tracks = [BadName()]
        self.received()
        self.os._send_clips()
        logs = [m["msg"] for m in self.received() if m.get("type") == "log"]
        self.assertEqual(logs, ["OpenSet clips error: track gone"])
        self.assertIn("OpenSet clips error: track gone", self.os.logged)

    def test_cues_are_resent_only_when_they_change(self):
        self.received()
        self.os._send_state()
        self.assertNotIn("cues", self.states()[0])
        self.song.cue_points[0].name = "Song B (live)"
        self.os._send_state()
        self.assertIn("cues", self.states()[0])

    def test_resync_resends_cues(self):
        self.received()
        self.os._handle({"cmd": "resync"})
        self.os._send_state()
        self.assertIn("cues", self.states()[0])

    def test_large_messages_are_chunked(self):
        self.received()
        self.song.cue_points = [FakeCue("Brano con un nome lunghissimo è %d" % i, i) for i in range(400)]
        self.os._send_state()
        state = self.states()[0]
        self.assertEqual(len(state["cues"]), 400)
        self.assertEqual(state["cues"][399]["name"], "Brano con un nome lunghissimo è 399")

    def test_clips_of_sections_and_lyrics_tracks(self):
        self.song.tracks = [
            FakeTrack("Sections", [FakeClip("Verse", 0.0, 16.0)]),
            FakeTrack("Vox +LYRICS", [FakeClip("[Am]Ciao", 0.0, 4.0)]),
            FakeTrack("Drums", [FakeClip("Beat", 0.0, 64.0)]),
            FakeTrack("Old Live 10 track"),
        ]
        self.received()
        self.os._send_clips()
        clips = [m for m in self.received() if m.get("type") == "clips"]
        self.assertEqual(
            clips[0]["tracks"],
            [
                {"name": "Sections", "clips": [{"name": "Verse", "start": 0.0, "end": 16.0}]},
                {"name": "Vox +LYRICS", "clips": [{"name": "[Am]Ciao", "start": 0.0, "end": 4.0}]},
            ],
        )
        self.os._send_clips()
        self.assertEqual([m for m in self.received() if m.get("type") == "clips"], [])
        self.song.tracks[1].arrangement_clips.append(FakeClip("Mondo", 4.0, 8.0))
        self.os._send_clips()
        self.assertEqual(len([m for m in self.received() if m.get("type") == "clips"]), 1)

    def test_sections_track_without_arrangement_clips_is_skipped(self):
        class BadName(object):
            @property
            def name(self):
                raise RuntimeError("track gone")

        self.song.tracks = [FakeTrack("Sections"), BadName()]  # Live 10 track, deleted track
        self.received()
        self.os._send_clips()
        clips = [m for m in self.received() if m.get("type") == "clips"]
        self.assertEqual(clips, [])  # same empty list as at startup: nothing new to send
        self.assertTrue(any("clips error" in m for m in self.os.logged))

    def test_busy_port_and_missing_listeners_are_logged(self):
        script.LISTEN_PORT = self.os._sock.getsockname()[1]
        other = script.OpenSet(object())  # no listener API, port taken
        try:
            self.assertTrue(any("busy" in m for m in other.logged))
            self.assertTrue(any("listener error" in m for m in other.logged))
        finally:
            other.disconnect()

    def test_send_errors_are_swallowed(self):
        self.os._sock.close()
        self.os._send({"type": "pong"})  # must not raise inside Live
        self.os.disconnect()  # closing twice is fine too

    def test_state_errors_are_logged(self):
        self.song.cue_points = None
        self.os._send_state()
        self.assertTrue(any("state error" in m for m in self.os.logged))

    # ---------- server -> Live ----------

    def test_transport_commands(self):
        for cmd in ("play", "continue", "stop"):
            self.os._handle({"cmd": cmd})
        self.assertEqual(self.song.calls, ["start", "continue", "stop"])

    def test_jump_to_a_cue_uses_quantized_cue_jump(self):
        self.os._handle({"cmd": "jump", "time": 32})
        self.assertTrue(self.song.cue_points[0].jumped)
        self.assertEqual(self.song.current_song_time, 0.0)

    def test_jump_elsewhere_and_seek_set_the_song_time(self):
        self.os._handle({"cmd": "jump", "time": 12})
        self.assertEqual(self.song.current_song_time, 12.0)
        self.os._handle({"cmd": "seek", "time": 20})
        self.assertEqual(self.song.current_song_time, 20.0)

    def test_loop_tempo_and_quantization(self):
        self.os._handle({"cmd": "loop", "on": True, "start": 8, "length": 4})
        self.assertEqual((self.song.loop, self.song.loop_start, self.song.loop_length), (True, 8.0, 4.0))
        self.os._handle({"cmd": "loop", "on": False})
        self.assertFalse(self.song.loop)
        self.os._handle({"cmd": "tempo", "bpm": 98.5})
        self.assertEqual(self.song.tempo, 98.5)
        self.os._handle({"cmd": "quant", "value": 7})
        self.assertEqual(self.song.clip_trigger_quantization, 7)

    def test_ping(self):
        self.received()
        self.os._handle({"cmd": "ping"})
        self.assertIn({"type": "pong"}, self.received())

    def test_commands_arrive_over_udp(self):
        port = self.os._sock.getsockname()[1]
        tx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        tx.sendto(json.dumps({"cmd": "stop"}).encode("utf-8"), ("127.0.0.1", port))
        tx.sendto(b"not json", ("127.0.0.1", port))
        tx.close()
        import time
        time.sleep(0.05)
        self.os._poll_commands()
        self.assertEqual(self.song.calls, ["stop"])
        self.assertTrue(any("cmd error" in m for m in self.os.logged))

    # ---------- lifecycle ----------

    def test_tick_reschedules_until_disconnect(self):
        n = len(self.os.scheduled)
        self.os._tick()
        self.assertEqual(len(self.os.scheduled), n + 1)
        self.os.disconnect()
        self.os._tick()
        self.assertEqual(len(self.os.scheduled), n + 1)

    def test_entry_points(self):
        self.assertEqual(package.get_capabilities(), {})
        inst = package.create_instance(FakeSong())
        self.assertIsInstance(inst, script.OpenSet)
        inst.disconnect()


if __name__ == "__main__":
    unittest.main()
