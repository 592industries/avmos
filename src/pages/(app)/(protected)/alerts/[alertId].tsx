import { useQuery } from 'deepspace'
import { useParams } from 'react-router-dom'
import { ConsoleShell, Empty, Panel, StatusPill, relative, type AlertRow } from '@/components/console-data'
import { useWorkspace } from '@/workspace-context'

export default function AlertDetail() {
  const { alertId = '' } = useParams()
  const workspace = useWorkspace()
  const alerts = useQuery<AlertRow & { workspaceId: string }>('alerts', { limit: 200 })
  const row = alerts.records.find((item) => item.recordId === alertId && item.data.workspaceId === workspace.workspaceId)?.data
  if (!row) return <ConsoleShell eyebrow="ALERT" title="Not found" description="The requested alert is unavailable."><Empty>No matching workspace alert.</Empty></ConsoleShell>
  return <ConsoleShell eyebrow="ALERT DETAIL" title={row.metric.replaceAll('_', ' ')} description={`${row.resourceId} · updated ${relative(row.updatedAt)}`}>
    <Panel title="Verified event">
      <dl className="detail-list">
        <div><dt>Status</dt><dd><StatusPill status={row.status}/></dd></div>
        <div><dt>Severity</dt><dd>{row.severity}</dd></div>
        <div><dt>Observed value</dt><dd>{row.value.toFixed(1)}%</dd></div>
        <div><dt>Threshold</dt><dd>{row.threshold}%</dd></div>
        <div><dt>Opened</dt><dd>{new Date(row.openedAt).toLocaleString()}</dd></div>
        {row.resolvedAt && <div><dt>Resolved</dt><dd>{new Date(row.resolvedAt).toLocaleString()}</dd></div>}
      </dl>
    </Panel>
  </ConsoleShell>
}
