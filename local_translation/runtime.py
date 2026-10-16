"""CPU-only, offline IndicTrans2 service. No transcript text leaves this process."""
import gc
import json
import os
from pathlib import Path
import re
import socket
import socketserver
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data/local-translation'
MODELS = json.loads((ROOT / 'local_translation/models.json').read_text())
VERSION = 'local-1'
class TranslationError(ValueError):
    pass


NUMBERS = re.compile(r'[+\-−]?\d+(?:[.,]\d+)*(?:[%٪])?')


def split_text(text, fits):
    """Keep every character; prefer sentence/word boundaries, then bisect."""
    if fits(text):
        return [text]
    if len(text) < 2:
        raise TranslationError('Source cannot fit the tokenizer limit')
    middle = len(text) // 2
    boundaries = [m.end() for m in re.finditer(r'[.!?।۔\n]\s*|\s+', text)
                  if len(text) // 4 <= m.end() <= 3 * len(text) // 4]
    cut = min(boundaries, key=lambda n: abs(n - middle)) if boundaries else middle
    return split_text(text[:cut], fits) + split_text(text[cut:], fits)


def validate(source, output):
    if not output.strip() or len(output) > max(2048, len(source) * 12):
        raise TranslationError('Empty or oversized translation')
    if sorted(NUMBERS.findall(source)) != sorted(NUMBERS.findall(output)):
        raise TranslationError('Translation changed numerical notation; original retained')


class Translator:
    def __init__(self):
        # Force offline even if the caller has a network connection or credentials.
        os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1',
                          HF_HUB_DISABLE_TELEMETRY='1', HF_HOME=str(DATA / 'hf'),
                          HF_MODULES_CACHE=str(DATA / 'modules'), TOKENIZERS_PARALLELISM='false',
                          OMP_NUM_THREADS='2', MKL_NUM_THREADS='2')
        def blocked(*args, **kwargs):
            raise OSError('External networking disabled in local translation runtime')
        socket.socket.connect = blocked
        import torch
        torch.set_num_threads(2)
        torch.set_num_interop_threads(1)
        self.torch = torch
        self.loaded = None
        self.model = self.tokenizer = None
        from IndicTransToolkit.processor import IndicProcessor
        self.processor = IndicProcessor(inference=True)

    def translate(self, source, target, blocks):
        langs = {'hi': 'hin_Deva', 'ur': 'urd_Arab', 'en': 'eng_Latn', 'pa': 'pan_Guru'}
        if source not in langs or target not in ('en', 'ur'):
            raise TranslationError('Unsupported source language/script')
        if source == target:
            return [{'id': b['id'], 'text': b['text']} for b in blocks]
        direction = 'en-indic' if source == 'en' else 'indic-en' if target == 'en' else 'indic-indic'
        if self.loaded != direction:
            from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
            self.model = self.tokenizer = None
            gc.collect()
            path = str(DATA / 'models' / direction)
            self.tokenizer = AutoTokenizer.from_pretrained(path, trust_remote_code=True, local_files_only=True)
            self.model = AutoModelForSeq2SeqLM.from_pretrained(
                path, trust_remote_code=True, local_files_only=True,
                torch_dtype=self.torch.float32, attn_implementation='eager').eval()
            self.loaded = direction
        out = []
        for block in blocks:
            def prepared(text):
                return self.processor.preprocess_batch([text], src_lang=langs[source], tgt_lang=langs[target])
            def fits(text):
                return len(self.tokenizer(prepared(text), truncation=False)['input_ids'][0]) <= 200
            pieces = split_text(block['text'], fits)
            translated = []
            for piece in pieces:
                inputs = self.tokenizer(prepared(piece), padding=True, truncation=False, return_tensors='pt')
                with self.torch.inference_mode():
                    result = self.model.generate(**inputs, num_beams=4, max_new_tokens=256, do_sample=False)
                eos = self.model.generation_config.eos_token_id
                eos = eos if isinstance(eos, list) else [eos]
                # EOS at the beginning is a decoder start token, not proof of completion.
                if int(result[0][-1]) not in eos:
                    raise TranslationError('Translation output truncated; original retained')
                decoded = self.tokenizer.batch_decode(result, skip_special_tokens=True)
                text = self.processor.postprocess_batch(decoded, lang=langs[target])[0]
                validate(piece, text)
                translated.append(text)
            text = ' '.join(translated)
            validate(block['text'], text)
            out.append({'id': block['id'], 'text': text})
        return out


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        try:
            raw = self.rfile.readline(1048577)
            if len(raw) > 1048576:
                raise TranslationError('Request too large')
            p = json.loads(raw)
            if p.get('deadline', 0) < time.time() * 1000:
                raise TranslationError('Local request expired while the runtime was busy; retry when ready')
            if p.get('operation') == 'reset':
                self.server.translator.model = self.server.translator.tokenizer = None
                self.server.translator.loaded = None
                gc.collect()
                response = {'ready': True}
            elif p.get('operation') == 'status':
                response = {'ready': True, 'version': VERSION}
            else:
                blocks = p['blocks']
                if not isinstance(blocks, list) or not 1 <= len(blocks) <= 20:
                    raise TranslationError('Invalid translation batch')
                if any(not isinstance(b['id'], int) or not isinstance(b['text'], str) or not b['text'].strip() for b in blocks):
                    raise TranslationError('Invalid translation block')
                if sum(len(b['text'].encode()) for b in blocks) > 524288:
                    raise TranslationError('Source batch too large')
                start = time.monotonic()
                response = {'blocks': self.server.translator.translate(p['source'], p['target'], blocks),
                            'seconds': time.monotonic() - start,
                            'peakRssMiB': __import__('resource').getrusage(__import__('resource').RUSAGE_SELF).ru_maxrss / 1024}
            self.wfile.write((json.dumps(response, ensure_ascii=False) + '\n').encode())
        except Exception as e:
            # Exceptions from third-party code can contain source text or local credentials.
            message = str(e) if isinstance(e, TranslationError) else 'Local model failed; check installation and model access'
            self.wfile.write((json.dumps({'error': message}) + '\n').encode())


def serve():
    DATA.mkdir(parents=True, exist_ok=True)
    import fcntl
    lock = (DATA / 'runtime.lock').open('w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    path = DATA / 'runtime.sock'
    path.unlink(missing_ok=True)
    translator = Translator()
    with socketserver.UnixStreamServer(str(path), Handler) as server:
        os.chmod(path, 0o600)
        server.translator = translator
        server.serve_forever()


if __name__ == '__main__':
    serve()
