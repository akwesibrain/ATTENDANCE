# Ghana Business Directory: developer notes

**Project:** Workforce Pro (Box For Less, Double A)
**Status:** module 1 of 5 done (data pipeline and import report). Registration
search, the HR directory screens and the backend specification follow.

## Decisions (12 November 2026)

| Topic | Decision |
|---|---|
| Geofence | **Distance only, HR decides** (the 11 November rule stays). Each place stores a radius, default 100 m, range 20 to 1,000 m, editable by admins, used for visit proof and display. Attendance does not pass or fail on it. |
| Data model | **Extend the existing `shops` system.** A shared `businesses` table, plus region, category, verification status, OSM source and flags on shops. Field staff keep 1 to 7 shops. No second location table. |
| Regions | Point-in-polygon against geoBoundaries Ghana ADM1 (16 regions). |
| Backend | The frontend team writes a specification and draft SQL in `docs/`. The backend developer owns `supabase/`. |
| "Company" | The employer (Box For Less or Double A). Directory businesses are the shops and malls where field staff work. |

## Files

| Path | What |
|---|---|
| `data/imports/export__1_.geojson` | The Overpass export, unchanged (byte-identical copy of `docs/location.json`). Never edited. |
| `data/boundaries/geoBoundaries-GHA-ADM1.geojson` | The 16 region polygons (geoBoundaries gbOpen, build Dec 2023, boundaries 2021). |
| `src/services/directory/regions.js` | The 16 official names and `assignRegion()` (point-in-polygon, near-boundary check). |
| `src/services/directory/osmImport.js` | Parse, validate, classify, deduplicate, stage, `mergeImport()` (idempotent re-import), report. Pure functions with no browser or Node APIs, so the backend can reuse them. |
| `scripts/build-business-directory.mjs` | Dry run. Writes `data/directory/business-directory-import.json` and `data/directory/import-report.md`. |
| `tests/business-directory.test.js` | Unit tests plus checks against the real export. |

Run:

```bash
node scripts/build-business-directory.mjs
npx vitest run tests/business-directory.test.js
```

## Pipeline rules

1. **Coordinates** are GeoJSON `[longitude, latitude]`.
   - Null, non-numeric, (0, 0) or out-of-range coordinates go to the error list and are not imported.
   - A point outside the padded Ghana box (latitude 4.5 to 11.5, longitude -3.5 to 1.5) is flagged `outside_ghana`. If swapping latitude and longitude would put it inside, it is flagged `possible_swap`.
   - Fewer than 4 decimal places is flagged `low_precision`.
   - OSM ways and relations (`@geometry: center`) are flagged `centroid_coordinate`, because the point is the centre of a building, not its entrance.
2. **Categories** come from tags first, then name checks:
   - `shop=mall` becomes `shopping_mall`, but only as a candidate. Every mall goes to review.
   - `shop=supermarket`, `department_store`, `clothes`, `electronics`, `furniture`, `chemist` and `amenity=pharmacy` become `retail_shop`.
   - `shop=convenience`, and `shop=general` with a name, become `mini_market`.
   - `amenity=marketplace` is never a mini-market. It is excluded and kept.
   - A name that disagrees with the tag is flagged `category_conflict`. A fuel-station shop is flagged `fuel_station_shop`.
3. **Names.** Unnamed records are excluded and kept. Generic names ("Store", "Select", "Shopping Mall") are flagged `name_generic`. `branch_name` is filled only from the OSM `branch` tag, never from the address.
4. **Regions** come from point-in-polygon only, never from the name.
   - A point within 200 m of another region's border gets `near_boundary`.
   - A point inside no polygon gets `no_region_match` and no region.
   - Without a boundary file, every point gets `region_unresolved`.
5. **Duplicates** are flagged, never merged. The rules, in order:
   - identical coordinates (6 decimals);
   - the same normalised name within 150 m;
   - a similar name (score of 0.8 or more) within 50 m;
   - the same brand wikidata within 100 m;
   - the same category within 25 m.
6. **Status.** An import never sets `verified`. Any flag other than `centroid_coordinate`, `low_precision` or `no_branch_tag` gives `needs_review`; otherwise the record is `pending`.
7. **Re-import** matches on `(source, source_id)`:
   - New ids are inserted.
   - Fields an admin edited (`adminEditedFields`) are never overwritten.
   - If the source moves or renames a verified place, it goes back to `needs_review`.
   - Rejected OSM ids are passed as a blocklist and stay out.
8. **Businesses** are a suggested grouping (by brand wikidata, otherwise by normalised name). A group with more than one location is marked `groupingNeedsApproval` and stays a suggestion until an admin confirms it.

## Results from the 12 November export

See `data/directory/import-report.md`. In short:

- 2,072 rows read, 0 errors, 1,377 excluded and kept (1,001 unnamed, 376 traditional markets), 695 locations staged.
- **0 verified.** 541 pending, 154 needs review.
- Shopping malls 38 (target 100, **62 short**), retail shops 292, mini-markets 365.
- All 695 staged locations are inside a region polygon, and none is within 200 m of a border. All 16 regions have at least 2 records; Greater Accra has 375 (54%).
- 41 duplicate candidate pairs are flagged for review.
- Clothing, electronics and furniture shops are not in this export; they need a second Overpass query.

## OpenStreetMap licence and attribution

- The place data is **© OpenStreetMap contributors**, available under the **Open Database Licence (ODbL) 1.0** (<https://www.openstreetmap.org/copyright>).
- The region boundaries are geoBoundaries, derived from OpenStreetMap. They are listed as CC BY-SA 2.0 and are OSM-derived, so they carry the same credit.
- Show "© OpenStreetMap contributors" wherever directory data is shown: the registration search, the HR directory, and exports.
- Keep `source`, `source_id` and the original `source_tags` on every record, so each one can be traced back to its OSM object.
- ODbL obligations:
  - **Attribution.**
  - **Share-alike:** if a *derived database* is published or given to people outside the company, it must be offered under ODbL.
  - **Keep it open:** no technical restrictions on the shared database.

  Internal use by the company's own staff is generally not "public use". Get legal advice before publishing, selling or sharing the directory outside the company.
- Do not copy data from commercial map services (for example Google Maps) into the directory. Their terms forbid storing it.
