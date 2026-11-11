"""E3 (HARNESS_ROADMAP 阶段三): the small model - a resident llama-server sidecar that serves short
tasks (session titles, short summaries) without spending the main model's context window, and turns
pictures into text for a main model that has no vision tower of its own.

    python -m serve.test_small_model
"""
import base64
import io
import json
import unittest
import urllib.error
from unittest import mock

import serve.server as server
from serve.small_model import SMALL_NAMES, SmallModel


def fake_response(payload, status=200):
    body = json.dumps(payload).encode()
    r = io.BytesIO(body)                      # urllib needs .read() and the context manager
    r.status = status
    return r


def capture_post(calls):
    """A urlopen stub that records every request and answers a canned chat completion."""
    def post(url, req, timeout=None):
        calls.append({"url": url, "body": json.loads(req.data), "timeout": timeout})
        return fake_response({"choices": [{"message": {"role": "assistant", "content": "OK"}}],
                              "usage": {"prompt_tokens": 1, "completion_tokens": 1}})
    return post


def small_of(**cfg):
    base = {"exe": "/engines/llama-server", "model": "/m/vl-q8_0.gguf", "mmproj": "/m/mmproj-f16.gguf"}
    s = SmallModel({**base, **cfg}, lazy=True)
    s.__dict__["_ensure"] = lambda: None       # the unit tests do not start a process; _post is the seam
    return s


class ServerArgs(unittest.TestCase):
    def test_the_command_line_carries_the_model_the_mmproj_and_the_loopback_port(self):
        args = SmallModel.server_args({"exe": "/engines/llama-server", "model": "/m/vl.gguf",
                                       "mmproj": "/m/mm.gguf", "port": 4311, "ctx": 8192, "ngl": 99})
        text = " ".join(args)
        self.assertEqual(args[0], "/engines/llama-server")
        self.assertIn("--host 127.0.0.1", text)
        self.assertIn("--port 4311", text)
        self.assertIn("-m /m/vl.gguf", text)
        self.assertIn("--mmproj /m/mm.gguf", text)
        self.assertIn("-c 8192", text)
        self.assertIn("-ngl 99", text)

    def test_the_defaults_apply_without_keys(self):
        args = SmallModel.server_args({"exe": "/e", "model": "/m", "mmproj": "/mm"})
        text = " ".join(args)
        self.assertIn(f"-c {SmallModel.DEFAULT_CTX}", text)
        self.assertIn(f"-ngl {SmallModel.DEFAULT_NGL}", text)

    def test_a_zero_ngl_is_kept(self):
        # an explicit 0 means "all on the CPU": the default must not replace it
        text = " ".join(SmallModel.server_args({"exe": "/e", "model": "/m", "mmproj": "/mm", "ngl": 0}))
        self.assertIn("-ngl 0", text)


class ChatProxy(unittest.TestCase):
    def test_chat_posts_the_messages_and_returns_the_text(self):
        s = small_of(port=4301)
        calls = []
        with mock.patch("serve.small_model._post", capture_post(calls)):
            out = s.chat([{"role": "user", "content": "title this"}])
        self.assertEqual(out, "OK")
        sent = calls[0]["body"]
        self.assertEqual(sent["messages"], [{"role": "user", "content": "title this"}])
        self.assertTrue(calls[0]["url"].startswith("http://127.0.0.1:4301/"))

    def test_extra_fields_pass_through_and_nulls_are_dropped(self):
        s = small_of()
        calls = []
        with mock.patch("serve.small_model._post", capture_post(calls)):
            s.chat([{"role": "user", "content": "x"}], max_tokens=24, temperature=None)
        sent = calls[0]["body"]
        self.assertEqual(sent["max_tokens"], 24)
        self.assertNotIn("temperature", sent)

    def test_thinking_is_off_for_the_short_task_routes_unless_asked(self):
        # Qwen3-VL thinks by default: a 16-token title would be spent inside <think> with no
        # content at all.  The sidecar asks for no thinking unless the caller turns it on.
        s = small_of()
        calls = []
        with mock.patch("serve.small_model._post", capture_post(calls)):
            s.chat([{"role": "user", "content": "title this"}])
        kw = calls[0]["body"].get("chat_template_kwargs")
        self.assertIsInstance(kw, dict, "chat_template_kwargs is sent")
        self.assertIs(kw.get("enable_thinking"), False, "thinking defaults to off")

        calls2 = []
        with mock.patch("serve.small_model._post", capture_post(calls2)):
            s.chat([{"role": "user", "content": "think hard"}],
                   chat_template_kwargs={"enable_thinking": True})
        self.assertIs(calls2[0]["body"]["chat_template_kwargs"].get("enable_thinking"), True,
                      "an explicit on wins over the default")

    def test_an_http_error_raises_with_the_server_saying(self):
        s = small_of()
        def boom(url, req, timeout=None):
            raise urllib.error.HTTPError(url, 500, "Internal Server Error", {}, io.BytesIO(b'{"error": "oom"}'))
        with mock.patch("serve.small_model._post", boom):
            with self.assertRaisesRegex(SmallModel.ServingError, "oom"):
                s.chat([{"role": "user", "content": "x"}])


class DescribeImage(unittest.TestCase):
    def test_the_picture_goes_out_as_a_data_url_and_the_description_comes_back(self):
        s = small_of()
        calls = []
        png = base64.b64encode(b"PNG").decode()
        with mock.patch("serve.small_model._post", capture_post(calls)):
            out = s.describe_image(png)
        self.assertEqual(out, "OK")
        img = calls[0]["body"]["messages"][0]["content"][0]
        self.assertEqual(img["type"], "image_url")
        self.assertTrue(img["image_url"]["url"].startswith("data:image/png;base64,"))
        self.assertEqual(calls[0]["body"]["max_tokens"], SmallModel.DESCRIBE_MAX_TOKENS)

    def test_a_data_url_passes_through_unchanged(self):
        s = small_of()
        calls = []
        url = "data:image/jpeg;base64," + base64.b64encode(b"JPG").decode()
        with mock.patch("serve.small_model._post", capture_post(calls)):
            s.describe_image(url)
        self.assertEqual(calls[0]["body"]["messages"][0]["content"][0]["image_url"]["url"], url)

    def test_the_describe_prompt_is_not_the_user_s_own_text(self):
        # the gateway describes for another model; the caller's prompt must not leak into it
        s = small_of()
        calls = []
        with mock.patch("serve.small_model._post", capture_post(calls)):
            s.describe_image("data:image/png;base64,AAAA", prompt=None)
        text = calls[0]["body"]["messages"][0]["content"][1]["text"]
        self.assertTrue(text.strip(), "the describe prompt is present")
        self.assertNotIn("AAAA", text)


class IdleUnload(unittest.TestCase):
    def test_the_sidecar_unloads_after_its_idle_window(self):
        s = small_of(idle_unload_s=300)
        s._last_used = 1000.0
        started = []
        with mock.patch.object(SmallModel, "unload", side_effect=lambda: started.append(1)), \
             mock.patch.object(SmallModel, "alive", return_value=True):
            s.idle_tick(now=1299.0)
            self.assertEqual(started, [], "under the idle window it stays")
            s.idle_tick(now=1300.5)
            self.assertEqual(started, [1], "past the window it unloads")

    def test_tick_touches_the_clock_when_a_request_runs(self):
        s = small_of(idle_unload_s=300)
        s.touch(now=5000.0)
        with mock.patch.object(SmallModel, "alive", return_value=True), \
             mock.patch.object(SmallModel, "unload") as gone:
            s.idle_tick(now=5100.0)
            gone.assert_not_called()


class OffByDefault(unittest.TestCase):
    """Without a small_model config the server behaves exactly as before (the opt-in rule)."""

    def test_the_service_has_no_small_model_and_small_names_are_refused_with_a_hint(self):
        svc = server.Service.__new__(server.Service)
        svc.small = None
        svc.model = "m"
        req = {"model": "small", "messages": [{"role": "user", "content": "hi"}]}
        with self.assertRaisesRegex(ValueError, "small"):
            svc.small_proxy(req)

    def test_small_names(self):
        self.assertIn("small", SMALL_NAMES)
        self.assertIn("small-model", SMALL_NAMES)


class RouteSmall(unittest.TestCase):
    def _svc_with_fake_small(self):
        svc = server.Service.__new__(server.Service)
        fake = small_of(port=4301)
        fake.served = []

        def chat(messages, **fields):
            fake.served.append(messages)
            return "TITLE"
        fake.chat = chat
        fake.model_name = "small"
        svc.small = fake
        svc.model = "m"
        return svc, fake

    def test_a_small_request_goes_to_the_sidecar_and_not_the_main_engine(self):
        svc, fake = self._svc_with_fake_small()
        req = {"model": "small", "messages": [{"role": "user", "content": "summarize"}]}
        out = svc.small_proxy(req)
        self.assertEqual(fake.served, [[{"role": "user", "content": "summarize"}]],
                         "the sidecar got exactly the request's messages")
        self.assertIn("TITLE", json.dumps(out))

    def test_the_small_answer_is_shaped_like_openai_s_own(self):
        # the agent clients read choices[0].message.content; the proxy answers in the same shape
        svc, _ = self._svc_with_fake_small()
        out = svc.small_proxy({"model": "small", "messages": [{"role": "user", "content": "t"}]})
        self.assertEqual(out["choices"][0]["message"]["content"], "TITLE")
        self.assertEqual(out["model"], "small")


class VisionTextGateway(unittest.TestCase):
    """A main model with no vision tower and a small model configured: pictures become text."""

    def test_the_picture_is_replaced_by_the_sidecar_s_description(self):
        svc = server.Service.__new__(server.Service)
        fake = small_of()
        fake.chat = lambda messages, **k: "a screenshot of a settings page"
        fake.model_name = "small"
        svc.small = fake
        svc.vision = None
        url = "data:image/png;base64," + base64.b64encode(b"PNG").decode()
        messages = [{"role": "user", "content": [
            {"type": "text", "text": "what is this?"},
            {"type": "image_url", "image_url": {"url": url}},
        ]}]
        out = server.textualize_images(svc, messages)
        parts = out[0]["content"]
        self.assertNotIn({"type": "image_url"}, [p if isinstance(p, dict) else None for p in parts])
        joined = " ".join(p.get("text", "") for p in parts if isinstance(p, dict))
        self.assertIn("a screenshot of a settings page", joined)
        self.assertIn("what is this?", joined)

    def test_a_text_only_message_is_untouched(self):
        svc = server.Service.__new__(server.Service)
        fake = small_of()
        fake.chat = lambda messages, **k: (_ for _ in ()).throw(AssertionError("must not be called"))
        svc.small = fake
        svc.vision = None
        messages = [{"role": "user", "content": "plain text"}]
        self.assertEqual(server.textualize_images(svc, messages), messages)

    def test_without_a_small_model_the_refusal_is_the_old_one(self):
        svc = server.Service.__new__(server.Service)
        svc.small = None
        svc.vision = None
        messages = [{"role": "user", "content": [
            {"type": "text", "text": "hi"},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}},
        ]}]
        self.assertEqual(server.textualize_images(svc, messages), messages)


if __name__ == "__main__":
    unittest.main(verbosity=2)
