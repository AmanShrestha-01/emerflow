// Shared login helpers. The session itself lives in sessionStorage (see deepchart/portalApi.js).
import { saveSession } from '../deepchart/portalApi.js'

export const HOME = 'Johns Hopkins Hospital'

// The role picks the screen: doctors land in DeepChart, commanders on the board. A requested page (`next`,
// e.g. a deep link to one patient's chart) is kept only when it belongs to that role's screen.
export function landing(session, next) {
  const isDoctorPage = (next || '').startsWith('/doctor')
  if (session.role === 'doctor') return isDoctorPage ? next : '/doctor'
  return next && !isDoctorPage && next !== '/login' ? next : '/'
}

export function logout() {
  saveSession(null)
  window.location.assign('/')
}
