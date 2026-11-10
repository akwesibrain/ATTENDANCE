/**
 * Storage for historical import batches (mock, this browser only).
 *
 * Kept separate from historicalImportService so the attendance records
 * service can read approved historical entries without an import cycle.
 */

const BATCHES_KEY = 'mock-historical-import:batches'

export function readBatches() {
  try {
    return JSON.parse(window.localStorage.getItem(BATCHES_KEY)) ?? {}
  } catch {
    return {}
  }
}

export function writeBatches(batches) {
  try {
    window.localStorage.setItem(BATCHES_KEY, JSON.stringify(batches))
    return true
  } catch {
    return false
  }
}

/** Batch statuses whose approved records count as official attendance. */
export const FINALISED_STATUSES = ['approved', 'partially-approved']

/**
 * Approved historical entries keyed by `employeeId:date`. A record only counts
 * once its batch review is complete and the record itself was approved.
 * @returns {Map<string, { record: object, batch: object }>}
 */
export function approvedHistoricalIndex() {
  const index = new Map()
  Object.values(readBatches()).forEach((batch) => {
    if (!FINALISED_STATUSES.includes(batch.status)) return
    batch.records.forEach((record) => {
      if (record.review?.decision === 'approved' && record.match?.employeeId) {
        index.set(`${record.match.employeeId}:${record.date}`, { record, batch })
      }
    })
  })
  return index
}
