"""Package public Passerelle artwork; never reads account data or credentials."""
from pathlib import Path
import json
import zipfile

project = Path(__file__).resolve().parents[1]
public = project / 'public'
brand = public / 'brand'
campaign = brand / 'campaign'
icons = brand / 'icons-v2'


def files_under(directory):
    return [p for p in directory.rglob('*') if p.is_file() and p.suffix != '.zip']


def package(destination, files, description):
    selected = sorted(set(files))
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as archive:
        for source in selected:
            archive.write(source, str(source.relative_to(public)))
        archive.write(project / 'LICENSE', 'LICENSE')
        archive.writestr('LIRE-MOI.txt', description + '\n\n'
            'Conserver les dossiers pour ouvrir les SVG liés. Les PNG sont autonomes.\n'
            'Installer Manrope si votre logiciel ne lit pas les polices web des SVG.\n'
            'Aucune publication sur les réseaux sociaux n’a été effectuée.\n'
            'Les générateurs sont dans les sources complètes du projet, dossier scripts/.\n')
    with zipfile.ZipFile(destination) as archive:
        assert archive.testzip() is None
        assert not any('/data/' in name or name.startswith(('/', '../')) for name in archive.namelist())
    return {'file': str(destination.relative_to(public)), 'entries': len(selected) + 2, 'bytes': destination.stat().st_size}


shared = files_under(public / 'fonts') + [public / 'fonts.css', brand / 'symbol.png']
reports = [package(campaign / 'passerelle-social-pack.zip', files_under(campaign) + shared,
                   'Passerelle · Réseaux sociaux · 4.16.0\n24 PNG, 24 sources SVG, légendes et textes alternatifs.'),
           package(icons / 'passerelle-icons.zip', files_under(icons) + shared,
                   'Passerelle · Repères · 4.16.0\n56 icônes SVG originales, sprite, manifeste et galerie.')]
reports.append(package(brand / 'passerelle-creative-kit.zip', files_under(brand) + files_under(public / 'icons') +
                       [public / 'apple-touch-icon.png'] + shared,
                       'Passerelle · Le pack créatif complet · 4.16.0\n'
                       'Bannières, 24 visuels sociaux et leurs sources, 56 icônes, logos, palette, guide et police.'))
print(json.dumps({'version': '4.16.0', 'archives': reports}, ensure_ascii=False))
