import unittest

from apps.api.app.main import app


class ApplicationImportTests(unittest.TestCase):
    def test_production_application_imports(self):
        self.assertEqual(app.title, "FanPulse API")


if __name__ == "__main__":
    unittest.main()
