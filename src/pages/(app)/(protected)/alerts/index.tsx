import { useState } from 'react'
import { useQuery } from 'deepspace'
import { Link } from 'react-router-dom'
import { ConsoleShell, Empty, Panel, StatusPill, relative, type AlertRow } from '@/components/console-data'
import { useWorkspace } from '@/workspace-context'

export default function AlertsPage() {
  const workspace = useWorkspace()
  const alerts = useQuery<AlertRow & { workspaceId: string }>('alerts', { orderBy: 'updatedAt', orderDir: 'desc', limit: 200 })
  const [filter, setFilter] = useState('ALL')
  const rows = alerts.records.filter((row) => row.data.workspaceId === workspace.workspaceId).filter((row) => filter === 'ALL' || row.data.status === filter || row.data.severity === filter)
  return <ConsoleShell eyebrow="ATTENTION" title="Alerts" description="Active and resolved threshold events derived from stored New Relic evidence.">
    <div className="filter-row">{['ALL', 'ACTIVE', 'WARNING', 'CRITICAL', 'RESOLVED'].map((value) => <button className={filter === value ? 'active' : ''} onClick={() => setFilter(value)} key={value}>{value}</button>)}</div>
    <Panel title="Alert history" detail={`${rows.length} results`}>
      {rows.length
        ? <div className="event-table">{rows.map((row) => <Link to={`/alerts/${encodeURIComponent(row.recordId)}`} key={row.recordId}><StatusPill status={row.data.status === 'ACTIVE' ? row.data.severity : 'RESOLVED'}/><strong>{row.data.resourceId}</strong><span>{row.data.metric.replaceAll('_', ' ')} · {row.data.value.toFixed(1)}%</span><small>{relative(row.data.updatedAt)}</small></Link>)}</div>
        : <Empty>No alerts match this filter.</Empty>}
    </Panel>
  </ConsoleShell>
}
