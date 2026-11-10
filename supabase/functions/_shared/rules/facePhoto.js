/**
 * The face photo sent with a registration or scan. It is stored privately so HR
 * can see who checked in; the face match itself uses the face descriptor.
 */

export const MAX_FACE_IMAGE_BYTES = 1_000_000

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
