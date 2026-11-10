import { useCallback, useEffect, useRef, useState } from 'react'
import { captureFrame } from '../../utils/captureFrame'

const CAMERA_TIPS = [
  'Look directly at the camera.',
  'Ensure your face is clearly visible.',
  'Remove anything obstructing your face where practical.',
  'Use good lighting.',
]

/**
 * Screen 4 — Face enrollment.
 *
 * This screen ONLY captures a photo and attaches it to the registration
 * payload for backend submission. No facial recognition, face matching or
 * liveness detection happens in the frontend — biometric verification is
 * implemented by the backend.
 */
export default function FaceEnrollment({ faceImage, onCapture }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [cameraState, setCameraState] = useState(
    faceImage ? 'captured' : 'requesting',
  )
  const [errorKind, setErrorKind] = useState(null)
  // Which camera to use: 'user' = front (selfie), 'environment' = back.
  const [facingMode, setFacingMode] = useState('user')

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [])

  const startCamera = useCallback(
    async (facing = facingMode) => {
      stopStream()
      setErrorKind(null)

      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraState('error')
        setErrorKind('unavailable')
        return
      }

      setCameraState('requesting')
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing } },
          audio: false,
        })
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        setCameraState('active')
      } catch (error) {
        stopStream()
        setCameraState('error')
        setErrorKind(
          error?.name === 'NotAllowedError' || error?.name === 'SecurityError'
            ? 'denied'
            : 'unavailable',
        )
      }
    },
    [stopStream, facingMode],
  )

  // Flip between the front and back camera (mainly for mobile phones).
  const handleFlipCamera = () => {
    const next = facingMode === 'user' ? 'environment' : 'user'
    setFacingMode(next)
    startCamera(next)
  }

  // Camera permission is requested only when the employee enters this screen,
  // and the stream is released as soon as they leave it.
  useEffect(() => {
    if (!faceImage) {
      startCamera()
    }
    return stopStream
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleCapture = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return

    const imageDataUrl = captureFrame(video)

    stopStream()
    onCapture(imageDataUrl)
    setCameraState('captured')
  }

  const handleRetake = () => {
    onCapture(null)
    startCamera()
  }

  return (
    <section className="card">
      <p className="step-eyebrow">Step 2 of 4</p>
      <h2 className="step-title">Face enrollment</h2>
      <p className="step-description">
        Take a clear photo of your face. It will be used to verify your
        identity when you record attendance.
      </p>

      {cameraState === 'error' ? (
        <div className="camera-error" role="alert">
          <span className="error-icon" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path
                d="M23 7l-7 5 7 5V7z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <rect
                x="1"
                y="5"
                width="15"
                height="14"
                rx="2"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path d="M2 2l20 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
          <h3>
            {errorKind === 'denied'
              ? 'Camera permission denied'
              : 'Camera unavailable'}
          </h3>
          <p>
            {errorKind === 'denied'
              ? 'Face enrollment is required to register. Please allow camera access in your browser settings, then try again.'
              : 'We could not access a camera on this device. If you are on a device without a camera, please complete registration on a phone or computer that has one.'}
          </p>
          <button
            type="button"
            className="btn btn-outline"
            onClick={startCamera}
          >
            Try Again
          </button>
        </div>
      ) : (
        <>
          <div className="camera-frame">
            {cameraState === 'captured' && faceImage ? (
              <img src={faceImage} alt="Captured face" />
            ) : (
              <>
                <video ref={videoRef} playsInline muted autoPlay />
                {cameraState === 'active' && (
                  <div className="face-guide-oval" aria-hidden="true" />
                )}
                {cameraState === 'requesting' && (
                  <div className="camera-placeholder">
                    <span className="btn-spinner" aria-hidden="true" />
                    Requesting camera permission…
                  </div>
                )}
              </>
            )}
          </div>

          <div className="camera-controls">
            {cameraState === 'active' && (
              <>
                <button
                  type="button"
                  className="btn btn-primary capture-btn"
                  onClick={handleCapture}
                >
                  <span className="shutter" aria-hidden="true" />
                  Capture Photo
                </button>
                <button
                  type="button"
                  className="btn btn-outline flip-camera-btn"
                  onClick={handleFlipCamera}
                  aria-label={`Switch to ${facingMode === 'user' ? 'back' : 'front'} camera`}
                  title={`Switch to ${facingMode === 'user' ? 'back' : 'front'} camera`}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M21 12a9 9 0 1 1-2.64-6.36"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M21 3v6h-6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {facingMode === 'user' ? 'Back camera' : 'Front camera'}
                </button>
              </>
            )}
            {cameraState === 'captured' && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleRetake}
              >
                Retake Photo
              </button>
            )}
          </div>
        </>
      )}

      <ul className="instructions-list">
        {CAMERA_TIPS.map((tip) => (
          <li key={tip}>
            <svg
              className="tip-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M22 11.08V12a10 10 0 1 1-5.93-9.14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M22 4L12 14.01l-3-3"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>{tip}</span>
          </li>
        ))}
      </ul>

      <div className="privacy-notice">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>
          <strong>Privacy notice:</strong> your face photo is used only for
          attendance identity verification. It is stored privately and checked
          by our face recognition provider, Amazon Web Services, outside Ghana.
        </span>
      </div>
    </section>
  )
}
