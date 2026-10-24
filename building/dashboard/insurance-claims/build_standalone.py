"""Rebuild the portable HTML from the website and its Java-generated JSON."""
from pathlib import Path
import re
from urllib.parse import urljoin

root = Path(__file__).resolve().parents[4]
page_dir = root / "building"
page = (page_dir / "insurance-claims-dashboard.html").read_text()
page = page.replace('<script src="../theme-init.js"></script>', '<script>' + (root / "theme-init.js").read_text() + '</script>')
for name in ("../styles.css", "dashboard/insurance-claims/claims-dashboard.css"):
    page = page.replace(f'<link rel="stylesheet" href="{name}">', '<style>\n' + (page_dir / name).read_text() + '\n</style>')
scripts = []
for name in ("../script.js?v=theme-sync-2", "dashboard/insurance-claims/claims-dashboard.js"):
    page = page.replace(f'<script src="{name}" defer></script>', '')
    scripts.append('<script>\n' + (page_dir / name.split('?', 1)[0]).read_text() + '\n</script>')
data = (page_dir / "dashboard/insurance-claims/claims-data.json").read_text().replace('<', '\\u003c')
embedded = '<script type="application/json" id="claims-inline-data">' + data + '</script>'
page = page.replace('</body>', embedded + '\n' + '\n'.join(scripts) + '\n</body>')
page = re.sub(r'href="(?!https?:|#)([^"]+)"', lambda m: 'href="' + urljoin('https://worleyek.github.io/building/', m.group(1)) + '"', page)
output = page_dir / "insurance-claims-standalone.html"
output.write_text(page)
print(f"Portable HTML rebuilt: {output.name} ({output.stat().st_size:,} bytes)")
