import os
import unittest
from pathlib import Path
from unittest.mock import patch

from run import find_openssl


class TestOpenSSLDiscovery(unittest.TestCase):
    def test_prefers_openssl_from_path(self):
        openssl_path = r"C:\Git\usr\bin\openssl.exe"
        with patch("run.shutil.which", return_value=openssl_path):
            self.assertEqual(find_openssl(), openssl_path)

    def test_finds_openssl_in_local_git_installation_on_windows(self):
        local_app_data = Path(r"C:\Users\reader\AppData\Local")
        expected_path = local_app_data / "Programs" / "Git" / "usr" / "bin" / "openssl.exe"
        env = {
            "LOCALAPPDATA": str(local_app_data),
            "ProgramFiles": r"C:\Program Files",
            "ProgramFiles(x86)": r"C:\Program Files (x86)",
        }

        def is_installed(path):
            return path == expected_path

        with (
            patch("run.shutil.which", return_value=None),
            patch("run.sys.platform", "win32"),
            patch.dict(os.environ, env, clear=True),
            patch.object(Path, "is_file", autospec=True, side_effect=is_installed),
        ):
            self.assertEqual(find_openssl(), str(expected_path))

    def test_falls_back_to_openssl_command_outside_windows(self):
        with (
            patch("run.shutil.which", return_value=None),
            patch("run.sys.platform", "linux"),
        ):
            self.assertEqual(find_openssl(), "openssl")


if __name__ == "__main__":
    unittest.main()
