# Business Directory: import report

Generated 2026-11-12T18:34:15.811Z by `scripts/build-business-directory.mjs` (dry run, nothing written to a database).

- Source: `data/imports/export__1_.geojson`, Overpass snapshot 2026-11-12T18:09:59Z. © OpenStreetMap contributors, ODbL 1.0.
- Regions: geoBoundaries gbOpen GHA ADM1 (2021, from OpenStreetMap, CC BY-SA 2.0), point-in-polygon; within 200 m of another region = near_boundary.
- Nothing is verified by an import. Only an administrator can verify.

## Totals

| Item | Count |
|---|---|
| Rows read | 2072 |
| Rows with errors (not imported) | 0 |
| Excluded (kept in staging, with reason) | 1377 |
| Locations to import | 695 |
| Businesses (suggested grouping) | 597 |
| Pending | 541 |
| Needs review | 154 |
| Verified | 0 |
| Duplicate candidate pairs (flagged, not merged) | 41 |

## Excluded by reason

| Reason | Count |
|---|---|
| traditional_marketplace | 373 |
| traditional_marketplace_with_shop_tag | 3 |
| no_name | 1001 |

## Per category, against the 100 target

| Category | To import | Pending | Needs review | Target | Short by |
|---|---|---|---|---|---|
| Shopping malls | 38 | 0 | 38 | 100 | 62 |
| Retail shops | 292 | 261 | 31 | 100 | 0 |
| Mini-markets | 365 | 280 | 85 | 100 | 0 |

These are imported candidates, not verified places. The real count is what administrators verify.

## Per region

| Region | Malls | Retail | Mini-markets | Total |
|---|---|---|---|---|
| Greater Accra | 26 | 135 | 214 | 375 |
| Ashanti | 5 | 32 | 22 | 59 |
| Western | 3 | 25 | 24 | 52 |
| Western North | 0 | 2 | 9 | 11 |
| Central | 1 | 24 | 15 | 40 |
| Eastern | 1 | 5 | 5 | 11 |
| Volta | 1 | 25 | 20 | 46 |
| Oti | 0 | 1 | 1 | 2 |
| Northern | 1 | 16 | 8 | 25 |
| Savannah | 0 | 2 | 9 | 11 |
| North East | 0 | 0 | 3 | 3 |
| Upper East | 0 | 9 | 8 | 17 |
| Upper West | 0 | 5 | 14 | 19 |
| Bono | 0 | 7 | 1 | 8 |
| Bono East | 0 | 0 | 2 | 2 |
| Ahafo | 0 | 4 | 10 | 14 |
| Unassigned |  |  |  | 0 |

Regions with no records: none.

Region confidence: inside 695.

## Flags

| Flag | Locations |
|---|---|
| centroid_coordinate | 89 |
| possible_duplicate | 62 |
| mall_candidate | 38 |
| fuel_station_shop | 26 |
| large_footprint_review | 19 |
| category_conflict | 19 |
| name_generic | 12 |
| fixme_tag | 10 |

Duplicate pairs by rule: same_name_nearby 14, same_category_very_close 24, similar_name_nearby 3.

## Missing fields (left empty, never guessed)

| Field | Locations without it |
|---|---|
| branchName | 686 |
| city | 567 |
| town | 613 |
| addressFull | 523 |
| region | 0 |

## Errors

None.
