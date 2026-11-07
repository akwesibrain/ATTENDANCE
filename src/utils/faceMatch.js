/**
 * Face-image comparison used by the mock attendance service.
 *
 * This is NOT a real biometric model — it is a deterministic image-similarity
 * check so the frontend can enforce the rule "the scanned face must match the
 * photo registered to this Staff ID". A production backend would replace this
 * with a true face-embedding comparison (e.g. a 128-d descriptor distance).
 *
 * The algorithm downsamples both images to a small grayscale grid and compares
 * them with a mean-absolute-difference score. Two photos of the same scene /
 * person captured moments apart score very close; two different people (or a
 * different scene) score far apart.
 */

/** Grid size the images are reduced to before comparison. */
const SAMPLE_SIZE = 32

/**
 * Similarity threshold in [0, 1]. Scores at or above this are a match.
 * Chosen to accept same-person photos (lighting/pose shifts) while rejecting
 * different people. Tunable if the demo proves too strict/lenient.
 */
export const FACE_MATCH_THRESHOLD = 0.82

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read the face image.'))
    img.src = dataUrl
  })
}

/**
 * Downsample an image to a SAMPLE_SIZE x SAMPLE_SIZE grayscale fingerprint.
 * @returns {Float32Array} normalized pixel values in [0, 1].
 */
function fingerprint(img) {
  const canvas = document.createElement('canvas')
  canvas.width = SAMPLE_SIZE
  canvas.height = SAMPLE_SIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  // Draw centered-cropped to a square so faces align regardless of aspect.
  const side = Math.min(img.width, img.height)
  const sx = (img.width - side) / 2
  const sy = (img.height - side) / 2
  ctx.drawImage(img, sx, sy, side, side, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
  const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
  const out = new Float32Array(SAMPLE_SIZE * SAMPLE_SIZE)
  for (let i = 0; i < out.length; i += 1) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    out[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  }
  return out
}

/**
 * Compare two face images and return a similarity score in [0, 1].
 * @param {string} dataUrlA - first face image (data URL).
 * @param {string} dataUrlB - second face image (data URL).
 * @returns {Promise<number>} similarity score (1 = identical).
 */
export async function faceSimilarity(dataUrlA, dataUrlB) {
  if (!dataUrlA || !dataUrlB) return 0
  const [imgA, imgB] = await Promise.all([
    loadImage(dataUrlA),
    loadImage(dataUrlB),
  ])
  const a = fingerprint(imgA)
  const b = fingerprint(imgB)
  let sum = 0
  for (let i = 0; i < a.length; i += 1) {
    sum += Math.abs(a[i] - b[i])
  }
  const meanAbsDiff = sum / a.length
  return 1 - meanAbsDiff
}

/**
 * Whether two face images depict the same person.
 * @returns {Promise<boolean>}
 */
export async function facesMatch(dataUrlA, dataUrlB) {
  const score = await faceSimilarity(dataUrlA, dataUrlB)
  return score >= FACE_MATCH_THRESHOLD
}
