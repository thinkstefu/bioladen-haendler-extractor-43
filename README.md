# Bioladen.de – Großstadt-PLZ (v6.2)

**Fix:** Alle HTTP/HTTPS-Prüfungen ohne Regex (nur `.startsWith('http://')` / `.startsWith('https://')`).  
**Features:** migrationssicherer Fortschritt (KV), globale Dedup-Keys, `tel:`/`mailto:`/externer Link, iFrame-Suche, Debug-Artefakte.

## Nutzung
- Radius: 25 km (default)
- PLZ-Liste: `./data/plz_cities.txt` oder KV-Store (`useKvPlz=true` → Key `plz_cities.txt`)
- Empfohlen: MaxConcurrency=1, Memory=1024 MB

