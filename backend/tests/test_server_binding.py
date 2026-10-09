import os
import unittest
from unittest.mock import patch
from app.config import _resolve_server_binding

class TestServerBinding(unittest.TestCase):
    def test_default_binding_is_all_interfaces(self):
        with patch.dict(os.environ, {}, clear=True):
            host, port, ssl_port = _resolve_server_binding()
            self.assertEqual(host, "0.0.0.0")
            self.assertEqual(port, 8000)
            self.assertEqual(ssl_port, 8443)

    def test_host_env_var(self):
        with patch.dict(os.environ, {"HOST": "127.0.0.1", "PORT": "8080"}, clear=True):
            host, port, _ = _resolve_server_binding()
            self.assertEqual(host, "127.0.0.1")
            self.assertEqual(port, 8080)

    def test_listen_with_host_and_port(self):
        with patch.dict(os.environ, {"LISTEN": "0.0.0.0:9000"}, clear=True):
            host, port, _ = _resolve_server_binding()
            self.assertEqual(host, "0.0.0.0")
            self.assertEqual(port, 9000)

    def test_listen_host_only(self):
        with patch.dict(os.environ, {"LISTEN": "192.168.1.50"}, clear=True):
            host, port, _ = _resolve_server_binding()
            self.assertEqual(host, "192.168.1.50")
            self.assertEqual(port, 8000)

    def test_listen_port_only(self):
        with patch.dict(os.environ, {"LISTEN": ":7000"}, clear=True):
            host, port, _ = _resolve_server_binding()
            self.assertEqual(host, "0.0.0.0")
            self.assertEqual(port, 7000)

    def test_server_host_and_bind_fallbacks(self):
        with patch.dict(os.environ, {"SERVER_HOST": "0.0.0.0", "SERVER_PORT": "5000"}, clear=True):
            host, port, _ = _resolve_server_binding()
            self.assertEqual(host, "0.0.0.0")
            self.assertEqual(port, 5000)

        with patch.dict(os.environ, {"BIND": "10.0.0.1:8000"}, clear=True):
            host, port, _ = _resolve_server_binding()
            self.assertEqual(host, "10.0.0.1")
            self.assertEqual(port, 8000)

    def test_frontend_static_and_health_endpoints(self):
        from fastapi.testclient import TestClient
        from app.main import app
        client = TestClient(app)

        res_health = client.get("/api/health")
        self.assertEqual(res_health.status_code, 200)
        self.assertEqual(res_health.json(), {"status": "ok", "app": "Lunabria"})

        res_sw = client.get("/sw.js")
        self.assertEqual(res_sw.status_code, 200)
        self.assertTrue(res_sw.headers.get("content-type", "").startswith(("text/javascript", "application/javascript")))

        res_root = client.get("/")
        self.assertEqual(res_root.status_code, 200)
        self.assertTrue(res_root.headers.get("content-type", "").startswith("text/html"))

if __name__ == "__main__":
    unittest.main()
