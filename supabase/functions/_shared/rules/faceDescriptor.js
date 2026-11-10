/**
 * Face matching with face-api, the open-source face recognition model that runs
 * on the phone. The phone turns a face into 128 numbers (a descriptor); photos
 * of the same person give descriptors close together. The server keeps the
 * enrolled descriptor and decides whether a scan is close enough.
 */

export const DESCRIPTOR_ALGORITHM = 'faceapi-128-v1'
export const DESCRIPTOR_LENGTH = 128

/**
 * Two descriptors at most this far apart are the same person. The model's
 * authors use 0.6; a lower value turns away more lookalikes at the cost of
 * asking the right person to scan again a little more often.
 */
export const MATCH_DISTANCE = 0.5

/** @returns {number[]|null} the descriptor, or null if it is not a valid one */
export function parseDescriptor(value) {
  if (!Array.isArray(value) || value.length !== DESCRIPTOR_LENGTH) return null
  if (!value.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1)) return null
  // A real face never gives a flat descriptor.
  const norm = Math.sqrt(value.reduce((sum, v) => sum + v * v, 0))
  return norm > 0.1 ? value : null
}

export function encodeDescriptor(descriptor) {
  return JSON.stringify(descriptor.map((v) => Math.round(v * 1e6) / 1e6))
}

/** @returns {number[]|null} */
export function decodeDescriptor(text) {
  try {
    return parseDescriptor(JSON.parse(text))
  } catch {
    return null
  }
}

export function descriptorDistance(a, b) {
  let sum = 0
  for (let i = 0; i < DESCRIPTOR_LENGTH; i += 1) sum += (a[i] - b[i]) ** 2
  return Math.sqrt(sum)
}

/** @returns {{ score: number, match: boolean }} score is 0 to 1, higher is closer */
export function compareDescriptors(enrolled, scanned) {
  const distance = descriptorDistance(enrolled, scanned)
  return { score: Math.max(0, Math.round((1 - distance) * 1000) / 1000), match: distance <= MATCH_DISTANCE }
}
