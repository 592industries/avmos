/**
 * Landing page — a STATIC page.
 *
 * It lives at the top level of src/pages/ (not under (app)/), so it renders
 * with no DeepSpace providers: no auth session fetch, no records WebSocket.
 * That makes it cheap to serve and safe for logged-out / crawler traffic.
 *
 * Need live data or auth here? Move this file to src/pages/(app)/index.tsx
 * and it becomes a dynamic page. Conversely, any page you want to keep static
 * (marketing, docs, legal) belongs at this top level.
 */

import { Link } from 'react-router-dom'
import { APP_NAME } from '../constants'
import './landing.css'

export default function Landing() {
  return (
    <main data-testid="static-landing" className="avmos-landing">
      <div className="avmos-landing-shell">
        <header><span>AVMOS / SYSTEM 01</span><span>AUTONOMOUS OPERATIONS</span></header>
        <div className="avmos-landing-content">
          <p>AUTONOMOUS VERIFICATION, MONITORING & OPERATIONS SYSTEM</p>
          <h1>{APP_NAME}<span>/</span></h1>
          <div className="avmos-landing-intro"><div className="avmos-landing-rule" /><div><h2>Observe. Verify. Operate.</h2><p>Autonomous infrastructure operations with governed execution. Every proposal is checked against deterministic policy before a protected executor can act.</p><Link to="/home">ENTER MISSION CONTROL <span aria-hidden="true">↗</span></Link></div></div>
        </div>
        <footer><span>REAL TELEMETRY</span><span>DETERMINISTIC AUTHORIZATION</span><span>AUDITABLE SETTLEMENT</span></footer>
      </div>
    </main>
  )
}
