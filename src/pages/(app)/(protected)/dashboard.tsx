import { useQuery } from 'deepspace'
import { AlertTriangle, Bot, Database, Server } from 'lucide-react'
import { ConsoleShell, Empty, Panel, ResourceTable, StatusPill, relative, type AlertRow, type AuditRow, type CurrentMetric, type ResourceRow } from '@/components/console-data'
import { useWorkspace } from '@/workspace-context'

export default function Dashboard() {
  const workspace = useWorkspace()
  const resources = useQuery<ResourceRow>('resources', { limit: 500 })
  const metrics = useQuery<CurrentMetric>('current-telemetry', { limit: 2500 })
  const alerts = useQuery<AlertRow & { workspaceId: string }>('alerts', { where: { status: 'ACTIVE' }, limit: 500 })
  const audits = useQuery<AuditRow & { workspaceId: string }>('audit-events', { orderBy: 'timestamp', orderDir: 'desc', limit: 100 })
  const agents = useQuery<{ workspaceId: string; status: string; lastRunAt: string; modelProvider: string }>('agents', { limit: 100 })
  const fleet = resources.records.filter((row) => row.data.workspaceId === workspace.workspaceId)
  const monitored = fleet.filter((row) => row.data.monitoringEnabled)
  const workspaceAlerts = alerts.records.filter((row) => row.data.workspaceId === workspace.workspaceId)
  const activity = audits.records.filter((row) => row.data.workspaceId === workspace.workspaceId).slice(0, 8)
  const agent = agents.records.find((row) => row.data.workspaceId === workspace.workspaceId)
  const healthy = monitored.filter((row) => row.data.status === 'online').length
  const autonomous = monitored.filter((row) => row.data.autonomousEnabled).length
  const latest = fleet.map((row) => row.data.lastObservedAt).sort().at(-1)
  const telemetry = fleet.some((row) => row.data.telemetryStatus === 'LIVE') ? 'LIVE'
    : fleet.some((row) => row.data.telemetryStatus === 'ERROR') ? 'ERROR'
      : fleet.length ? 'STALE' : 'UNAVAILABLE'

  return <ConsoleShell eyebrow="OPERATIONS CENTER" title="Overview" description={`Current verified state · ${workspace.workspace?.name ?? workspace.workspaceId}`}>
    <section className="summary-grid">
      <Summary icon={<Server/>} label="Resources" value={monitored.length}/>
      <Summary icon={<Database/>} label="Healthy" value={healthy}/>
      <Summary icon={<AlertTriangle/>} label="Attention" value={workspaceAlerts.length}/>
      <Summary icon={<Bot/>} label="Autonomous resources" value={autonomous}/>
      <Summary label="Telemetry" value={telemetry} detail={latest ? relative(latest) : 'No observation'}/>
    </section>
    <div className="console-grid">
      <Panel title="Resources" detail="Realtime DeepSpace state" className="span-2">
        {monitored.length ? <ResourceTable resources={monitored} metrics={metrics.records.filter((row) => row.data.workspaceId === workspace.workspaceId)}/> : <Empty>No monitored resources. Enroll one from Resources.</Empty>}
      </Panel>
      <Panel title="Attention" detail={`${workspaceAlerts.length} active`}>
        {workspaceAlerts.length ? <div className="attention-list">{workspaceAlerts.map((row) => <article key={row.recordId}><StatusPill status={row.data.severity}/><strong>{row.data.resourceId}</strong><p>{row.data.metric.replaceAll('_', ' ')} {row.data.value.toFixed(1)}% · threshold {row.data.threshold}%</p></article>)}</div> : <Empty>No active attention items.</Empty>}
      </Panel>
      <Panel title="Recent activity">
        {activity.length ? <ol className="activity-list">{activity.map((row) => <li key={row.recordId}><span>{row.data.eventType.replaceAll('_', ' ')}</span><small>{row.data.resourceId} · {relative(row.data.timestamp)}</small></li>)}</ol> : <Empty>No activity recorded.</Empty>}
      </Panel>
      <Panel title="Agent"><p>{agent?.data.status ?? 'No run recorded.'}</p></Panel>
    </div>
  </ConsoleShell>
}

function Summary({ icon, label, value, detail }: { icon?: React.ReactNode; label: string; value: string | number; detail?: string }) {
  return <article className="summary-card">{icon}<span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</article>
}
