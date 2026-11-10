/**
 * Image comparison used by the server's face check.
 *
 * This is NOT face recognition. It compares two photos as small grayscale
 * grids, so a printed photo can pass and lighting can cause false failures.
 * It keeps the rule "the scan must match this Staff ID" working until a real
 * matcher replaces it, behind `faceMatcher.ts`.
 */

export const FACE_TEMPLATE_ALGORITHM = 'gray32-v1'
export const FACE_MATCH_THRESHOLD = 0.82
export const MAX_FACE_IMAGE_BYTES = 1_000_000

const GRID = 32
const CELLS = GRID * GRID
/** Below this spread of brightness the frame is blank, dark or covered. */
const MIN_CONTRAST = 8

/** @returns {Uint8Array|null} the JPEG bytes, or null if this is not one. */
export function parseJpegDataUrl(value) {
  if (typeof value !== 'string') return null
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match || (match[1].length * 3) / 4 > MAX_FACE_IMAGE_BYTES) return null
  let binary
  try {
    binary = atob(match[1])
  } catch {
    return null
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 ? bytes : null
}

/**
 * Reduce a decoded image to a 32×32 grayscale grid, from its centered square.
 * Each cell averages the pixels it covers, so the result does not depend on
 * the size of the photo.
 * @param {{ width: number, height: number, data: Uint8Array }} image RGBA pixels
 * @returns {Uint8Array} 1024 brightness values
 */
export function templateFromRgba({ width, height, data }) {
  const side = Math.min(width, height)
  if (side < GRID) throw new Error('Image is too small')
  const left = Math.floor((width - side) / 2)
  const top = Math.floor((height - side) / 2)
  const out = new Uint8Array(CELLS)
  for (let row = 0; row < GRID; row += 1) {
    const y0 = top + Math.floor((row * side) / GRID)
    const y1 = top + Math.floor(((row + 1) * side) / GRID)
    for (let col = 0; col < GRID; col += 1) {
      const x0 = left + Math.floor((col * side) / GRID)
      const x1 = left + Math.floor(((col + 1) * side) / GRID)
      let total = 0
      let count = 0
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = (y * width + x) * 4
          total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
          count += 1
        }
      }
      out[row * GRID + col] = Math.round(total / count)
    }
  }
  return out
}

/** False for a blank, very dark or covered frame, which would match any other. */
export function hasEnoughContrast(template) {
  const mean = template.reduce((sum, value) => sum + value, 0) / template.length
  const variance = template.reduce((sum, value) => sum + (value - mean) ** 2, 0) / template.length
  return Math.sqrt(variance) >= MIN_CONTRAST
}

/** @returns {number} similarity from 0 to 1, where 1 is identical */
export function compareTemplates(a, b) {
  if (a.length !== CELLS || b.length !== CELLS) throw new Error('Unexpected template size')
  let total = 0
  for (let i = 0; i < CELLS; i += 1) total += Math.abs(a[i] - b[i])
  return 1 - total / (CELLS * 255)
}

export function encodeTemplate(bytes) {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
}

export function decodeTemplate(text) {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
}
