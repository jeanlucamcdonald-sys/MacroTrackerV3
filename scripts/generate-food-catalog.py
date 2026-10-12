"""Rebuild the checked-in archived USDA catalog from a pinned, checksum-verified source."""
import hashlib
import json
from pathlib import Path
import urllib.request

root = Path(__file__).resolve().parent.parent
metadata = json.loads((root / 'data/catalog-source.json').read_text())
with urllib.request.urlopen(metadata['source'], timeout=60) as response:
    raw = response.read()
if hashlib.sha256(raw).hexdigest() != metadata['sourceSHA256']:
    raise RuntimeError('Pinned source checksum mismatch; catalog left unchanged')
foods = []
for row in json.loads(raw):
    def nutrient(description, unit):
        return next(item['value'] for item in row['nutrients'] if item['description'] == description and item['units'] == unit)
    foods.append({
        'id': 'sr_' + str(row['id']), 'name': row['description'], 'category': row['group'], 'serving': 100, 'unit': 'g',
        'cal': nutrient('Energy', 'kcal'), 'p': nutrient('Protein', 'g'),
        'c': nutrient('Carbohydrate, by difference', 'g'), 'f': nutrient('Total lipid (fat)', 'g')
    })
if len(foods) != metadata['records']:
    raise RuntimeError('Unexpected record count; catalog left unchanged')
(root / 'data/foods.json').write_text(json.dumps(foods, separators=(',', ':')) + '\n')
print(f'Generated {len(foods)} archived USDA reference foods')
