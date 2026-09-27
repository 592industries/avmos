import { useState, type ReactNode } from 'react'
import { useQuery } from 'deepspace'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import { Button } from '@/components/ui'
import { ConsoleShell, Empty, StatusPill, type ResourceRow } from '@/components/console-data'
import { useWorkspace } from '@/workspace-context'

export type PolicyRow = {
  workspaceId: string
  id: string
  name?: string
  version: string
  enabled: boolean
  maxTransactionAmount: number
  dailyBudget: number
  allowedActions: string[]
  allowedVendors: string[]
  allowedResources: string[]
  allowedAgents: string[]
  allowedProviders?: string[]
  currency: string
  requireEvidence: boolean
  maxTelemetryAgeSeconds?: number
  updatedAt: string
}

const base = {
  name: '', enabled: true, maxTransactionAmount: 250, dailyBudget: 1000,
  maxTelemetryAgeSeconds: 120, requireEvidence: true,
  allowedActions: ['purchase_storage'], allowedResources: [] as string[],
  allowedAgents: ['infrastructure-agent'], allowedProviders: ['xrpl-testnet'],
  allowedVendors: ['approved-storage-vendor'], currency: 'RLUSD',
}

export default function PoliciesPage() {
  const workspace = useWorkspace()
  const policies = useQuery<PolicyRow>('policies', { orderBy: 'updatedAt', orderDir: 'desc', limit: 500 })
  const resources = useQuery<ResourceRow>('resources', { limit: 500 })
  const [editing, setEditing] = useState<PolicyRow | null | undefined>()
  const [form, setForm] = useState(base)
  const [notice, setNotice] = useState('')
  const rows = policies.records.filter((row) => row.data.workspaceId === workspace.workspaceId)
  const monitored = resources.records.filter((row) => row.data.workspaceId === workspace.workspaceId && row.data.monitoringEnabled)

  function open(policy?: PolicyRow) {
    setEditing(policy ?? null)
    setForm(policy ? { ...base, ...policy, name: policy.name ?? policy.id, allowedProviders: policy.allowedProviders ?? ['xrpl-testnet'] } : base)
    setNotice('')
  }

  async function save() {
    const response = await fetch(editing ? `/api/policies/${editing.id}` : '/api/policies', {
      method: editing ? 'PATCH' : 'POST',
      headers: { ...(await workspace.headers()), 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const body = await response.json() as { error?: { message?: string } }
    if (response.ok) {
      setEditing(undefined)
      setNotice('Policy saved.')
    } else setNotice(body.error?.message ?? 'Policy could not be saved.')
  }

  return <ConsoleShell eyebrow="AUTHORIZATION" title="Policies" description="Versioned deterministic authority for protected operations." actions={<Button onClick={() => open()}>Add policy</Button>}>
    {notice && <p className="console-notice">{notice}</p>}
    {rows.length ? <div className="policy-list">
      <div className="policy-list-head"><span>Policy</span><span>Scope</span><span>Limits</span><span>Version</span><span/></div>
      {rows.map((row) => <article key={row.recordId}>
        <div><strong>{row.data.name ?? row.data.id}</strong><small>{row.data.id}</small><StatusPill status={row.data.enabled ? 'ACTIVE' : 'DISABLED'}/></div>
        <div><span>{row.data.allowedResources.join(', ')}</span><small>{row.data.allowedActions.join(', ')}</small></div>
        <div><span>{row.data.maxTransactionAmount} {row.data.currency}</span><small>{row.data.dailyBudget} daily</small></div>
        <div><span>{row.data.version}</span><small>{new Date(row.data.updatedAt).toLocaleString()}</small></div>
        <div><button className="text-action" onClick={() => open(row.data)}>Edit</button><Link to={`/policies/${row.recordId}`}>Details →</Link></div>
      </article>)}
    </div> : <Empty>No policies configured. Evaluations will be denied with NO_APPLICABLE_POLICY.</Empty>}
    {editing !== undefined && <div className="drawer-backdrop">
      <aside className="config-drawer policy-drawer" role="dialog" aria-modal="true">
        <header><div><p className="landing-section-label">POLICY</p><h2>{editing ? 'Edit policy' : 'Add policy'}</h2></div><button aria-label="Close" onClick={() => setEditing(undefined)}><X/></button></header>
        <div className="config-fields two-column">
          <Field label="Policy name"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })}/></Field>
          <Field label="Transaction limit"><input type="number" value={form.maxTransactionAmount} onChange={(event) => setForm({ ...form, maxTransactionAmount: Number(event.target.value) })}/></Field>
          <Field label="Daily budget"><input type="number" value={form.dailyBudget} onChange={(event) => setForm({ ...form, dailyBudget: Number(event.target.value) })}/></Field>
          <Field label="Telemetry age (seconds)"><input type="number" value={form.maxTelemetryAgeSeconds} onChange={(event) => setForm({ ...form, maxTelemetryAgeSeconds: Number(event.target.value) })}/></Field>
          <Field label="Resources"><select multiple value={form.allowedResources} onChange={(event) => setForm({ ...form, allowedResources: [...event.target.selectedOptions].map((option) => option.value) })}>{monitored.map((row) => <option key={row.recordId} value={row.recordId}>{row.data.hostname}</option>)}</select></Field>
          <label className="toggle-line"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })}/>Enabled</label>
          <label className="toggle-line"><input type="checkbox" checked={form.requireEvidence} onChange={(event) => setForm({ ...form, requireEvidence: event.target.checked })}/>Require evidence</label>
        </div>
        <div className="drawer-actions"><Button onClick={() => void save()}>Save policy</Button></div>
      </aside>
    </div>}
  </ConsoleShell>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label><span>{label}</span>{children}</label>
}
