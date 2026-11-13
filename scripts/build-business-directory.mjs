/**
 * Business Directory: dry-run import from the OpenStreetMap export.
 *
 *   node scripts/build-business-directory.mjs
 *   node scripts/build-business-directory.mjs --source data/imports/other.geojson --rejected data/directory/rejected.json
 *
 * Reads (never modifies):
 *   data/imports/export__1_.geojson                 Overpass export (© OpenStreetMap contributors, ODbL 1.0)
 *   data/boundaries/geoBoundaries-GHA-ADM1.geojson  16 regions (geoBoundaries gbOpen, from OSM, CC BY-SA 2.0)
 *
 * Writes (nothing is sent to any database):
 *   data/directory/business-directory-import.json   staged businesses, locations, excluded records, errors
 *   data/directory/import-report.md                 the import report for HR and the backend developer
 *
 * Re-running is safe: records are keyed on (source, OSM id), and the backend
 * applies the file with mergeImport() rules (see docs/business-directory.md).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { buildDirectoryImport, CATEGORIES, CATEGORY_TARGET } from '../src/services/directory/osmImport.js'
import { GHANA_REGIONS, prepareRegionBoundaries } from '../src/services/directory/regions.js'

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : fallback }
const SOURCE = arg('--source', 'data/imports/export__1_.geojson')
const BOUNDARIES = arg('--boundaries', 'data/boundaries/geoBoundaries-GHA-ADM1.geojson')
const REJECTED = arg('--rejected', null)
const OUT = arg('--out', 'data/directory')

const boundaries = prepareRegionBoundaries(JSON.parse(readFileSync(BOUNDARIES, 'utf8')))
boundaries.sourceLabel = 'geoBoundaries gbOpen GHA ADM1 (2021, from OpenStreetMap, CC BY-SA 2.0)'
if (boundaries.problems.length) { console.error('Boundary problems:\n- ' + boundaries.problems.join('\n- ')); process.exit(1) }

const rejected = REJECTED ? JSON.parse(readFileSync(REJECTED, 'utf8')) : []
const result = buildDirectoryImport(readFileSync(SOURCE, 'utf8'), { boundaries, rejectedSourceIds: rejected })
if (!result.ok) { console.error(result.error); process.exit(1) }
const r = result.report

mkdirSync(OUT, { recursive: true })
const { report, ...data } = result
writeFileSync(`${OUT}/business-directory-import.json`, JSON.stringify({ ...data, report }, null, 1))

const LABEL = { shopping_mall: 'Shopping malls', retail_shop: 'Retail shops', mini_market: 'Mini-markets' }
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((x) => `| ${x.join(' | ')} |`)].join('\n')
const n = (v) => v ?? 0
const md = `# Business Directory: import report

Generated ${result.dataset.generatedAt} by \`scripts/build-business-directory.mjs\` (dry run, nothing written to a database).

- Source: \`${SOURCE}\`, Overpass snapshot ${result.dataset.sources[0].snapshotTimestamp}. ${result.dataset.sources[0].attribution}.
- Regions: ${result.dataset.regionBoundarySource}, point-in-polygon; within 200 m of another region = near_boundary.
- Nothing is verified by an import. Only an administrator can verify.

## Totals

${table(['Item', 'Count'], [
    ['Rows read', r.rowsRead],
    ['Rows with errors (not imported)', r.errors],
    ['Excluded (kept in staging, with reason)', r.excluded],
    ['Locations to import', r.imported],
    ['Businesses (suggested grouping)', r.businesses],
    ['Pending', n(r.byStatus.pending)],
    ['Needs review', n(r.byStatus.needs_review)],
    ['Verified', r.verified],
    ['Duplicate candidate pairs (flagged, not merged)', r.duplicatePairs],
  ])}

## Excluded by reason

${table(['Reason', 'Count'], Object.entries(r.excludedByReason).map(([k, v]) => [k, v]))}

## Per category, against the 100 target

${table(['Category', 'To import', 'Pending', 'Needs review', 'Target', 'Short by'], CATEGORIES.map((c) => [LABEL[c], r.perCategory[c], n(r.perCategoryStatus[c].pending), n(r.perCategoryStatus[c].needs_review), CATEGORY_TARGET, r.shortfall[c]]))}

These are imported candidates, not verified places. The real count is what administrators verify.

## Per region

${table(['Region', 'Malls', 'Retail', 'Mini-markets', 'Total'], [...GHANA_REGIONS.map((g) => { const x = r.perRegionCategory[g]; return [g, x.shopping_mall, x.retail_shop, x.mini_market, r.perRegion[g]] }), ['Unassigned', '', '', '', r.perRegion.Unassigned]])}

Regions with no records: ${r.regionsWithNoRecords.length ? r.regionsWithNoRecords.join(', ') : 'none'}.

Region confidence: ${Object.entries(r.regionConfidence).map(([k, v]) => `${k} ${v}`).join(', ')}.

## Flags

${table(['Flag', 'Locations'], Object.entries(r.flags).sort((a, b) => b[1] - a[1]))}

Duplicate pairs by rule: ${Object.entries(r.duplicatePairsByRule).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.

## Missing fields (left empty, never guessed)

${table(['Field', 'Locations without it'], Object.entries(r.missingFields))}

## Errors

${result.errors.length ? table(['Row', 'OSM id', 'Error'], result.errors.map((e) => [e.index, e.sourceId ?? '-', e.error])) : 'None.'}
`
writeFileSync(`${OUT}/import-report.md`, md)
console.log(`ok: ${r.imported} locations, ${r.excluded} excluded, ${r.errors} errors → ${OUT}/`)
console.log(JSON.stringify({ perCategory: r.perCategory, byStatus: r.byStatus, perRegion: r.perRegion, regionConfidence: r.regionConfidence }, null, 1))
