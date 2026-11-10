/**
 * The server's one face-matching interface.
 *
 * FACE_PROVIDER=rekognition compares faces with AWS Rekognition. Without it the
 * server falls back to comparing photos as small grayscale images, which cannot
 * reliably tell two people apart. HR sees which one is active in Settings.
 *
 * A failed call is never counted against the employee: only a clear answer that
 * the faces differ uses up a scan attempt.
 */

import { AwsClient } from 'npm:aws4fetch@1.0.20'
import jpeg from 'npm:jpeg-js@0.4.4'
import { enrollmentProblem, NO_FACE_MESSAGE, readComparison } from './rules/faceDecision.js'
import {
  compareTemplates,
  decodeTemplate,
  encodeTemplate,
  FACE_MATCH_THRESHOLD,
  FACE_TEMPLATE_ALGORITHM,
  hasEnoughContrast,
  templateFromRgba,
} from './rules/faceTemplate.js'

export type FaceTemplate = { algorithm: string; template: string }
export type FaceResult = { score: number; match: boolean }

/** The photo could not be used, as opposed to not matching. */
export class UnusableFaceImage extends Error {}
/** The face service could not answer. */
export class FaceServiceUnavailable extends Error {}
/** The employee was enrolled under a different matcher and must enrol again. */
export class EnrollmentOutdated extends Error {}

const REKOGNITION_ALGORITHM = 'rekognition-compare-v1'
const REQUEST_TIMEOUT_MS = 8000
const IMAGE_ERRORS = ['InvalidParameterException', 'InvalidImageFormatException', 'ImageTooLargeException']

export function faceProvider(): 'rekognition' | 'pixel' {
  return Deno.env.get('FACE_PROVIDER')?.trim() === 'rekognition' ? 'rekognition' : 'pixel'
}

/* --------------------------------------------------------------------------
 * AWS Rekognition
 * ------------------------------------------------------------------------ */

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

async function rekognition(action: string, payload: unknown) {
  const region = Deno.env.get('REKOGNITION_REGION')
  const accessKeyId = Deno.env.get('REKOGNITION_ACCESS_KEY_ID')
  const secretAccessKey = Deno.env.get('REKOGNITION_SECRET_ACCESS_KEY')
  if (!region || !accessKeyId || !secretAccessKey) {
    console.error('face service is selected but its keys are not set')
    throw new FaceServiceUnavailable()
  }

  const client = new AwsClient({ accessKeyId, secretAccessKey, region, service: 'rekognition', retries: 0 })
  let response: Response
  try {
    response = await client.fetch(`https://rekognition.${region}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': `RekognitionService.${action}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    console.error('face service unreachable', action, error)
    throw new FaceServiceUnavailable()
  }

  const body = await response.json().catch(() => ({}))
  if (response.ok) return body
  const errorType = String(body.__type ?? '').split('#').pop() ?? ''
  if (IMAGE_ERRORS.includes(errorType)) throw new UnusableFaceImage(NO_FACE_MESSAGE)
  console.error('face service refused', action, response.status, errorType)
  throw new FaceServiceUnavailable()
}

/* --------------------------------------------------------------------------
 * Photo comparison fallback
 * ------------------------------------------------------------------------ */

function templateFromJpeg(image: Uint8Array): Uint8Array {
  let template: Uint8Array
  try {
    const decoded = jpeg.decode(image, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 3, maxMemoryUsageInMB: 64 })
    template = templateFromRgba(decoded)
  } catch {
    throw new UnusableFaceImage('Could not read the photo. Please try again.')
  }
  if (!hasEnoughContrast(template)) {
    throw new UnusableFaceImage('The photo is too dark or blank. Face the camera in good light and try again.')
  }
  return template
}

/* --------------------------------------------------------------------------
 * Interface
 * ------------------------------------------------------------------------ */

/** Check a photo can be used, and describe how it will be matched later. */
export async function enrollFace(image: Uint8Array, photoPath: string): Promise<FaceTemplate> {
  if (faceProvider() === 'pixel') {
    return { algorithm: FACE_TEMPLATE_ALGORITHM, template: encodeTemplate(templateFromJpeg(image)) }
  }
  const { FaceDetails } = await rekognition('DetectFaces', { Image: { Bytes: base64(image) }, Attributes: ['DEFAULT'] })
  const problem = enrollmentProblem(FaceDetails)
  if (problem) throw new UnusableFaceImage(problem)
  // The enrolled photo itself is compared later, so no face data is kept at AWS.
  return { algorithm: REKOGNITION_ALGORITHM, template: photoPath }
}

export async function compareFaces(
  enrolled: FaceTemplate,
  image: Uint8Array,
  loadPhoto: (path: string) => Promise<Uint8Array>,
): Promise<FaceResult> {
  const expected = faceProvider() === 'rekognition' ? REKOGNITION_ALGORITHM : FACE_TEMPLATE_ALGORITHM
  if (enrolled.algorithm !== expected) throw new EnrollmentOutdated()

  if (faceProvider() === 'pixel') {
    const score = compareTemplates(decodeTemplate(enrolled.template), templateFromJpeg(image))
    return { score, match: score >= FACE_MATCH_THRESHOLD }
  }

  const source = await loadPhoto(enrolled.template)
  const answer = readComparison(await rekognition('CompareFaces', {
    SourceImage: { Bytes: base64(source) },
    TargetImage: { Bytes: base64(image) },
    SimilarityThreshold: 0,
  }))
  if ('problem' in answer) throw new UnusableFaceImage(answer.problem)
  return answer
}
