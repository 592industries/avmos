import { useMemo, useState, type ReactNode } from 'react'
import { getAuthToken, useAuthProfileReady, useQuery } from 'deepspace'
import {
  Activity,
  Bot,
  CheckCircle2,
  CircleDollarSign,
  HardDrive,
  MessageSquareText,
  Play,
  ShieldCheck,
  ShieldX,
} from 'lucide-react'
import { Button, Input } from '@/components/ui'

type ResourceData = {
  hostname: string
  status: string
  telemetryStatus: string
  metrics: { storageUtilization?: number }
  lastObservedAt: string
}
type PolicyData = {
  version: string
  enabled: boolean
  maxTransactionAmount: number
  dailyBudget: number
  allowedVendors: string[]
  allowedActions: string[]
}
type ActionData = {
  actionIntent: { amount?: number; currency?: string; vendor?: string }
  policyDecision: { decision?: 'APPROVED' | 'DENIED'; reason?: string }
  executionStatus: string
  execution?: { transactionHash?: string }
  createdAt: string
}
type AuditData = {
  timestamp: string
  actor: string
  eventType: string
  actionId: string
  transactionHash?: string
}

export default function HomePage() {
  const { isSignedIn } = useAuthProfileReady({ requireUser: true })
  const resources = useQuery<ResourceData>('resources', { limit: 20 })
  const policies = useQuery<PolicyData>('policies', { limit: 10 })
  const actions = useQuery<ActionData>('actions', { orderBy: 'createdAt', orderDir: 'desc', limit: 20 })
  const audits = useQuery<AuditData>('audit-events', { orderBy: 'timestamp', orderDir: 'desc', limit: 80 })
  const [running, setRunning] = useState<null | 'happy' | 'denial'>(null)
  const [runMessage, setRunMessage] = useState('')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [asking, setAsking] = useState(false)
  const resource = resources.records[0]?.data
  const policy = policies.records.find((record) => record.data.enabled)?.data
  const latestAction = actions.records[0]?.data
  const spent = useMemo(
    () => actions.records.reduce(
      (total, record) => record.data.executionStatus === 'SUCCEEDED'
        ? total + (record.data.actionIntent.amount ?? 0)
        : total,
      0,
    ),
    [actions.records],
  )

  async function invokeAction(name: string, body: Record<string, unknown>) {
    const token = await getAuthToken()
    if (!token) throw new Error('Sign in as the app owner to run operations.')
    const response = await fetch(`/api/actions/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    const result = (await response.json()) as {
      success?: boolean
      error?: string
      data?: Record<string, unknown>
    }
    if (!response.ok || !result.success) throw new Error(result.error ?? 'Operation failed.')
    return result.data ?? {}
  }

  async function run(mode: 'happy' | 'denial') {
    setRunning(mode)
    setRunMessage('')
    try {
      const result = await invokeAction('runAgentCycle', { mode })
      setRunMessage(`${String(result.decision)} · ${String(result.executionStatus)}${result.simulation ? ' · simulated settlement' : ''}`)
    } catch (error) {
      setRunMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setRunning(null)
    }
  }

  async function ask() {
    if (!question.trim()) return
    setAsking(true)
    try {
      const result = await invokeAction('askPhoton', { question })
      setAnswer(String(result.answer ?? 'No answer available.'))
    } catch (error) {
      setAnswer(error instanceof Error ? error.message : String(error))
    } finally {
      setAsking(false)
    }
  }

  return (
    <div className="min-h-full bg-[#070b0f] text-foreground">
      <header className="border-b border-white/8 bg-[#090e13]">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-5 py-5 lg:px-8">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-emerald-400">Autonomous infrastructure operations</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Agent-Monitor Control Plane</h1>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/8 px-3 py-1.5 text-xs text-emerald-300 sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> POLICY BOUNDARY ENFORCED
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] space-y-5 px-5 py-6 lg:px-8">
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatusCard label="Agent" value={latestAction ? 'ONLINE' : 'READY'} icon={Bot} />
          <StatusCard label="LibreNMS" value={resource?.telemetryStatus ?? 'DEMO READY'} icon={Activity} />
          <StatusCard label="Historical" value={resource ? 'CONNECTED' : 'DEMO READY'} icon={HardDrive} />
          <StatusCard label="XRPL Testnet" value={latestAction?.executionStatus === 'SUCCEEDED' ? 'VERIFIED' : 'READY'} icon={CircleDollarSign} />
          <StatusCard label="Policy" value={policy?.enabled ? 'ACTIVE' : 'READY'} icon={ShieldCheck} />
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
          <div className="space-y-5">
            <Panel title="Infrastructure" subtitle="Normalized telemetry · source responses never reach authorization">
              <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Resource</p>
                  <p className="mt-1 text-xl font-semibold">{resource?.hostname ?? 'server1'}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{resource ? `Last observed ${formatTime(resource.lastObservedAt)}` : 'Awaiting first observation'}</p>
                </div>
                <div>
                  <div className="flex items-end justify-between">
                    <span className="text-sm text-muted-foreground">Storage utilization</span>
                    <span className="font-mono text-3xl font-semibold text-amber-300">{resource?.metrics.storageUtilization ?? 91}%</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/8">
                    <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-amber-400 to-red-500" style={{ width: `${resource?.metrics.storageUtilization ?? 91}%` }} />
                  </div>
                  <div className="mt-3 flex justify-between font-mono text-xs text-muted-foreground">
                    {[82, 84, 87, 89, 91].map((value) => <span key={value}>{value}%</span>)}
                  </div>
                </div>
              </div>
            </Panel>

            <Panel title="Autonomous control flow" subtitle="Model proposals are untrusted until deterministic checks pass">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {['OBSERVE', 'REASON', 'PROPOSE', 'AUTHORIZE', 'SETTLE', 'AUDIT'].map((step, index) => (
                  <div key={step} className="flex items-center gap-2">
                    <span className="rounded border border-white/10 bg-white/[.03] px-3 py-2 font-mono">{step}</span>
                    {index < 5 && <span className="text-muted-foreground">→</span>}
                  </div>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button onClick={() => run('happy')} disabled={!isSignedIn || running !== null}>
                  <Play className="h-4 w-4" />{running === 'happy' ? 'Running…' : 'Run approved scenario'}
                </Button>
                <Button variant="outline" onClick={() => run('denial')} disabled={!isSignedIn || running !== null}>
                  <ShieldX className="h-4 w-4" />{running === 'denial' ? 'Testing…' : 'Run denial scenario'}
                </Button>
                {runMessage && <span className="font-mono text-xs text-muted-foreground">{runMessage}</span>}
              </div>
            </Panel>

            <Panel title="Audit timeline" subtitle={`${audits.records.length} operational events in DeepSpace state`}>
              <div className="max-h-[420px] space-y-0 overflow-y-auto pr-1">
                {audits.records.length === 0 ? <Empty text="Run a scenario to generate the full audit chain." /> : audits.records.map((record, index) => (
                  <div key={record.recordId} className="relative flex gap-4 border-l border-white/10 pb-5 pl-5 last:pb-0">
                    <span className={`absolute -left-1.5 top-1 h-3 w-3 rounded-full ring-4 ring-[#0d1319] ${eventColor(record.data.eventType)}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold tracking-wide">{record.data.eventType}</span>
                        <span className="text-[11px] text-muted-foreground">{formatTime(record.data.timestamp)}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{record.data.actor} · {record.data.actionId}</p>
                      {record.data.transactionHash && <p className="mt-1 truncate font-mono text-[11px] text-emerald-400">{record.data.transactionHash}</p>}
                    </div>
                    {index === 0 && <span className="text-[10px] uppercase text-emerald-400">latest</span>}
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <div className="space-y-5">
            <Panel title="Active policy" subtitle={policy?.version ?? 'P-001 · seeded on first run'}>
              <dl className="space-y-3 text-sm">
                <Metric label="Maximum transaction" value={`${policy?.maxTransactionAmount ?? 250} RLUSD`} />
                <Metric label="Daily budget" value={`${policy?.dailyBudget ?? 1_000} RLUSD`} />
                <Metric label="Spent today" value={`${spent} RLUSD`} />
                <Metric label="Approved vendors" value={String(policy?.allowedVendors.length ?? 1)} />
                <Metric label="Allowed actions" value={String(policy?.allowedActions.length ?? 1)} />
              </dl>
            </Panel>

            <Panel title="Financial activity" subtitle="XRPL Testnet settlement only">
              {latestAction ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">{latestAction.actionIntent.vendor}</p>
                      <p className="mt-1 font-mono text-2xl">{latestAction.actionIntent.amount} {latestAction.actionIntent.currency}</p>
                    </div>
                    <DecisionBadge decision={latestAction.policyDecision.decision} />
                  </div>
                  <div className="rounded-md border border-white/8 bg-black/20 p-3 text-xs">
                    <p className="text-muted-foreground">Execution</p>
                    <p className="mt-1 font-mono">{latestAction.executionStatus}</p>
                    {latestAction.execution?.transactionHash && <p className="mt-2 break-all font-mono text-emerald-400">{latestAction.execution.transactionHash}</p>}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{latestAction.policyDecision.reason}</p>
                </div>
              ) : <Empty text="No financial action has been proposed." />}
            </Panel>

            <Panel title="Ask through Photon" subtitle="Reads the same DeepSpace state and audit records">
              <div className="flex gap-2">
                <Input value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void ask()} placeholder="Why was the last payment denied?" />
                <Button variant="outline" onClick={ask} disabled={asking || !isSignedIn}><MessageSquareText className="h-4 w-4" /></Button>
              </div>
              {answer && <p className="mt-3 rounded-md border border-white/8 bg-white/[.03] p-3 text-sm leading-relaxed">{answer}</p>}
            </Panel>
          </div>
        </section>
      </main>
    </div>
  )
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <section className="rounded-lg border border-white/8 bg-[#0d1319] shadow-[0_12px_40px_rgba(0,0,0,.18)]"><header className="border-b border-white/8 px-5 py-4"><h2 className="text-sm font-semibold">{title}</h2><p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p></header><div className="p-5">{children}</div></section>
}

function StatusCard({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Activity }) {
  return <div className="flex items-center gap-3 rounded-lg border border-white/8 bg-[#0d1319] p-4"><div className="rounded-md border border-emerald-500/20 bg-emerald-500/8 p-2 text-emerald-400"><Icon className="h-4 w-4" /></div><div><p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-0.5 font-mono text-xs text-emerald-300">{value}</p></div></div>
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between border-b border-white/6 pb-3 last:border-0 last:pb-0"><dt className="text-muted-foreground">{label}</dt><dd className="font-mono text-xs">{value}</dd></div>
}

function DecisionBadge({ decision }: { decision?: 'APPROVED' | 'DENIED' }) {
  const approved = decision === 'APPROVED'
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${approved ? 'bg-emerald-500/12 text-emerald-300' : 'bg-red-500/12 text-red-300'}`}>{approved ? <CheckCircle2 className="h-3 w-3" /> : <ShieldX className="h-3 w-3" />}{decision ?? 'PENDING'}</span>
}

function Empty({ text }: { text: string }) {
  return <p className="py-5 text-center text-sm text-muted-foreground">{text}</p>
}

function formatTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function eventColor(type: string) {
  if (type.includes('FAILED') || type === 'DENIED') return 'bg-red-400'
  if (type === 'APPROVED' || type.includes('SUCCEEDED')) return 'bg-emerald-400'
  if (type === 'POLICY_EVALUATED') return 'bg-amber-400'
  return 'bg-sky-400'
}
