import { useMemo, useState } from 'react'
import RepTable from '../components/sales-monitoring/RepTable'
import RepProfileModal from '../components/sales-monitoring/RepProfileModal'
import AlertsPanel from '../components/sales-monitoring/AlertsPanel'
import ShopsPanel from '../components/sales-monitoring/ShopsPanel'
import ShopModal from '../components/sales-monitoring/ShopModal'
import LiveFieldBoard from '../components/sales-monitoring/LiveFieldBoard'
import '../styles/attendance.css'
import { REP_STATUS } from '../components/sales-monitoring/labels'
import {
  mockGetAlerts,
  mockGetMonitoringOverview,
  mockGetRepresentativeDetail,
  mockListFieldStaff,
} from '../services/salesMonitoringService'
import { mockListShops } from '../services/shopsService'
import { DIGITAL_GO_LIVE_DATE } from '../utils/attendanceRules'
import '../styles/sales-monitoring.css'
import { can } from '../constants/hrUser'

function todayKey(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Sales Representative Monitoring — field attendance, assigned shops and
 * attendance verification activity. Mock-backed; shows only historical
 * verification events, never future schedules.
 */
export default function SalesMonitoring({ company, user }) {
  const canSeeShops = can(user, 'shops', 'view')
  const canAssignShops = can(user, 'shops', 'edit')
  const canReviewAlerts = can(user, 'notifications', 'edit')
  const [tab, setTab] = useState('reps')
  const [date, setDate] = useState(todayKey())
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [shopFilter, setShopFilter] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  const [profile, setProfile] = useState(null) // { detail, section }
  const [shopView, setShopView] = useState(null)

  const refresh = () => setRefreshKey((k) => k + 1)

  const overview = useMemo(
    () => mockGetMonitoringOverview({ companyId: company.id, date }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [company.id, date, refreshKey],
  )

  const alerts = useMemo(
    () => mockGetAlerts({ companyId: company.id, date }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [company.id, date, refreshKey],
  )

  const shops = useMemo(
    () => mockListShops(company.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [company.id, refreshKey],
  )

  const reps = useMemo(
    () => mockListFieldStaff(company.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [company.id, refreshKey],
  )

  const filteredReps = useMemo(() => {
    const term = search.trim().toLowerCase()
    return overview.reps.filter((rep) => {
      if (statusFilter && rep.day.status !== statusFilter) return false
      if (shopFilter && rep.assignedShopId !== shopFilter) return false
      if (
        term &&
        !rep.fullName.toLowerCase().includes(term) &&
        !rep.employeeId.toLowerCase().includes(term) &&
        !rep.phoneNumber.toLowerCase().includes(term)
      ) {
        return false
      }
      return true
    })
  }, [overview.reps, search, statusFilter, shopFilter])

  // Statistics respond to the active filters and date.
  const stats = useMemo(() => {
    return {
      total: filteredReps.length,
      verifiedOnDuty: filteredReps.filter((r) => r.day.status === 'on-duty-verified').length,
      awaiting: filteredReps.filter((r) => r.day.status === 'awaiting-verification').length,
      missedChecks: filteredReps.reduce((sum, r) => sum + r.day.missedCount, 0),
      locationExceptions: filteredReps.reduce(
        (sum, r) => sum + r.day.events.filter((e) => e.result === 'outside-shop').length,
        0,
      ),
      faceFailures: filteredReps.reduce(
        (sum, r) => sum + r.day.events.filter((e) => e.result === 'failed-face').length,
        0,
      ),
    }
  }, [filteredReps])

  const openAlerts = alerts.filter((a) => a.status !== 'resolved').length

  const openProfile = (rep, section = 'details') => {
    setProfile({ detail: mockGetRepresentativeDetail(rep.employeeId, date), section })
  }

  const openShopForRep = (rep) => {
    setShopView(rep.shop ?? null)
  }

  return (
    <div className="sm-page">
      <div className="sm-head">
        <div>
          <h2>Sales Representative Monitoring</h2>
          <p>
            Monitor field attendance, assigned shops and attendance verification
            activities.
          </p>
        </div>
      </div>

      <div className="sm-tabs" role="tablist" aria-label="Monitoring sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'live'}
          className={`sm-tab${tab === 'live' ? ' is-active' : ''}`}
          onClick={() => setTab('live')}
        >
          Live field board
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'reps'}
          className={`sm-tab${tab === 'reps' ? ' is-active' : ''}`}
          onClick={() => setTab('reps')}
        >
          Representatives
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'alerts'}
          className={`sm-tab${tab === 'alerts' ? ' is-active' : ''}`}
          onClick={() => setTab('alerts')}
        >
          Alerts
          {openAlerts > 0 && <span className="sm-tab-count">{openAlerts}</span>}
        </button>
        {canSeeShops && <button
          type="button"
          role="tab"
          aria-selected={tab === 'shops'}
          className={`sm-tab${tab === 'shops' ? ' is-active' : ''}`}
          onClick={() => setTab('shops')}
        >
          Assigned Shops
        </button>}
      </div>

      {tab === 'live' && (
        <LiveFieldBoard
          company={company}
          onViewRep={(r) => setProfile({ detail: mockGetRepresentativeDetail(r.employeeId, todayKey()), section: 'history' })}
        />
      )}

      {tab !== 'live' && <div className="sm-controls">
        <input
          type="date"
          className="form-input"
          value={date}
          min={DIGITAL_GO_LIVE_DATE}
          max={todayKey()}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Monitoring date"
        />
        {tab === 'reps' && (
          <>
            <input
              type="search"
              className="form-input sm-search"
              placeholder="Search name, ID or phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search representatives"
            />
            <select
              className="sm-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by verification status"
            >
              <option value="">All statuses</option>
              {Object.entries(REP_STATUS).map(([id, s]) => (
                <option key={id} value={id}>
                  {s.label}
                </option>
              ))}
            </select>
            <select
              className="sm-select"
              value={shopFilter}
              onChange={(e) => setShopFilter(e.target.value)}
              aria-label="Filter by assigned shop"
            >
              <option value="">All shops</option>
              {shops.map((shop) => (
                <option key={shop.shopId} value={shop.shopId}>
                  {shop.shopName}
                </option>
              ))}
            </select>
          </>
        )}
      </div>}

      {tab === 'reps' && (
        <>
          <div className="sm-stats" role="status" aria-label="Monitoring summary">
            <div className="sm-stat">
              <span className="sm-stat-label">Total Sales Representatives</span>
              <span className="sm-stat-value">{stats.total}</span>
            </div>
            <div className="sm-stat">
              <span className="sm-stat-label">Verified On Duty</span>
              <span className="sm-stat-value sm-stat-ok">{stats.verifiedOnDuty}</span>
            </div>
            <div className="sm-stat">
              <span className="sm-stat-label">Awaiting Verification</span>
              <span className="sm-stat-value sm-stat-accent">{stats.awaiting}</span>
            </div>
            <div className="sm-stat">
              <span className="sm-stat-label">Missed Verification Checks</span>
              <span className="sm-stat-value sm-stat-warn">{stats.missedChecks}</span>
            </div>
            <div className="sm-stat">
              <span className="sm-stat-label">Location Exceptions</span>
              <span className="sm-stat-value sm-stat-crit">{stats.locationExceptions}</span>
            </div>
            <div className="sm-stat">
              <span className="sm-stat-label">Face Verification Failures</span>
              <span className="sm-stat-value sm-stat-crit">{stats.faceFailures}</span>
            </div>
          </div>

          <section className="sm-panel">
            <div className="sm-panel-head">
              <h3>Field representatives — {company.name}</h3>
              <span className="sm-muted">
                {filteredReps.length} of {overview.reps.length} shown
              </span>
            </div>
            <RepTable
              reps={filteredReps}
              onViewDetails={(rep) => openProfile(rep, 'details')}
              onViewHistory={(rep) => openProfile(rep, 'history')}
              onViewShop={openShopForRep}
            />
          </section>
        </>
      )}

      {tab === 'alerts' && (
        <section className="sm-panel">
          <div className="sm-panel-head">
            <h3>Alerts and exceptions — {company.name}</h3>
            <span className="sm-muted">
              {openAlerts} open · {alerts.length} total
            </span>
          </div>
          <AlertsPanel alerts={alerts} onRefresh={refresh} canReview={canReviewAlerts} />
        </section>
      )}

      {tab === 'shops' && canSeeShops && (
        <section className="sm-panel">
          <div className="sm-panel-head">
            <h3>Assigned shops — {company.name}</h3>
            <span className="sm-muted">{shops.length} shops</span>
          </div>
          <ShopsPanel
            shops={shops}
            reps={reps}
            onChanged={refresh}
            canAssign={canAssignShops}
            onViewShop={setShopView}
          />
        </section>
      )}

      {profile && (
        <RepProfileModal
          detail={profile.detail}
          initialSection={profile.section}
          onClose={() => setProfile(null)}
        />
      )}

      {shopView && (
        <ShopModal
          shop={shopView}
          reps={reps}
          companyName={company.name}
          onClose={() => setShopView(null)}
        />
      )}
    </div>
  )
}
