import unittest
from unittest.mock import patch
import runpy
import re
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from contextlib import nullcontext
from types import SimpleNamespace
from runtime import split_text, validate, Translator
import runtime


class RuntimeTests(unittest.TestCase):
    def test_dependency_pins_are_checked_before_model_loading(self):
        pins = dict(line.split('==') for line in (runtime.ROOT / 'local_translation/requirements.txt').read_text().splitlines() if '==' in line)
        with patch('runtime.package_version', side_effect=pins.__getitem__):
            runtime.check_dependencies()
        for installed in ['0.2.0', None]:
            def version(name):
                if name == 'sentencepiece':
                    if installed is None:
                        raise runtime.PackageNotFoundError(name)
                    return installed
                return pins[name]
            with self.subTest(installed=installed), patch('runtime.package_version', side_effect=version):
                with self.assertRaisesRegex(runtime.TranslationError, 'Rerun local_translation/setup.py'):
                    runtime.check_dependencies()

    def test_revision_matches_node_and_changes_with_dependency_pins(self):
        node = subprocess.run(['node', '--import', 'tsx', '-e', 'import("./lib/local-runtime.ts").then(m => process.stdout.write(m.LOCAL_REVISION))'], cwd=runtime.ROOT, check=True, capture_output=True, text=True, timeout=20)
        self.assertEqual(runtime.REVISION, node.stdout)
        with tempfile.TemporaryDirectory() as directory:
            local = Path(directory) / 'local_translation'
            local.mkdir()
            for name in ['runtime.py', 'models.json', 'requirements.txt']:
                (local / name).write_bytes((runtime.ROOT / 'local_translation' / name).read_bytes())
            requirements = local / 'requirements.txt'
            requirements.write_bytes(requirements.read_bytes().replace(b'sentencepiece==0.2.1', b'sentencepiece==0.2.0'))
            changed = runpy.run_path(str(local / 'runtime.py'))
            self.assertNotEqual(runtime.REVISION, changed['REVISION'])

    def test_busy_runtime_heartbeats_and_cleans_up_after_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            code = "import runtime,time; from pathlib import Path; from types import SimpleNamespace; runtime.DATA=Path(%r); runtime.Translator=lambda:SimpleNamespace(translate=lambda *args:(time.sleep(8) or [])); runtime.serve()" % directory
            child = subprocess.Popen([sys.executable, '-c', code], cwd=Path(__file__).parent)
            path = Path(directory) / 'runtime.json'
            client = socket.socket(socket.AF_UNIX)
            try:
                deadline = time.monotonic() + 10
                while not path.exists() and time.monotonic() < deadline:
                    time.sleep(.05)
                initial = json.loads(path.read_text())
                client.connect(str(Path(directory) / 'runtime.sock'))
                client.sendall((json.dumps({'deadline': time.time() * 1000 + 20000, 'source': 'hi', 'target': 'en', 'blocks': [{'id': 1, 'text': 'caption'}]}) + '\n').encode())
                time.sleep(5.2)
                current = json.loads(path.read_text())
                self.assertEqual(current['pid'], child.pid)
                self.assertEqual(current['owner'], initial['owner'])
                self.assertGreater(current['heartbeat'], initial['heartbeat'])
            finally:
                child.terminate()
                child.wait(timeout=10)
                client.close()
            self.assertFalse(path.exists())
            self.assertFalse((Path(directory) / 'runtime.sock').exists())
    def test_length_probes_do_not_pollute_placeholder_restoration(self):
        class Processor:
            def __init__(self, **kwargs):
                self.maps = []
            def preprocess_batch(self, texts, **kwargs):
                mapping = {}
                def wrap(m):
                    key = '<ID%d>' % (len(mapping) + 1)
                    mapping[key] = m[0]
                    return key
                text = re.sub(r'[\w.]+@[\w.]+', wrap, texts[0])
                text = re.sub(r'\d+\.\d+', wrap, text)
                self.maps.append(mapping)
                return [text]
            def postprocess_batch(self, texts, **kwargs):
                mapping = self.maps.pop(0)
                self.maps.clear()
                text = texts[0]
                for key, value in mapping.items():
                    text = text.replace(key, value)
                return [text]
        class Tokenizer:
            def __call__(self, texts, **kwargs):
                return {'input_ids': [list(texts[0])], 'text': texts[0]}
            def batch_decode(self, result, **kwargs):
                return [result[0][0]]
        t = Translator.__new__(Translator)
        t.processor = Processor()
        t.processor_factory = Processor
        t.loaded = 'indic-en'
        t.tokenizer = Tokenizer()
        t.torch = SimpleNamespace(inference_mode=nullcontext)
        t.model = SimpleNamespace(generation_config=SimpleNamespace(eos_token_id=2), generate=lambda **kw: [[kw['text'], 2]])
        source = 'Price 100.50. ' + 'caption words ' * 45 + 'help@example.com'
        result = t.translate('hi', 'en', [{'id': 1, 'text': source}])[0]['text']
        self.assertIn('100.50', result)
        self.assertEqual(result.count('help@example.com'), 1)
        self.assertEqual(result.split(), source.split())
    def test_no_source_loss(self):
        text = 'اگر قیمت 100 ہو۔ Do not buy 200. ' * 100
        pieces = split_text(text, lambda t: len(t) <= 40)
        self.assertEqual(''.join(pieces), text)
        self.assertTrue(all(len(p) <= 40 for p in pieces))

    def test_numbers(self):
        validate('قیمت 1,200.50 اور 10%', 'Price 1,200.50 and 10%')
        for out in ['Price 1200.50 and 10%', 'Price 1,200.50', '', 'Price 1,200.50 and 20%']:
            with self.assertRaises(ValueError):
                validate('قیمت 1,200.50 اور 10%', out)


if __name__ == '__main__':
    unittest.main()
