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


class FakeParam(object):
    def __init__(self, value):
        self.value, self.min, self.max = value, 0.0, 1.0


class FakeMixerTrack(FakeTrack):
    # a track with Live's mixer: mute, solo, volume (DeviceParameter) and the output meter
    def __init__(self, name, volume=0.85, meter=0.0):
        FakeTrack.__init__(self, name)
        self.mute = self.solo = False
        self.mixer_device = types.SimpleNamespace(volume=FakeParam(volume))
        self.output_meter_level = meter


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
        self.back_to_arranger = True
        self.nudge_up = False
        self.nudge_down = False
        self.cue_points = [FakeCue("Song B", 32.0), FakeCue("Song A", 0.0)]
        self.tracks = []
        self.calls = []
        self.listeners = []
        self.watched = []

    def start_playing(self):
        self.calls.append("start")

    def continue_playing(self):
        self.calls.append("continue")

    def stop_playing(self):
        self.calls.append("stop")

    def re_enable_automation(self):
        self.calls.append("re_enable_automation")

    def set_or_delete_cue(self):
        # like Live: toggles a cue point at the current position
        same = [c for c in self.cue_points if abs(c.time - self.current_song_time) < 1e-6]
        if same:
            self.cue_points.remove(same[0])
        else:
            self.cue_points.append(FakeCue("", self.current_song_time))

    def add_is_playing_listener(self, cb):
        self.listeners.append(cb)

    def remove_is_playing_listener(self, cb):
        self.listeners.remove(cb)

    def add_tempo_listener(self, cb):
        self.watched.append("tempo")

    def add_cue_points_listener(self, cb):
        self.watched.append("cue_points")


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
        self.os._send_clips()  # the same error every 2 s is not repeated
        self.assertEqual([m for m in self.received() if m.get("type") == "log"], [])

    def test_automation_and_arrangement_commands(self):
        self.os._handle({"cmd": "reEnableAutomation"})
        self.os._handle({"cmd": "backToArrangement"})
        self.assertIn("re_enable_automation", self.song.calls)
        self.assertIs(self.song.back_to_arranger, False)

    def test_click_solo_during_count_in(self):
        names = ["Drums", "CLICK", "Click 2", "Guide +CLICK", "Lifesine", "Bass"]
        self.song.tracks = [FakeTrack(n) for n in names]
        for t in self.song.tracks:
            t.solo = t.name == "Bass"  # soloed by the user before the count-in
        self.os._handle({"cmd": "clickSolo", "on": True})
        # the first track or group with "click", +CLICK tracks and Lifesine (AbleSet)
        self.assertEqual([t.solo for t in self.song.tracks], [False, True, False, True, True, True])
        self.os._handle({"cmd": "clickSolo", "on": False})
        self.assertEqual([t.solo for t in self.song.tracks], [False, False, False, False, False, True])

    def test_clip_colors_and_sections_flag(self):
        clip = FakeClip("Verse", 0.0, 8.0)
        clip.color_index = 23
        self.song.tracks = [FakeTrack("Markers +SECTIONS +CC", [clip])]
        self.received()
        self.os._send_clips()
        clips = [m for m in self.received() if m.get("type") == "clips"]
        self.assertEqual(
            clips[0]["tracks"],
            [{"name": "Markers +SECTIONS +CC", "clips": [{"name": "Verse", "start": 0.0, "end": 8.0, "color": 23}]}],
        )

    def test_set_clip_colors_from_names(self):
        def clip(name, start, color):
            c = FakeClip(name, start, start + 8.0)
            c.color_index = color
            return c

        a, b, c = clip("Verse [blue]", 0.0, 0), clip("Chorus", 8.0, 5), clip("Solo [Orange] x", 16.0, 0)
        other = clip("Pad [red]", 0.0, 3)
        self.song.tracks = [FakeTrack("Sections +CC", [a, b, c]), FakeTrack("Keys", [other])]
        self.os._handle({"cmd": "setClipColorsFromNames"})
        self.assertEqual([(x.name, x.color_index) for x in (a, b, c)], [("Verse", 9), ("Chorus", 5), ("Solo x", 1)])
        self.assertEqual((other.name, other.color_index), ("Pad [red]", 3))  # no +CC/+CLIPCOLORS: untouched

    def test_mixer_tracks_are_reported(self):
        # F6: tracks in a group (+G:/+GROUP:), Click/+CLICK and +NEVERMUTE/+NM; the others are not sent
        self.song.tracks = [
            FakeMixerTrack("Vox +G:VOX", 0.7, 0.51234),
            FakeTrack("Pad"),
            FakeMixerTrack("Click"),
            FakeMixerTrack("Guide +NM"),
        ]
        self.os._send_mixer()
        mixer = [m for m in self.received() if m.get("type") == "mixer"]
        self.assertEqual(mixer[-1]["tracks"], [  # the first one went at start, with no tracks yet
            {"i": 0, "name": "Vox +G:VOX", "mute": False, "solo": False, "volume": 0.7, "meter": 0.512},
            {"i": 2, "name": "Click", "mute": False, "solo": False, "volume": 0.85, "meter": 0.0},
            {"i": 3, "name": "Guide +NM", "mute": False, "solo": False, "volume": 0.85, "meter": 0.0},
        ])

    def test_mixer_commands_set_mute_solo_and_volume(self):
        vox, click = FakeMixerTrack("Vox +G:VOX"), FakeMixerTrack("Click")
        self.song.tracks = [vox, click]
        self.os._handle({"cmd": "mixer", "track": 0, "name": "Vox +G:VOX", "mute": True, "volume": 1.7})
        self.os._handle({"cmd": "mixer", "track": 1, "name": "Click", "solo": True})
        self.assertEqual((vox.mute, vox.mixer_device.volume.value, click.solo), (True, 1.0, True))
        # the track list changed since OpenSet asked: the name does not match, nothing happens
        self.os._handle({"cmd": "mixer", "track": 1, "name": "Vox +G:VOX", "mute": True})
        self.assertFalse(click.mute)

    def test_clip_colors_from_names_read_back_as_the_same_color(self):
        # AbleSet's table (CLIP_COLORS in server/setlist.js): column of Live's palette -> color.
        # A section written "[teal]" gets a clip color that OpenSet reads back as teal
        table = ["red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal",
                 "sky", "blue", "violet", "purple", "pink", "gray"]
        for column, name in enumerate(table):
            self.assertEqual(script.COLOR_COLUMNS[name], column, name)

    def test_place_and_remove_section_locators(self):
        self.song.cue_points = [FakeCue("Song A", 0.0), FakeCue(">Chorus", 8.0)]
        clips = [FakeClip("Verse", 0.0, 8.0), FakeClip("Chorus", 8.0, 16.0), FakeClip("Bridge", 16.0, 24.0)]
        self.song.tracks = [FakeTrack("Sections", clips)]
        self.song.current_song_time = 40.0
        self.os._handle({"cmd": "placeSectionLocators"})
        # clips without a locator get a ">" one; existing locators are never toggled away
        cues = lambda: sorted((c.time, c.name) for c in self.song.cue_points)
        self.assertEqual(cues(), [(0.0, "Song A"), (8.0, ">Chorus"), (16.0, ">")])
        self.assertEqual(self.song.current_song_time, 40.0)  # playhead put back
        self.os._handle({"cmd": "removeSectionLocators"})
        self.assertEqual(cues(), [(0.0, "Song A"), (8.0, ">Chorus")])
        self.song.is_playing = True  # moving the playhead while playing: refused
        self.os._handle({"cmd": "placeSectionLocators"})
        self.assertEqual(cues(), [(0.0, "Song A"), (8.0, ">Chorus")])

    def test_phase_nudge_is_held_for_a_while(self):
        self.os._handle({"cmd": "nudge", "dir": "up", "ms": 200})
        self.assertEqual((self.song.nudge_up, self.song.nudge_down), (True, False))
        self.os._tick()
        self.assertTrue(self.song.nudge_up)
        self.os._tick()
        self.assertEqual((self.song.nudge_up, self.song.nudge_down), (False, False))
        self.os._handle({"cmd": "nudge", "dir": "down", "ms": 100})
        self.assertEqual((self.song.nudge_up, self.song.nudge_down), (False, True))

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

    def test_commands_arrive_over_udp(self):
        port = self.os._sock.getsockname()[1]
        tx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        tx.sendto(json.dumps({"cmd": "stop", "key": self.os._key}).encode("utf-8"), ("127.0.0.1", port))
        tx.sendto(b"not json", ("127.0.0.1", port))
        tx.close()
        import time
        time.sleep(0.05)
        self.os._poll_commands()
        self.assertEqual(self.song.calls, ["stop"])
        self.assertTrue(any("cmd error" in m for m in self.os.logged))

    # ---------- C6: big sets ----------

    def counting_song(self):
        reads = []

        class Counting(FakeSong):
            @property
            def cue_points(self):
                reads.append(1)
                return self._cues

            @cue_points.setter
            def cue_points(self, value):
                self._cues = value

        song = Counting()
        other = script.OpenSet(song)
        self.addCleanup(other.disconnect)
        return song, other, reads

    def test_locators_are_read_once_a_second_not_at_every_tick(self):
        # hundreds of locators read 10 times a second weigh on Live
        song, other, reads = self.counting_song()
        del reads[:]
        for _ in range(20):
            other._tick()
        self.assertLessEqual(len(reads), 3)
        song.cue_points.append(FakeCue("Song C", 64.0))  # a new locator still arrives within a second
        self.received()
        for _ in range(10):
            other._tick()
        self.assertTrue(any(len(m.get("cues", [])) == 3 for m in self.states()))

    def test_locators_placed_by_openset_are_sent_at_the_next_tick(self):
        song, other, reads = self.counting_song()
        for _ in range(3):
            other._tick()
        song.tracks = [FakeTrack("Sections", [FakeClip("Verse", 8.0, 16.0)])]
        other._handle({"cmd": "placeSectionLocators"})
        self.received()
        other._tick()
        self.assertTrue(any(any(c["time"] == 8.0 and c["name"] == ">" for c in m.get("cues", [])) for m in self.states()))

    # ---------- C3: only OpenSet commands Live ----------

    def test_state_carries_a_key_new_at_every_start(self):
        key = self.states()[-1]["key"]
        self.assertRegex(key, r"^[0-9a-f]{32}$")
        other = script.OpenSet(FakeSong())
        self.addCleanup(other.disconnect)
        self.assertNotEqual(other._key, key)

    def test_commands_without_the_key_are_ignored(self):
        port = self.os._sock.getsockname()[1]
        tx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        # another program on this computer: it cannot read the state OpenSet gets, so it has no key
        tx.sendto(json.dumps({"cmd": "stop"}).encode("utf-8"), ("127.0.0.1", port))
        tx.sendto(json.dumps({"cmd": "play", "key": "0" * 32}).encode("utf-8"), ("127.0.0.1", port))
        tx.sendto(json.dumps({"cmd": "continue", "key": self.os._key}).encode("utf-8"), ("127.0.0.1", port))
        tx.close()
        import time
        time.sleep(0.05)
        self.os._poll_commands()
        self.assertEqual(self.song.calls, ["continue"])
        self.assertEqual(sum("without OpenSet's key" in m for m in self.os.logged), 1)

    # ---------- audit 0.6.0 (A1) ----------

    def test_only_play_stop_is_watched(self):
        # the state goes out at every tick anyway; tempo automation would flood the server
        self.assertEqual(self.song.listeners, [self.os._send_state])
        self.assertEqual(self.song.watched, [])

    def test_click_solo_off_survives_a_track_that_fails(self):
        class Gone(FakeTrack):
            @property
            def solo(self):
                return getattr(self, "_solo", False)

            @solo.setter
            def solo(self, value):
                if not value and getattr(self, "_solo", False):
                    raise RuntimeError("track deleted")
                self._solo = value

        self.song.tracks = [Gone("Click"), FakeTrack("Guide +CLICK"), FakeTrack("Lifesine")]
        for t in self.song.tracks[1:]:
            t.solo = False
        self.os._handle({"cmd": "clickSolo", "on": True})
        self.os._handle({"cmd": "clickSolo", "on": False})
        self.assertEqual([t.solo for t in self.song.tracks[1:]], [False, False])
        self.assertEqual(self.os._soloed, [])

    def test_disconnect_releases_solo_nudge_and_listener(self):
        self.song.tracks = [FakeTrack("Click")]
        self.song.tracks[0].solo = False
        self.os._handle({"cmd": "clickSolo", "on": True})
        self.os._handle({"cmd": "nudge", "dir": "up", "ms": 200})
        self.os.disconnect()
        self.assertFalse(self.song.tracks[0].solo)
        self.assertEqual((self.song.nudge_up, self.song.nudge_down), (False, False))
        self.assertEqual(self.song.listeners, [])

    def test_stopping_playback_releases_the_click_solo(self):
        # the server may be gone during a count-in: stopping Live still ends the solo
        self.song.tracks = [FakeTrack("Click")]
        self.song.tracks[0].solo = False
        self.os._handle({"cmd": "clickSolo", "on": True})
        self.os._tick()  # count-in about to start
        self.song.is_playing = True
        self.os._tick()
        self.assertTrue(self.song.tracks[0].solo)
        self.song.is_playing = False
        self.os._tick()
        self.assertFalse(self.song.tracks[0].solo)

    def test_failed_send_resends_cues_and_clips_later(self):
        class Down(object):
            def sendto(self, *args):
                raise OSError(55, "No buffer space available")

            def close(self):
                pass

        real = self.os._sock
        self.os._sock = Down()
        self.song.cue_points.append(FakeCue("Song C", 64.0))
        self.song.tracks = [FakeTrack("Sections", [FakeClip("Verse", 0.0, 8.0)])]
        self.os._send_state()
        self.os._send_clips()
        self.os._sock = real
        self.received()
        self.os._send_state()
        self.os._send_clips()
        msgs = self.received()
        self.assertEqual(len([m for m in msgs if m.get("type") == "state"][0]["cues"]), 3)
        self.assertEqual(len([m for m in msgs if m.get("type") == "clips"]), 1)

    def test_cues_and_clips_are_resent_every_10_seconds(self):
        # a lost chunk must not leave the server without the setlist
        self.song.tracks = [FakeTrack("Sections", [FakeClip("Verse", 0.0, 8.0)])]
        self.os._send_clips()
        self.received()
        self.os._ticks = 100
        self.os._tick()
        msgs = self.received()
        self.assertIn("cues", [m for m in msgs if m.get("type") == "state"][0])
        self.assertEqual(len([m for m in msgs if m.get("type") == "clips"]), 1)

    def test_tick_reschedules_even_after_an_error(self):
        def boom(*_args):
            raise RuntimeError("boom")

        self.os._send_state = boom
        n = len(self.os.scheduled)
        self.os._tick()
        self.assertEqual(len(self.os.scheduled), n + 1)
        self.assertTrue(any("tick error: boom" in m for m in self.os.logged))

    def test_nudge_is_checked_and_capped(self):
        self.os._handle({"cmd": "nudge", "dir": "sideways", "ms": 200})
        self.assertEqual((self.song.nudge_up, self.song.nudge_down), (False, False))
        self.os._handle({"cmd": "nudge", "dir": "up", "ms": 10 ** 9})
        self.assertEqual(self.os._nudge_ticks, 10)  # held 1 s at most

    def test_section_locators_put_the_playhead_back_after_an_error(self):
        self.song.tracks = [FakeTrack("Sections", [FakeClip("Verse", 8.0, 16.0)])]
        self.song.current_song_time = 40.0

        def broken():
            raise RuntimeError("cue failed")

        self.song.set_or_delete_cue = broken
        with self.assertRaises(RuntimeError):
            self.os._handle({"cmd": "placeSectionLocators"})
        self.assertEqual(self.song.current_song_time, 40.0)

    def test_command_reading_skips_windows_resets_and_is_bounded(self):
        stop = json.dumps({"cmd": "stop", "key": self.os._key}).encode("utf-8")

        class Sock(object):
            def __init__(self, items):
                self.items = items

            def recvfrom(self, size):
                item = self.items.pop(0) if self.items else BlockingIOError()
                if isinstance(item, Exception):
                    raise item
                return item, ("127.0.0.1", 39061)

            def sendto(self, *args):
                pass

            def close(self):
                pass

        class Flood(Sock):
            def recvfrom(self, size):
                return stop, ("127.0.0.1", 39061)

        self.addCleanup(self.os._sock.close)
        self.os._sock = Sock([ConnectionResetError(10054, "reset"), stop])
        self.os._poll_commands()
        self.assertEqual(self.song.calls, ["stop"])
        self.os._sock = Flood([])
        self.os._poll_commands()  # a sender that never stops cannot freeze Live
        self.assertEqual(len(self.song.calls), 1 + 64)

    def test_same_error_is_logged_once_a_minute_even_when_alternating(self):
        from unittest import mock

        with mock.patch.object(script.time, "time", return_value=1000.0):
            for _ in range(3):
                self.os._log("OpenSet state error: a")
                self.os._log("OpenSet clips error: b")
        self.assertEqual(self.os.logged.count("OpenSet state error: a"), 1)
        self.assertEqual(self.os.logged.count("OpenSet clips error: b"), 1)
        with mock.patch.object(script.time, "time", return_value=1061.0):
            self.os._log("OpenSet state error: a")
        self.assertEqual(self.os.logged.count("OpenSet state error: a"), 2)

    def test_commands_without_a_value_are_refused(self):
        self.song.current_song_time = 12.0
        for cmd in ("jump", "seek", "quant"):
            with self.assertRaises(KeyError):
                self.os._handle({"cmd": cmd})
        self.assertEqual((self.song.current_song_time, self.song.clip_trigger_quantization), (12.0, 4))

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
