import { useEffect, useState } from 'react'
import { canPromptInstall, isInstalled, isIos, onInstallChange, promptInstall } from '../../utils/installPrompt'

/**
 * Offers to install the app on the phone's home screen: a button on Android,
 * Share-menu steps on iPhone. Hidden once the app is installed, or on
 * browsers that cannot install it.
 */
export default function InstallAppCard() {
  const [, rerender] = useState(0)
  const [hidden, setHidden] = useState(() => isInstalled())
  useEffect(() => onInstallChange(() => rerender((n) => n + 1)), [])

  if (hidden) return null
  const ios = isIos()
  if (!ios && !canPromptInstall()) return null

  return (
    <div className="install-card" role="region" aria-label="Install the app">
      <img src="/icons/icon-192.png" alt="" width="44" height="44" className="install-card-icon" />
      <div className="install-card-text">
        <strong>Install the Attendance app</strong>
        {ios ? (
          <span>
            In Safari, tap <b>Share</b> <ShareIcon /> then <b>Add to Home Screen</b>.
          </span>
        ) : (
          <span>Add it to your home screen to open it like any other app.</span>
        )}
      </div>
      {!ios && (
        <button
          type="button"
          className="btn btn-primary install-card-btn"
          onClick={async () => { if ((await promptInstall()) === 'accepted') setHidden(true) }}
        >
          Install
        </button>
      )}
    </div>
  )
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-label="(the square with an arrow)" role="img" style={{ verticalAlign: '-2px' }}>
      <path d="M12 3v12M8 7l4-4 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 11H5v10h14V11h-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
