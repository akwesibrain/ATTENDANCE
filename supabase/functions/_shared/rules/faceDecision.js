/**
 * How the server reads a face recognition service's answer. Kept apart from the
 * network call so the decisions can be tested.
 */

/** Similarity, from 0 to 100, at or above which two faces count as the same person. */
export const MATCH_SIMILARITY = 90

const MIN_FACE_CONFIDENCE = 90

export const NO_FACE_MESSAGE = 'We could not see a face in the photo. Face the camera in good light and try again.'
export const MANY_FACES_MESSAGE = 'More than one person is in the photo. Only you should be in the frame.'

/** @returns {string|null} why this photo cannot be enrolled, or null if it can */
export function enrollmentProblem(faceDetails = []) {
  if (faceDetails.length > 1) return MANY_FACES_MESSAGE
  if (faceDetails.length === 0 || faceDetails[0].Confidence < MIN_FACE_CONFIDENCE) return NO_FACE_MESSAGE
  return null
}

/**
 * Asked with a similarity threshold of 0, every face in the scan comes back in
 * FaceMatches with its score, so a poor match is still a readable answer.
 * @returns {{ problem: string } | { score: number, match: boolean }} score is 0 to 1
 */
export function readComparison({ FaceMatches = [], UnmatchedFaces = [] } = {}) {
  const facesInScan = FaceMatches.length + UnmatchedFaces.length
  if (facesInScan === 0) return { problem: NO_FACE_MESSAGE }
  if (facesInScan > 1) return { problem: MANY_FACES_MESSAGE }
  const similarity = FaceMatches[0]?.Similarity ?? 0
  return { score: similarity / 100, match: similarity >= MATCH_SIMILARITY }
}
