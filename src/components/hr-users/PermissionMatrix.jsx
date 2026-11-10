import { LEVELS, LEVEL_LABELS, MODULES, ROLES } from '../../services/permissionsService'

/**
 * Module × level grid. Editable cells are limited to the role's ceiling;
 * levels a module does not have show as "—", and levels above the role's
 * ceiling are locked.
 */
export default function PermissionMatrix({ roleId, grants, onChange, readOnly = false }) {
  const ceiling = ROLES[roleId]?.ceiling ?? {}
  const toggle = (moduleId, level) => {
    const current = grants[moduleId] ?? []
    let next = current.includes(level) ? current.filter((l) => l !== level) : [...current, level]
    // Turning off View turns the whole module off; turning anything on adds View.
    if (level === 'view' && !next.includes('view')) next = []
    if (level !== 'view' && next.includes(level) && !next.includes('view')) next = ['view', ...next]
    onChange({ ...grants, [moduleId]: next })
  }
  return (
    <div className="pm-wrap">
      <table className="pm-table">
        <caption className="sr-only">Permissions for {ROLES[roleId]?.label}</caption>
        <thead>
          <tr>
            <th scope="col">Module</th>
            {LEVELS.map((l) => <th scope="col" key={l}>{LEVEL_LABELS[l]}</th>)}
          </tr>
        </thead>
        <tbody>
          {MODULES.map((m) => (
            <tr key={m.id}>
              <th scope="row">{m.label}</th>
              {LEVELS.map((l) => {
                if (!m.levels.includes(l)) return <td key={l} className="pm-na" aria-label="Not applicable">—</td>
                const allowed = (ceiling[m.id] ?? []).includes(l)
                const on = (grants[m.id] ?? []).includes(l)
                if (readOnly || !allowed) {
                  return (
                    <td key={l} className={on ? 'pm-on' : allowed ? 'pm-off' : 'pm-locked'}>
                      <span aria-label={on ? 'Granted' : allowed ? 'Not granted' : 'Not available for this role'}>
                        {on ? '✓' : allowed ? '' : 'Locked'}
                      </span>
                    </td>
                  )
                }
                return (
                  <td key={l} className="pm-edit">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(m.id, l)}
                      aria-label={`${m.label}: ${LEVEL_LABELS[l]}`}
                      disabled={m.id === 'dashboard'}
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
