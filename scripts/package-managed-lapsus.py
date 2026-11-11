from pathlib import Path
import argparse
import shutil
import subprocess
import zipfile
import re

parser = argparse.ArgumentParser()
parser.add_argument('lapsus_source', type=Path)
args = parser.parse_args()
source = args.lapsus_source.resolve()
root = Path(__file__).resolve().parent.parent
target = root / 'public/integrations/lapsus-managed'
target.mkdir(parents=True, exist_ok=True)
preview = (root / 'public/managed-ent.html').read_text()
preview, count = re.subn(r'<script src="\.\./managed-ent\.js[^\"]*" defer></script>', '<script src="./preview.js?v=4.20.0" defer></script>', preview)
assert count == 1
preview = preview.replace('href="../', 'href="../../').replace('src="../', 'src="../../')
preview = preview.replace('<title>Connexion ENT · Lapsus</title>', '<title>Aperçu du connecteur ENT · Lapsus</title>')
preview = preview.replace('aria-busy="true"><p class="managed-ent-wait">Nous vérifions votre demande…</p>', '''aria-busy="false"><h2>Quel est votre lycée ?</h2><p>Recherchez votre établissement compatible avec l’ENT Auvergne-Rhône-Alpes.</p><div id="managed-school-form"><label for="managed-school-query">Nom du lycée ou ville<input id="managed-school-query" type="search" maxlength="100" placeholder="Nom du lycée ou ville" autocomplete="off"></label><button id="managed-preview-search" class="button" type="button">Rechercher</button></div><p id="managed-preview-status" role="status" hidden></p>''')
preview = preview.replace('Connexion réservée aux établissements compatibles de l’ENT Auvergne-Rhône-Alpes.', 'Les informations suivantes seront synchronisées avec votre compte Lapsus : cours et horaires, devoirs, contrôles, mails de l’ENT et actualités du lycée.')
preview = preview.replace('</main>', '<p class="managed-ent-preview-note">Aperçu visuel · aucune connexion ENT n’est lancée ici.</p></main>')
(target / 'preview.html').write_text(preview)
blocked = {'.git', 'node_modules', 'test-results', '__pycache__'}
files = [p for p in sorted(source.rglob('*')) if p.is_file() and not p.is_symlink()
         and not any(part in blocked or part.startswith('.env') for part in p.relative_to(source).parts)
         and p.suffix not in {'.log', '.key', '.pyc'}]
allowed = ['README.md', 'app.js', 'index.html', 'style.css', 'logo.svg', 'passerelle-ent.js', '_routes.json', '_redirects', 'functions', 'docs', 'tests']
untracked = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard'], cwd=source, text=True).splitlines()
intent = [name for name in untracked if name.split('/')[0] in allowed]
if intent:
    subprocess.run(['git', 'add', '-N', '--', *intent], cwd=source, check=True)
patch = subprocess.check_output(['git', 'diff', '--binary', 'HEAD', '--', *allowed], cwd=source)
assert patch and b'PASSERELLE_MANAGED_KEY' in patch
(target / 'lapsus-passerelle-ent.patch').write_bytes(patch)
shutil.copy2(source / 'docs/PASSERELLE_ENT.md', target / 'GUIDE.md')
with zipfile.ZipFile(target / 'lapsus-passerelle-ent.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for file in files:
        archive.write(file, 'mon-ent/' + str(file.relative_to(source)))
with zipfile.ZipFile(target / 'lapsus-passerelle-ent.zip') as archive:
    assert archive.testzip() is None
    assert 'mon-ent/functions/api/passerelle/[[path]].js' in archive.namelist()
    assert not any(any(part in blocked or part.startswith('.env') for part in Path(name).parts) for name in archive.namelist())
print(f'Lapsus source ZIP: {len(files)} files; patch: {len(patch)} bytes; no private files')
