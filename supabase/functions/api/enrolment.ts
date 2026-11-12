/** Reading a face sample from a request and saving it as someone's enrolled face. */

import { EnrollmentOutdated, enrollFace, FaceServiceUnavailable, type FaceSample, type FaceTemplate, UnusableFaceImage } from '../_shared/faceMatcher.ts'
import { parseDescriptor } from '../_shared/rules/faceDescriptor.js'
import { parseJpegDataUrl } from '../_shared/rules/facePhoto.js'
import { ApiError, db, discardPhoto, found, invalid, rpc, storePhoto } from './lib.ts'

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

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// deno-lint-ignore no-explicit-any
type RegistrationForm = any

/**
 * Create the employee and issue the Staff ID. With no template the employee
 * has no face yet. addedBy is set when HR adds them. If the database refuses,
 * the stored photo is removed.
 */
export async function registerEmployee(
  form: RegistrationForm,
  face: { template: FaceTemplate; photoPath: string } | null,
  addedBy: { name: string; role: string } | null = null,
): Promise<Record<string, string | null>> {
  try {
    return await rpc<Record<string, string | null>>('register_employee', {
      p_employee: {
        company_id: form.companyId,
        full_name: form.fullName,
        position: form.position,
        payment_method: form.paymentMethod,
        phone: form.phone,
        email: form.email,
        address: form.address,
        emergency_contact_name: form.emergencyContactName,
        emergency_contact_phone: form.emergencyContactPhone,
        face_photo_path: face?.photoPath ?? null,
      },
      p_template: face?.template ?? null,
      p_shop_ids: form.shopIds,
      p_new_shops: form.newShops.map((shop: { shopName: string; town: string; area: string; address: string }) => ({
        shop_id: `shop-${slug(form.companyId)}-${slug(`${shop.shopName} ${shop.area}`)}-${crypto.randomUUID().slice(0, 8)}`,
        shop_name: shop.shopName,
        town: shop.town,
        area: shop.area,
        address: shop.address,
      })),
      p_added_by: addedBy,
    })
  } catch (error) {
    if (face) await discardPhoto(ENROLLMENT_BUCKET, face.photoPath)
    // The database's shop refusals belong next to the shop field.
    if (error instanceof ApiError && SHOP_REFUSALS.includes(error.message)) throw invalid({ shop: error.message })
    throw error
  }
}

const SHOP_REFUSALS = [
  'Choose shops from your company’s shop list.',
  'Choose at most 7 shops.',
  'Please choose an allocated shop for this position to continue.',
]

/** An employee's shops, in list order. */
export async function shopListOf(staffId: string): Promise<string[]> {
  const rows = await found(db.from('employee_shops').select('shop_id').eq('staff_id', staffId).order('position'))
  return rows.map((row: { shop_id: string }) => row.shop_id)
}
