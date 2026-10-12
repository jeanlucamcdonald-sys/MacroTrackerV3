"""Install Google's official emulator when the Firebase CLI download is unavailable."""
import hashlib
import json
from pathlib import Path
import tarfile
import urllib.request

BASE = 'https://dl.google.com/dl/cloudsdk/channels/rapid/'
root = Path('/tmp/macrotracker-firestore-official')
root.mkdir(exist_ok=True)
with urllib.request.urlopen(BASE + 'components-2.json', timeout=30) as response:
    component = next(item for item in json.load(response)['components'] if item['id'] == 'cloud-firestore-emulator')
archive = root / 'emulator.tar.gz'
with urllib.request.urlopen(BASE + component['data']['source'], timeout=60) as response, archive.open('wb') as output:
    while chunk := response.read(1024 * 1024):
        output.write(chunk)
if hashlib.sha256(archive.read_bytes()).hexdigest() != component['data']['checksum']:
    raise RuntimeError('Official emulator checksum failed')
with tarfile.open(archive) as package:
    package.extractall(root, filter='data')
print('Verified Google Cloud Firestore emulator ' + component['version']['version_string'])
print(root / 'platform/cloud-firestore-emulator/cloud_firestore_emulator')
