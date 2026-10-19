import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class SetupTests(unittest.TestCase):
    def test_symlinked_python_creates_a_working_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = root / 'bin' / 'python'
            binary.parent.mkdir()
            binary.symlink_to(Path(sys.executable).resolve())
            target = root / 'venv'
            code = 'from pathlib import Path; import setup; setup.create_environment(Path(%r))' % str(target)
            result = subprocess.run([str(binary), '-c', code], cwd=Path(__file__).parent, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            marker = target / 'preserved-package-marker'
            marker.write_text('keep existing environment contents')
            result = subprocess.run([str(binary), '-c', code], cwd=Path(__file__).parent, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(marker.exists())
            result = subprocess.run([str(target / 'bin/python'), '-c', 'import encodings,json,sys; print(json.dumps({"venv":sys.prefix!=sys.base_prefix}))'], capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(json.loads(result.stdout)['venv'])


if __name__ == '__main__':
    unittest.main()
