"""Run with python3.11. Downloads only the pinned official models after access approval."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import venv
ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data/local-translation'


def main():
    if sys.version_info[:2] != (3, 11):
        raise SystemExit('Use Python 3.11 for the pinned CPU runtime.')
    if shutil.disk_usage(ROOT).free < 8 * 1024**3:
        raise SystemExit('Local setup needs at least 8 GiB free disk for CPU packages, weights and setup headroom. No files were removed.')
    DATA.mkdir(parents=True, exist_ok=True)
    python = DATA / 'venv/bin/python'
    if not python.exists():
        venv.create(DATA / 'venv', with_pip=True)
    subprocess.run([str(python), '-m', 'pip', 'install', '--no-cache-dir', '-r', str(ROOT / 'local_translation/requirements.txt')], check=True)
    script = '''import json,os
from pathlib import Path
from huggingface_hub import snapshot_download
root=Path.cwd()
for direction,model in json.loads((root/'local_translation/models.json').read_text()).items():
 snapshot_download(model['id'],revision=model['revision'],local_dir=root/'data/local-translation/models'/direction,token=os.getenv('HF_TOKEN'),allow_patterns=['*.json','*.py','*.model','*.safetensors','*.bin','*.txt'])
'''
    try:
        subprocess.run([str(python), '-c', script], cwd=ROOT, check=True)
    except subprocess.CalledProcessError:
        raise SystemExit('Model setup incomplete. Accept the official model access conditions yourself, then configure HF_TOKEN locally and rerun. Never paste the token in chat.')
    (DATA / 'installed.json').write_text((ROOT / 'local_translation/models.json').read_text())
    print('Installed pinned models. Start data/local-translation/venv/bin/python local_translation/runtime.py. Quality and capacity remain unvalidated.')


if __name__ == '__main__':
    main()
