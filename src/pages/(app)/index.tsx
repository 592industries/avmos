import { useAuthStatus } from 'deepspace'
import { ArrowDown, ArrowRight, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import './home.css'

export default function LandingPage() {
  const { isLoaded, isSignedIn } = useAuthStatus()
  const consoleHref = isLoaded && isSignedIn ? '/dashboard' : '/sign-in?next=/dashboard'
  return <main className="landing">
    <section className="mission-hero">
      <div>
        <p className="landing-section-label">AVMOS / AUTONOMOUS VERIFICATION, MONITORING &amp; OPERATIONS SYSTEM</p>
        <h1>Autonomous Verification, Monitoring &amp; Operations System</h1>
        <p>AVMOS turns live infrastructure telemetry into governed operational action, with deterministic policy between AI reasoning and execution.</p>
        <div className="landing-actions">
          <Link className="landing-primary" to={consoleHref}>OPEN CONSOLE <ArrowRight size={16}/></Link>
          <a className="landing-secondary" href="#operation">SEE HOW IT WORKS</a>
        </div>
      </div>
      <div className="system-snapshot">
        <header><span>AUTHORITY BOUNDARY</span></header>
        <dl>
          <div><dt>Model</dt><dd>Proposes</dd></div>
          <div><dt>Policy</dt><dd>Authorizes</dd></div>
          <div><dt>Executor</dt><dd>Executes</dd></div>
          <div><dt>Audit</dt><dd>Records</dd></div>
        </dl>
        <small>No model can authorize or sign a transaction.</small>
      </div>
    </section>
    <section className="editorial-section problem">
      <p className="landing-section-label">THE OPERATIONS GAP</p>
      <h2>Detection is only the beginning.</h2>
      <div className="before-after">
        <div><span>TRADITIONAL</span><p>Detect → Human → Decide → Execute → Verify</p></div>
        <div><span>AVMOS</span><p>Observe → Verify → Reason → Govern → Execute → Audit</p></div>
      </div>
    </section>
    <section id="operation" className="editorial-section operation">
      <p className="landing-section-label">GOVERNED OPERATION</p>
      <h2>One condition. One explicit chain of authority.</h2>
      <div className="operation-sequence">
        {['OBSERVE — New Relic supplies live evidence', 'VERIFY — AVMOS checks identity and freshness', 'REASON — Grok returns a structured proposal', 'GOVERN — deterministic policy approves or denies', 'EXECUTE — only approved intent reaches the protected provider', 'AUDIT — every transition is recorded'].map((step, index) => <div key={step}><span>{String(index + 1).padStart(2, '0')}</span><strong>{step}</strong>{index < 5 && <ArrowDown/>}</div>)}
      </div>
    </section>
    <section className="editorial-section trust">
      <p className="landing-section-label">TRUST BOUNDARY</p>
      <h2>AI can propose an action.<br/>It cannot authorize itself.</h2>
      <div className="authority-chain">
        <div><span>GROK</span><strong>Proposal</strong></div><ArrowRight/>
        <div><span>POLICY ENGINE</span><strong>Authority</strong></div><ArrowRight/>
        <div><span>PROTECTED EXECUTOR</span><strong>Execution</strong></div>
      </div>
      <p><ShieldCheck/> Every boundary is explicit, deterministic, and auditable.</p>
    </section>
    <section className="final-cta"><p>AVMOS</p><h2>Infrastructure that can act<br/>without granting AI authority.</h2><Link className="landing-primary" to={consoleHref}>OPEN CONSOLE <ArrowRight size={16}/></Link></section>
  </main>
}
