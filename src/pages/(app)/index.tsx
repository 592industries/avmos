import { useState, type ReactNode } from 'react'
import { getAuthToken, useAuthProfileReady, useQuery } from 'deepspace'
import { ArrowRight, Play, ShieldX } from 'lucide-react'
import { Button, Input } from '@/components/ui'
import './home.css'

type Resource = {
  hostname: string
  status: string
  telemetryStatus: 'LIVE' | 'STALE' | 'OFFLINE' | 'UNAVAILABLE' | 'ERROR' | 'DEMO'
  telemetrySource: 'newrelic' | 'demo'
  sourceEntityId?: string
  metrics: { storageUtilization?: number; storageTotalGb?: number; storageUsedGb?: number }
  trendPoints?: Array<{ timestamp: string; value: number }>
  lastObservedAt: string
  lastQueryAt?: string
}
type Policy = { id: string; version: string; enabled: boolean; maxTransactionAmount: number; dailyBudget: number; maxTelemetryAgeSeconds?: number; allowedVendors: string[]; allowedActions: string[] }
type Action = {
  actionIntent: { amount?: number; currency?: string; vendor?: string; reason?: string }
  policyDecision: { decision: 'APPROVED' | 'DENIED'; reason: string; checks: Array<{ name: string; passed: boolean; detail: string }> }
  executionStatus: string
  execution?: { transactionHash?: string; mode?: 'SIMULATED' | 'TESTNET' }
  policyHash?: string
  auditStatus?: string
  createdAt: string
}
type Audit = { timestamp: string; actor: string; eventType: string; actionId: string; transactionHash?: string }

const PIPELINE = ['OBSERVE', 'VERIFY', 'REASON', 'PROPOSE', 'AUTHORIZE', 'OPERATE', 'AUDIT']

export default function HomePage() {
  const { isSignedIn, user } = useAuthProfileReady({ requireUser: true })
  const resources = useQuery<Resource>('resources', { limit: 20 })
  const policies = useQuery<Policy>('policies', { limit: 10 })
  const actions = useQuery<Action>('actions', { orderBy: 'createdAt', orderDir: 'desc', limit: 20 })
  const audits = useQuery<Audit>('audit-events', { orderBy: 'timestamp', orderDir: 'desc', limit: 80 })
  const agents = useQuery<{ status: string; modelProvider: string; lastRunAt: string }>('agents', { limit: 10 })
  const [running, setRunning] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [asking, setAsking] = useState(false)
  const [includeResearch, setIncludeResearch] = useState(false)
  const resource = resources.records.find((record) => record.recordId === 'avmos')?.data
  const activePolicies = policies.records.filter((record) => record.data.enabled)
  const policy = activePolicies.length === 1 ? activePolicies[0].data : undefined
  const action = actions.records[0]?.data
  const status = resource ? observedStatus(resource) : 'UNAVAILABLE'
  const researchEvent = audits.records.find((record) => record.data.eventType.startsWith('RESEARCH_'))?.data
  const isAdmin = user?.role === 'admin'

  async function invoke(name: string, body: Record<string, unknown>, financial = false) {
    const token = await getAuthToken()
    if (!token) throw new Error('Sign in to use the operator console.')
    const response = await fetch(`/api/actions/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(financial ? { 'Idempotency-Key': crypto.randomUUID() } : {}) },
      body: JSON.stringify(body),
    })
    const result = await response.json() as { success?: boolean; error?: string | { message?: string }; data?: Record<string, unknown> }
    if (!response.ok || !result.success) throw new Error(typeof result.error === 'string' ? result.error : result.error?.message ?? 'Operation failed.')
    return result.data ?? {}
  }

  async function run(mode: 'live' | 'demo-approved' | 'demo-denied') {
    setRunning(mode)
    setNotice('')
    try {
      const result = await invoke('runAgentCycle', { mode, research: includeResearch }, true)
      setNotice(`${String(result.decision)} · ${String(result.executionStatus)}${result.simulation ? ' · SIMULATED SETTLEMENT' : ''}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setNotice(/Grok|reasoning|model/i.test(message) ? `REASONING UNAVAILABLE · ${message}` : /XRPL|settlement|ledger/i.test(message) ? `SETTLEMENT UNAVAILABLE · ${message}` : message)
    }
    finally { setRunning(null) }
  }

  async function ask() {
    if (!question.trim()) return
    setAsking(true)
    try { setAnswer(String((await invoke('askOperator', { question })).answer ?? 'NO DATA')) }
    catch (error) { setAnswer(error instanceof Error ? error.message : String(error)) }
    finally { setAsking(false) }
  }

  return <div className="avmos-page">
    <div className="avmos-wrap">
      <header className="avmos-hero">
        <div className="avmos-eyebrow">MISSION CONTROL / TARGET AVMOS <span>01 — ACTIVE WORKSPACE</span></div>
        <div className="avmos-hero-main">
          <div><p className="avmos-kicker">AUTONOMOUS VERIFICATION, MONITORING & OPERATIONS SYSTEM</p><h1>AVMOS<span className="avmos-mark">/</span></h1><p className="avmos-descriptor">Autonomous infrastructure operations with governed execution.</p></div>
          <div className="avmos-hero-status"><span className={`avmos-status-dot ${status === 'LIVE' ? 'is-live' : ''}`} /><div><span className="avmos-label">TELEMETRY MODE</span><strong>{status}</strong><small>{resource?.telemetrySource === 'demo' ? 'SIMULATED TELEMETRY' : 'NEW RELIC / AVMOS'}</small></div></div>
        </div>
      </header>

      <section className="avmos-status-grid" aria-label="Service status">
        <Status label="TARGET / SOURCE" value="avmos" detail={resource?.telemetrySource === 'demo' ? 'DEMO DATA' : 'NEW RELIC'} />
        <Status label="STORAGE / THRESHOLD" value={resource?.metrics.storageUtilization !== undefined && status !== 'UNAVAILABLE' && status !== 'ERROR' ? `${resource.metrics.storageUtilization.toFixed(1)}% / 80%` : 'NO CURRENT DATA'} detail="WARNING 75% · CRITICAL 90%" />
        <Status label="TREND" value={trendPerHour(resource?.trendPoints)} detail="VERIFIED STORAGE HISTORY" />
        <Status label="AGENT" value={agents.records[0]?.data.status ?? 'NO RUN'} detail={agents.records[0]?.data.modelProvider?.toUpperCase() ?? 'REASONING UNAVAILABLE'} />
        <Status label="RESEARCH" value={researchEvent?.eventType.replace('RESEARCH_', '') ?? 'NOT REQUESTED'} detail="TAVILY / OPTIONAL" />
        <Status label="AUTHORIZATION" value={policy ? 'POLICY ACTIVE' : 'POLICY UNAVAILABLE'} detail={policy?.version ?? 'CONFIGURATION REQUIRED'} />
        <Status label="SETTLEMENT" value={action?.executionStatus ?? 'NO OPERATION'} detail={action?.execution?.mode === 'TESTNET' ? 'XRPL TESTNET' : action?.execution?.mode === 'SIMULATED' ? 'SIMULATED' : 'NO SETTLEMENT'} />
        <Status label="AUDIT TRAIL" value={audits.records.length ? `${audits.records.length} EVENTS` : 'NO EVENTS'} detail="DEEPSPACE RECORDS" />
      </section>

      <div className="avmos-columns">
        <div className="avmos-main-column">
          <Panel number="01" title="Infrastructure telemetry" aside={resource?.telemetrySource === 'newrelic' ? 'NEW RELIC / LIVE SOURCE' : resource?.telemetrySource === 'demo' ? 'DEMO MODE' : 'NO DATA'}>
            <div className="avmos-telemetry">
              <div><span className="avmos-label">MONITORED RESOURCE</span><h2>avmos</h2><p>{resource?.lastObservedAt && Date.parse(resource.lastObservedAt) > 0 ? `LAST SUCCESSFUL OBSERVATION ${formatTime(resource.lastObservedAt)}` : 'No infrastructure observation has been recorded.'}</p><p className="avmos-source">{status === 'STALE' ? 'AUTHORIZATION PAUSED UNTIL FRESH EVIDENCE' : status === 'ERROR' || status === 'UNAVAILABLE' ? 'TELEMETRY UNAVAILABLE — NO LIVE ACTION' : resource?.sourceEntityId ? `ENTITY ${resource.sourceEntityId}` : resource?.telemetrySource === 'demo' ? 'SIMULATED EVIDENCE' : 'SOURCE UNAVAILABLE'}</p></div>
              <div className="avmos-util"><span className="avmos-label">STORAGE UTILIZATION</span><strong>{resource?.metrics.storageUtilization !== undefined && status !== 'UNAVAILABLE' && status !== 'ERROR' ? `${resource.metrics.storageUtilization.toFixed(1)}%` : 'NO CURRENT DATA'}</strong><div className="avmos-meter" role="meter" aria-label="Storage utilization" aria-valuemin={0} aria-valuemax={100} aria-valuenow={status === 'LIVE' || status === 'DEMO' ? resource?.metrics.storageUtilization : undefined}><span style={{ width: `${status === 'LIVE' || status === 'DEMO' ? resource?.metrics.storageUtilization ?? 0 : 0}%` }} /></div><small>{resource?.metrics.storageUsedGb !== undefined && resource.metrics.storageTotalGb !== undefined ? `${resource.metrics.storageUsedGb.toFixed(1)} / ${resource.metrics.storageTotalGb.toFixed(1)} GB` : 'CAPACITY DATA UNAVAILABLE'}</small></div>
            </div>
            <Trend points={resource?.trendPoints} />
          </Panel>

          <Panel number="02" title="Operation pipeline" aside="DETERMINISTIC BOUNDARY">
            <div className="avmos-pipeline">{PIPELINE.map((step, index) => <div className="avmos-step" key={step}><span>{String(index + 1).padStart(2, '0')}</span><strong>{step}</strong>{index < PIPELINE.length - 1 && <ArrowRight aria-hidden="true" size={14} />}</div>)}</div>
            <p className="avmos-rule">Grok proposes an action. Deterministic policy authorizes it. The protected executor alone can sign and submit a settlement.</p>
            <label className="avmos-research-option"><input type="checkbox" checked={includeResearch} onChange={(event) => setIncludeResearch(event.target.checked)} /> Consult Tavily for current remediation guidance during this run</label>
            <div className="avmos-controls"><Button onClick={() => run('live')} disabled={!isSignedIn || !isAdmin || running !== null}><Play size={16} />{running === 'live' ? 'EXECUTING…' : 'EXECUTE OPERATION'}</Button><Button variant="outline" onClick={() => run('demo-approved')} disabled={!isSignedIn || !isAdmin || running !== null}><Play size={16} />DEMO APPROVED / 129 RLUSD</Button><Button variant="outline" onClick={() => run('demo-denied')} disabled={!isSignedIn || !isAdmin || running !== null}><ShieldX size={16} />DEMO DENIAL / 700 RLUSD</Button></div>
            {notice && <p className="avmos-notice" role="status">{notice}</p>}
          </Panel>

          <Panel number="03" title="Audit timeline" aside={`${audits.records.length} RECORDED EVENTS`}>
            {audits.records.length === 0 ? <Empty>No audit events recorded.</Empty> : <ol className="avmos-timeline">{audits.records.map((record) => <li key={record.recordId}><span className="avmos-timeline-point" /><div><strong>{record.data.eventType}</strong><small>{formatTime(record.data.timestamp)}</small><p>{record.data.actor} · {record.data.actionId}</p>{record.data.transactionHash && <code>{record.data.transactionHash}</code>}</div></li>)}</ol>}
          </Panel>
        </div>

        <aside className="avmos-side-column">
          <Panel number="04" title="Authorization policy" aside={policy?.version ?? 'UNAVAILABLE'}>
            {policy ? <><div className="avmos-policy-metrics"><Metric label="TRANSACTION LIMIT" value={`${policy.maxTransactionAmount} RLUSD`} /><Metric label="DAILY BUDGET" value={`${policy.dailyBudget} RLUSD`} /><Metric label="MAX EVIDENCE AGE" value={`${policy.maxTelemetryAgeSeconds ?? 120} SECONDS`} /><Metric label="APPROVED VENDORS" value={String(policy.allowedVendors.length)} /></div><p className="avmos-footnote">The server evaluates the policy and reserves budget before any executor call.</p></> : <Empty>Exactly one active policy is required for live execution.</Empty>}
          </Panel>
          <Panel number="05" title="Latest operation" aside={action?.executionStatus ?? 'NO OPERATION'}>
            {action ? <div className="avmos-operation"><div className="avmos-operation-value"><span>{action.actionIntent.vendor ?? 'UNSPECIFIED VENDOR'}</span><strong>{action.actionIntent.amount ?? '—'} {action.actionIntent.currency ?? ''}</strong></div><p className={`avmos-decision ${action.policyDecision.decision === 'APPROVED' ? 'approved' : 'denied'}`}>{action.policyDecision.decision}</p><p>{action.policyDecision.reason}</p><div className="avmos-checks">{action.policyDecision.checks?.map((check) => <div key={check.name}><span>{check.passed ? 'PASS' : 'FAIL'}</span>{check.name.replaceAll('_', ' ').toUpperCase()}</div>)}</div>{action.execution?.transactionHash && <code className="avmos-hash">{action.execution.transactionHash}</code>}{action.auditStatus === 'PENDING' && <p className="avmos-warning">Audit persistence pending. Do not retry this operation.</p>}</div> : <Empty>No operation has been proposed.</Empty>}
          </Panel>
          <Panel number="06" title="Operator console" aside="READ ONLY"><label htmlFor="avmos-question" className="avmos-label">ASK ABOUT RECORDED STATE</label><div className="avmos-question"><Input id="avmos-question" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void ask() }} placeholder="Why was the last operation denied?" /><Button onClick={ask} disabled={asking || !isSignedIn} aria-label="Ask operator console"><ArrowRight size={16} /></Button></div>{answer && <p className="avmos-answer" role="status">{answer}</p>}</Panel>
        </aside>
      </div>
    </div>
  </div>
}

function Panel({ number, title, aside, children }: { number: string; title: string; aside: string; children: ReactNode }) {
  return <section className="avmos-panel"><header><div><span>{number} /</span><h2>{title}</h2></div><small>{aside}</small></header><div className="avmos-panel-body">{children}</div></section>
}

function Status({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="avmos-status"><span className="avmos-label">{label}</span><strong>{value}</strong><small>{detail}</small></div>
}

function Metric({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div> }
function Empty({ children }: { children: ReactNode }) { return <p className="avmos-empty">{children}</p> }
function formatTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'UNKNOWN TIME' : date.toLocaleString() }
function trendPerHour(points?: Array<{ timestamp: string; value: number }>): string {
  if (!points || points.length < 2) return 'NO DATA'
  const latest = points.at(-1)!
  const previous = points.at(-2)!
  const hours = (Date.parse(latest.timestamp) - Date.parse(previous.timestamp)) / 3_600_000
  if (!Number.isFinite(hours) || hours <= 0) return 'NO DATA'
  const rate = (latest.value - previous.value) / hours
  return `${rate >= 0 ? '+' : ''}${rate.toFixed(1)}% / HOUR`
}
function observedStatus(resource: Resource) {
  if (resource.telemetrySource === 'demo') return 'DEMO'
  if (resource.telemetryStatus === 'ERROR' || resource.telemetryStatus === 'UNAVAILABLE') return resource.telemetryStatus
  const age = Date.now() - Date.parse(resource.lastObservedAt)
  if (!Number.isFinite(age) || age > 600_000) return 'UNAVAILABLE'
  if (age > 120_000) return 'STALE'
  return resource.telemetryStatus
}
function Trend({ points }: { points?: Array<{ timestamp: string; value: number }> }) {
  if (!points || points.length < 2) return <div className="avmos-trend-empty">HISTORICAL TELEMETRY UNAVAILABLE</div>
  const sample = points.slice(-24)
  const path = sample.map((point, index) => `${index === 0 ? 'M' : 'L'} ${(index / (sample.length - 1)) * 100} ${100 - point.value}`).join(' ')
  return <div className="avmos-trend"><div><span className="avmos-label">STORAGE TREND</span><small>{sample.length} VERIFIED SAMPLES</small></div><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`Storage trend from ${sample[0].value}% to ${sample.at(-1)?.value}%`}><path d={path} fill="none" stroke="currentColor" strokeWidth="1.2" vectorEffect="non-scaling-stroke" /></svg><div><small>{formatTime(sample[0].timestamp)}</small><small>{formatTime(sample.at(-1)!.timestamp)}</small></div></div>
}
