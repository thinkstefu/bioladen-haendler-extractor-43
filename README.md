# Bioladen.de – Großstadt-PLZ (v6.3)

**Fix:** KV-Keys dürfen nur `[a-zA-Z0-9!-_.'()]` enthalten (kein `:`). v6.3 ersetzt unerlaubte Zeichen automatisch und nutzt default `seen_` statt `seen:`.

**Weitere Punkte** wie in v6.2:
- Migration-sicherer Fortschritt (`state.json`), globale Dedup-Keys
- HTTP/HTTPS-Prüfungen ohne Regex (nur `.startsWith`)
- Externe Website-Erkennung (keine Socials, kein `bioladen.de`)
- `tel:` → E.164 (+49…), `mailto:`
- iFrame-Suche für Detail-Links
- Debug-Artefakte: `debug_<PLZ>.png` + HTML im KV

## Nutzung
- Radius: 25 km (default)
- PLZ-Liste: `./data/plz_cities.txt` oder KV-Store (`useKvPlz=true` → Key `plz_cities.txt`)

