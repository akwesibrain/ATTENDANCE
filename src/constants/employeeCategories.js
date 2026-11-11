/**
 * Employee categories. Each category has its own attendance and monitoring
 * workflow — they are never treated as the same thing:
 *
 *   Warehouse Workers      clock in → break out → break in → clock out; working
 *                          hours exclude the breaks actually scanned.
 *   Sales Representatives  visit mini-markets; company hours; NO scheduled
 *                          break; outlet visits recorded during the day.
 *   Supervisors            visit larger outlets (China Mall, Melcom…) and move
 *                          between several shops; company hours; NO scheduled
 *                          break; outlet visits recorded during the day.
 *   Merchandisers          one allocated shop; the existing Merchandiser
 *                          Monitoring (random verification checks, geofence).
 *   Office & other staff   everyone else; company hours and default break.
 *
 * The category is derived from the job position, so existing employee records
 * keep working without changes.
 */

export const CATEGORIES = {
  warehouse: {
    id: 'warehouse',
    label: 'Warehouse Workers',
    single: 'Warehouse Worker',
    breaks: 'scanned',
    monitoring: null,
    description: 'Scan out for break and back in; breaks are taken off working hours.',
  },
  'sales-rep': {
    id: 'sales-rep',
    label: 'Sales Representatives',
    single: 'Sales Representative',
    breaks: 'none',
    monitoring: 'visits',
    description: 'Visit mini-markets; company working hours; no scheduled break.',
  },
  merchandiser: {
    id: 'merchandiser',
    label: 'Merchandisers',
    single: 'Merchandiser',
    breaks: 'scheduled',
    monitoring: 'shop',
    description: 'Work at one allocated shop; random verification checks.',
  },
  supervisor: {
    id: 'supervisor',
    label: 'Supervisors',
    single: 'Supervisor',
    breaks: 'none',
    monitoring: 'visits',
    description: 'Visit several retail outlets a day; company working hours; no scheduled break.',
  },
  office: {
    id: 'office',
    label: 'Office & other staff',
    single: 'Office & other staff',
    breaks: 'scheduled',
    monitoring: null,
    description: 'Company working hours and the default break.',
  },
}

/** The four field/warehouse categories that have their own reports. */
export const REPORT_CATEGORIES = ['warehouse', 'sales-rep', 'merchandiser', 'supervisor']

/** Category for a job position. */
export function categoryForPosition(position) {
  const p = String(position ?? '').trim().toLowerCase()
  if (p === 'merchandiser' || p.startsWith('merchandiser')) return 'merchandiser'
  if (p === 'sales representative' || p === 'sales rep') return 'sales-rep'
  if (p === 'supervisor' || p === 'field supervisor' || p === 'sales supervisor') return 'supervisor'
  if (p.includes('warehouse')) return 'warehouse'
  return 'office'
}

export function categoryLabel(categoryId, { single = false } = {}) {
  const c = CATEGORIES[categoryId] ?? CATEGORIES.office
  return single ? c.single : c.label
}

/** Whether the category records outlet visits (Sales Reps and Supervisors). */
export function recordsVisits(categoryId) {
  return CATEGORIES[categoryId]?.monitoring === 'visits'
}
