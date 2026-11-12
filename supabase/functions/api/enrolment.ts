/** Reading a face sample from a request and saving it as someone's enrolled face. */

import { EnrollmentOutdated, enrollFace, FaceServiceUnavailable, type FaceSample, type FaceTemplate, UnusableFaceImage } from '../_shared/faceMatcher.ts'
import { parseDescriptor } from '../_shared/rules/faceDescriptor.js'
import { parseJpegDataUrl } from '../_shared/rules/facePhoto.js'
import { ApiError, storePhoto } from './lib.ts'

export const ENROLLMENT_BUCKET = 'face-enrollment'

/** The photo, and the descriptor the phone worked out from it. */
export function faceSample(body: Record<string, unknown>): FaceSample {
  const image = parseJpegDataUrl(body.faceImage)
  if (!image) throw new ApiError(400, 'Face verification is required. Please capture your photo to continue.')
  return { image, descriptor: parseDescriptor(body.faceDescriptor) }
}

/** Turn face-service failures into messages a person can act on. */
export async function readable<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (error) {
    if (error instanceof UnusableFaceImage) throw new ApiError(422, error.message, { code: 'unusable-photo' })
    if (error instanceof FaceServiceUnavailable) {
      throw new ApiError(503, 'The face check is unavailable right now. Please try again in a moment.', { code: 'face-service' })
    }
    if (error instanceof EnrollmentOutdated) {
      throw new ApiError(409, 'Your face photo needs to be registered again. Please contact HR.', { code: 'enrollment-outdated' })
    }
    throw error
  }
}

/**
 * Read the face in a request, work out its template and store the photo.
 * The caller saves the template; if that fails it should discard the photo.
 */
export async function enrolNewFace(body: Record<string, unknown>, companyId: string): Promise<{ template: FaceTemplate; photoPath: string }> {
  const face = faceSample(body)
  const photoPath = `${companyId}/${crypto.randomUUID()}.jpg`
  const template = await readable(() => enrollFace(face, photoPath))
  await storePhoto(ENROLLMENT_BUCKET, photoPath, face.image)
  return { template, photoPath }
}
