import { describe, expect, it } from 'vitest'
import {
  enrollmentProblem,
  MANY_FACES_MESSAGE,
  MATCH_SIMILARITY,
  NO_FACE_MESSAGE,
  readComparison,
} from '../supabase/functions/_shared/rules/faceDecision.js'

describe('enrolling a face', () => {
  it('accepts one clear face', () => {
    expect(enrollmentProblem([{ Confidence: 99.9 }])).toBeNull()
  })

  it('refuses no face, a doubtful face and several people', () => {
    expect(enrollmentProblem([])).toBe(NO_FACE_MESSAGE)
    expect(enrollmentProblem(undefined)).toBe(NO_FACE_MESSAGE)
    expect(enrollmentProblem([{ Confidence: 60 }])).toBe(NO_FACE_MESSAGE)
    expect(enrollmentProblem([{ Confidence: 99 }, { Confidence: 99 }])).toBe(MANY_FACES_MESSAGE)
  })
})

describe('comparing a scan with the enrolled face', () => {
  it('matches at the threshold and not below it', () => {
    expect(readComparison({ FaceMatches: [{ Similarity: MATCH_SIMILARITY }] })).toEqual({ score: 0.9, match: true })
    expect(readComparison({ FaceMatches: [{ Similarity: MATCH_SIMILARITY - 0.1 }] }).match).toBe(false)
  })

  it('reads a different person as a mismatch, not a problem with the photo', () => {
    expect(readComparison({ FaceMatches: [{ Similarity: 12 }] })).toEqual({ score: 0.12, match: false })
    expect(readComparison({ UnmatchedFaces: [{}] })).toEqual({ score: 0, match: false })
  })

  it('never counts a scan with nobody in it as a failed attempt', () => {
    expect(readComparison({})).toEqual({ problem: NO_FACE_MESSAGE })
  })

  it('refuses a scan with two people, so a colleague cannot stand in the frame', () => {
    expect(readComparison({ FaceMatches: [{ Similarity: 99 }, { Similarity: 10 }] })).toEqual({ problem: MANY_FACES_MESSAGE })
    expect(readComparison({ FaceMatches: [{ Similarity: 99 }], UnmatchedFaces: [{}] })).toEqual({ problem: MANY_FACES_MESSAGE })
  })
})
