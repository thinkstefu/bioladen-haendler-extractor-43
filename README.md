# Bioladen.de – Großstadt-PLZ (v6)

**Was ist neu (gegenüber v5):**
- **Migrationssicherer Fortschritt** (`state.json` im KV-Store, `persistState` / `migrating`)
- **Globale Dedup im KV-Store**: `seen:<hash(detailUrl)>` → keine Duplikate nach SIGTERM/Migration
- **Präzise Detail-Extraktion**: Telefon nur via `tel:`, E-Mail via `mailto:`, Website = erster externer Link (kein `bioladen.de`, kein Social)
- **Ankermuster**: `a[href*="tx_biohandel_plg"][href*="[betrieb]"]` (Hauptseite + iFrames)
- **Debug bei 0 Treffern**: `debug_<PLZ>.png` + HTML im KV-Store

## Nutzung
- Default: Radius **25 km**, PLZ aus `./data/plz_cities.txt` (editierbar)
- Build-Image: `apify/actor-node-playwright:20` (inkl. `npx playwright install --with-deps`)
- Empfohlen: **MaxConcurrency = 1**, **Memory = 1024 MB** (bereits im Actor gesetzt)

## Output-Schema (Dataset)
```json5
{
  "name": "...",
  "street": "...",
  "zip": "12345",
  "city": "...",
  "country": "DE",
  "phone": "+49...",
  "email": "info@...",
  "website": "https://...",
  "openingHours": "...",   // best effort
  "detailUrl": "https://www.bioladen.de/...",
  "source": "bioladen.de",
  "scrapedAt": "2025-09-25T...Z",
  "category": "Bioladen|Marktstand|Lieferservice|null"
}
```
