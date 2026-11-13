/**
 * The server's one face-matching interface.
 *
 * Production requires `FACE_PROVIDER=rekognition` (AWS Rekognition). Client-side
 * `faceapi` descriptors are accepted only when both `FACE_PROVIDER=faceapi` and
 * `ALLOW_CLIENT_FACEAPI=true` are explicitly configured; otherwise the server
 * fails closed with 503.
 *
 * A failed call is never counted against the employee: only a clear answer that
 * the faces differ uses up a scan attempt.
 */

import { AwsClient } from 'npm:aws4fetch@1.0.20'
import { configuredFaceProviderFromEnv, resolveFaceProvider } from '../api/guards.ts'
import { enrollmentProblem, NO_FACE_MESSAGE, readComparison } from './rules/faceDecision.js'
import { compareDescriptors, decodeDescriptor, DESCRIPTOR_ALGORITHM, encodeDescriptor } from './rules/faceDescriptor.js'

export type FaceTemplate = { algorithm: string; template: string }
export type FaceResult = { score: number; match: boolean }
/** What a registration or scan sends: the photo, and the phone's descriptor of it. */
export type FaceSample = { image: Uint8Array; descriptor: number[] | null }

/** The photo could not be used, as opposed to not matching. */
export class UnusableFaceImage extends Error {}
/** The face service could not answer. */
export class FaceServiceUnavailable extends Error {}
/** The employee was enrolled under a different matcher and must enrol again. */
export class EnrollmentOutdated extends Error {}

const REKOGNITION_ALGORITHM = 'rekognition-compare-v1'
const REQUEST_TIMEOUT_MS = 8000
const IMAGE_ERRORS = ['InvalidParameterException', 'InvalidImageFormatException', 'ImageTooLargeException']

export function faceProvider(): 'rekognition' | 'faceapi' {
  return resolveFaceProvider({
    faceProvider: Deno.env.get('FACE_PROVIDER'),
    allowClientFaceApi: Deno.env.get('ALLOW_CLIENT_FACEAPI'),
  })
}

export function configuredFaceProvider(): 'rekognition' | 'faceapi' | 'none' {
  return configuredFaceProviderFromEnv({
    faceProvider: Deno.env.get('FACE_PROVIDER'),
    allowClientFaceApi: Deno.env.get('ALLOW_CLIENT_FACEAPI'),
  })
}

const NO_DESCRIPTOR = 'The face in the photo could not be read. Please retake it, facing the camera in good light.'

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
 * Interface
 * ------------------------------------------------------------------------ */

/** Check a photo can be used, and describe how it will be matched later. */
export async function enrollFace({ image, descriptor }: FaceSample, photoPath: string): Promise<FaceTemplate> {
  const provider = faceProvider()
  if (provider === 'faceapi') {
    if (!descriptor) throw new UnusableFaceImage(NO_DESCRIPTOR)
    return { algorithm: DESCRIPTOR_ALGORITHM, template: encodeDescriptor(descriptor) }
  }
  const { FaceDetails } = await rekognition('DetectFaces', { Image: { Bytes: base64(image) }, Attributes: ['DEFAULT'] })
  const problem = enrollmentProblem(FaceDetails)
  if (problem) throw new UnusableFaceImage(problem)
  // The enrolled photo itself is compared later, so no face data is kept at AWS.
  return { algorithm: REKOGNITION_ALGORITHM, template: photoPath }
}

export async function compareFaces(
  enrolled: FaceTemplate,
  { image, descriptor }: FaceSample,
  loadPhoto: (path: string) => Promise<Uint8Array>,
): Promise<FaceResult> {
  const provider = faceProvider()
  const expected = provider === 'rekognition' ? REKOGNITION_ALGORITHM : DESCRIPTOR_ALGORITHM
  if (enrolled.algorithm !== expected) throw new EnrollmentOutdated()

  if (provider === 'faceapi') {
    if (!descriptor) throw new UnusableFaceImage(NO_DESCRIPTOR)
    const stored = decodeDescriptor(enrolled.template)
    if (!stored) throw new EnrollmentOutdated()
    return compareDescriptors(stored, descriptor)
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
