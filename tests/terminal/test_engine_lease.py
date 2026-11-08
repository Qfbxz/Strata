"""f-0428: the desktop app's resident server (serve/server.py, `--engine strata --config ...`, no model loaded) held the runtime folder's
shared activity lease from boot for its whole lifetime, so every `strata update` answered "a running Strata server is serving, and Strata
did not start it from here" and refused - though nothing was served. The lease is now held only while the engine process is alive
(_engine_lease_take at the spawn, _engine_lease_drop at close()/unload and when the pump sees the engine's output close), so an idle
server blocks nothing and a serving engine still blocks an update (#4463)."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from strata_control import updater


class TheEngineLeaseFollowsTheEngine(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix="strata-engine-lease-test-")
        self.addCleanup(temp.cleanup)
        patcher = mock.patch.dict(os.environ, {"STRATA_RUNTIME_DIR": str(Path(temp.name) / "runtime")})
        patcher.start()
        self.addCleanup(patcher.stop)
        import serve.server as serve_server
        self.server = serve_server
        self.addCleanup(serve_server._engine_lease_drop)

    def test_an_idle_server_holds_nothing_and_serving_now_sees_nothing(self):
        self.server._engine_lease_drop()
        self.assertEqual(self.server.ENGINE_LEASE, [], "a server with no engine process holds no lease")
        self.assertEqual(updater.serving_now(), [], "an idle resident server is not 'a running Strata server'")

    def test_a_taken_lease_is_what_makes_serving_now_report_a_server(self):
        self.server._engine_lease_drop()
        self.server._engine_lease_take()
        self.assertEqual(len(self.server.ENGINE_LEASE), 1, "one descriptor, however many takes")
        self.server._engine_lease_take()
        self.assertEqual(len(self.server.ENGINE_LEASE), 1)
        self.assertEqual([item["profile"] for item in updater.serving_now()], ["a running Strata server"],
                         "a live engine is what an update must see and wait for (#4463)")
        self.server._engine_lease_drop()
        self.assertEqual(self.server.ENGINE_LEASE, [], "the drop let go of the lock")
        self.assertEqual(updater.serving_now(), [], "and the lock file is free again: the update path is open")


if __name__ == "__main__":
    unittest.main()
