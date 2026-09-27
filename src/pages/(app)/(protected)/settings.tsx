import { useEffect, useState, type ReactNode } from 'react'
import { signOut, useQuery, useUser } from 'deepspace'
import { Button } from '@/components/ui'
import { ConsoleShell, StatusPill, relative } from '@/components/console-data'
import { useWorkspace } from '@/workspace-context'

type Health = { services: Record<string, boolean>; modes: { autonomous: boolean; settlement: string } }
type Retention = { workspaceId: string; collection: string; status: string; deleted: number; lastRunAt: string }
type Diagnostics = {
  auth: { status: string; role: string; workspace: string; provider: string }
  telemetry: { status: string; fleetSize: number; lastPoll?: string; lastObservation?: string }
  newRelic: { integration: string; credentialSource: string; account?: string | number | null; discovery: string; hostsDiscovered: number; resourcesStored: number; lastSuccessfulPoll?: string | null; lastPollDurationMs?: number | null; lastTelemetrySample?: string | null; nextScheduledPoll?: string | null }
  policy: { active: number; lastDenialReason?: string }
  execution: { mode: string; lastState?: string }
  database: { status: string; backlog: number; lastCleanup?: string }
  team: Array<{ userId: string; role?: string }>
}

export default function SettingsPage() {
  const { user } = useUser()
  const workspace = useWorkspace()
  const [health, setHealth] = useState<Health | null>(null)
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null)
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [notice, setNotice] = useState('')
  const retention = useQuery<Retention>('retention-status', { limit: 100 })
  const scopedRetention = retention.records.filter((row) => row.data.workspaceId === workspace.workspaceId)

  useEffect(() => {
    let active = true
    void (async () => {
      const headers = await workspace.headers()
      const [healthResponse, diagnosticsResponse] = await Promise.all([
        fetch('/api/health', { headers }),
        workspace.workspace?.role === 'admin' ? fetch('/api/admin/diagnostics', { headers }) : Promise.resolve(null),
      ])
      if (active && healthResponse.ok) setHealth(await healthResponse.json())
      if (active && diagnosticsResponse?.ok) setDiagnostics(await diagnosticsResponse.json())
    })()
    return () => { active = false }
  }, [workspace.workspaceId, workspace.workspace?.role])

  async function createWorkspace() {
    try {
      await workspace.createWorkspace(newWorkspaceName)
      setNewWorkspaceName('')
      setNotice('Workspace created.')
    } catch {
      setNotice('Workspace could not be created.')
    }
  }

  return <ConsoleShell eyebrow="CONTROL PLANE" title="Settings" description="Workspace, security, telemetry, retention, execution, and diagnostics.">
    {notice && <p className="console-notice">{notice}</p>}
    <div className="settings-sections">
      <Section title="Workspace">
        <Row label="Current workspace" value={workspace.workspace?.name ?? workspace.workspaceId}/>
        <label><span>Select workspace</span><select value={workspace.workspaceId} onChange={(event) => workspace.selectWorkspace(event.target.value)}>{workspace.workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label><span>Create workspace</span><input value={newWorkspaceName} onChange={(event) => setNewWorkspaceName(event.target.value)} placeholder="Workspace name"/></label>
        <Button disabled={newWorkspaceName.trim().length < 2} onClick={() => void createWorkspace()}>Create workspace</Button>
      </Section>
      <Section title="Members">
        <Row label="Your role" value={<StatusPill status={(workspace.workspace?.role ?? 'member').toUpperCase()}/>}/>
        <Row label="Active members" value={diagnostics?.team.length ?? 'Available to workspace administrators'}/>
      </Section>
      <Section title="Security">
        <Row label="Authentication" value={<StatusPill status={diagnostics?.auth.status ?? 'AUTHENTICATED'}/>}/>
        <Row label="Account" value={user?.name ?? user?.email ?? '—'}/>
        <Row label="Credential handling" value="Encrypted server-side; never returned"/>
        <Button variant="secondary" onClick={() => signOut()}>Sign out</Button>
      </Section>
      <Section title="Telemetry">
        <Row label="New Relic" value={<StatusPill status={diagnostics?.newRelic.integration ?? (health?.services.newRelic ? 'CONNECTED' : 'DISCONNECTED')}/>}/>
        <Row label="Discovery" value={<StatusPill status={diagnostics?.newRelic.discovery ?? 'NEVER_RUN'}/>}/>
        <Row label="Telemetry" value={<StatusPill status={diagnostics?.telemetry.status ?? 'UNAVAILABLE'}/>}/>
        <Row label="Last sample" value={diagnostics?.newRelic.lastTelemetrySample ? relative(diagnostics.newRelic.lastTelemetrySample) : 'Never'}/>
      </Section>
      <Section title="Execution Mode">
        <Row label="Global autonomous ceiling" value={<StatusPill status={health?.modes.autonomous ? 'ENABLED' : 'DISABLED'}/>}/>
        <Row label="XRPL" value={<StatusPill status={health?.modes.settlement ?? 'SIMULATED'}/>}/>
        <Row label="Authority boundary" value="Policy approval required"/>
      </Section>
      <Section title="Retention">
        <Row label="Collections" value={scopedRetention.length}/>
        <Row label="Backlog" value={scopedRetention.filter((row) => row.data.status === 'BACKLOG').length}/>
        <Row label="Last cleanup" value={scopedRetention.map((row) => row.data.lastRunAt).sort().at(-1) ? relative(scopedRetention.map((row) => row.data.lastRunAt).sort().at(-1)) : 'Never'}/>
      </Section>
      <Section title="Email Notifications"><Row label="Status" value={<StatusPill status="COMING SOON"/>}/></Section>
      {workspace.workspace?.role === 'admin' && <Section title="Diagnostics" wide>
        {diagnostics ? <div className="diagnostic-grid">
          <Diag title="New Relic integration" status={diagnostics.newRelic.integration} lines={[
            `Credential source: ${diagnostics.newRelic.credentialSource}`,
            `Account: ${diagnostics.newRelic.account ?? 'Unavailable'}`,
            `Discovery: ${diagnostics.newRelic.discovery}`,
            `Hosts discovered: ${diagnostics.newRelic.hostsDiscovered}`,
            `Resources stored: ${diagnostics.newRelic.resourcesStored}`,
            diagnostics.newRelic.lastSuccessfulPoll ? `Last poll: ${relative(diagnostics.newRelic.lastSuccessfulPoll)}` : 'Last poll: Never',
            diagnostics.newRelic.lastPollDurationMs != null ? `Poll duration: ${diagnostics.newRelic.lastPollDurationMs}ms` : 'Poll duration: —',
            diagnostics.newRelic.nextScheduledPoll ? `Next poll: ${relative(diagnostics.newRelic.nextScheduledPoll)}` : 'Next poll: —',
          ]}/>
          <Diag title="Telemetry" status={diagnostics.telemetry.status} lines={[`${diagnostics.telemetry.fleetSize} resources`, diagnostics.telemetry.lastObservation ? `Sample ${relative(diagnostics.telemetry.lastObservation)}` : 'No sample']}/>
          <Diag title="Policy" status={diagnostics.policy.active ? 'HEALTHY' : 'ATTENTION'} lines={[`${diagnostics.policy.active} active`, diagnostics.policy.lastDenialReason ?? 'No recent denial']}/>
          <Diag title="Execution" status={diagnostics.execution.lastState ?? diagnostics.execution.mode} lines={[diagnostics.execution.mode]}/>
          <Diag title="Database" status={diagnostics.database.status} lines={[`${diagnostics.database.backlog} cleanup backlogs`]}/>
        </div> : <p>Loading diagnostics…</p>}
      </Section>}
    </div>
  </ConsoleShell>
}

function Section({ title, wide = false, children }: { title: string; wide?: boolean; children: ReactNode }) {
  return <section className={`settings-section ${wide ? 'wide' : ''}`}><header><p>{title.toUpperCase()}</p></header>{children}</section>
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return <div className="settings-row"><span>{label}</span><strong>{value}</strong></div>
}

function Diag({ title, status, lines }: { title: string; status: string; lines: string[] }) {
  return <article><header><strong>{title}</strong><StatusPill status={status}/></header>{lines.map((line) => <p key={line}>{line}</p>)}</article>
}
