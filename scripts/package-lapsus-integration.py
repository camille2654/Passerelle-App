from pathlib import Path
import shutil
import zipfile

root = Path(__file__).resolve().parent.parent
folder = root / 'public/integrations/lapsus'
shutil.copy2(root / 'docs/LAPSUS_INTEGRATION.md', folder / 'GUIDE.md')
files = ['GUIDE.md', 'passerelle-connect.js', 'callback.html', 'callback.js', 'lapsus-adapter.example.js', '_redirects.example']
target = folder / 'passerelle-lapsus-integration.zip'
with zipfile.ZipFile(target.with_suffix('.tmp'), 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(folder / name, name)
target.with_suffix('.tmp').replace(target)
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None
    assert sorted(archive.namelist()) == sorted(files)
print(f'Integration kit: {len(files)} files, {target.stat().st_size} bytes')
