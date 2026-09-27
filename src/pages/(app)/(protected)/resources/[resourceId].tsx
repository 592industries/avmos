import { useState } from 'react'
import { useQuery } from 'deepspace'
import { useParams } from 'react-router-dom'
import { Button } from '@/components/ui'
import { AggregateRow, AlertRow, ConsoleShell, CurrentMetric, Empty, MetricCard, MetricValue, Panel, ResourceRow, Sparkline, StatusPill, metricMap, relative } from '@/components/console-data'
import { useWorkspace } from '@/workspace-context'

type ActionRow = {
  workspaceId: string
  resourceId: string
  decisionSummary?: string
  policyDecision: { decision: string; reason: string }
  executionStatus: string
  createdAt: string
}

export default function ResourceDetail() {
  const { resourceId = '' } = useParams()
  const workspace = useWorkspace()
  const resources = useQuery<ResourceRow>('resources', { limit: 500 })
  const current = useQuery<CurrentMetric>('current-telemetry', { where: { resourceId }, limit: 20 })
  const history = useQuery<AggregateRow & { workspaceId: string }>('telemetry-aggregates', { where: { resourceId }, orderBy: 'bucketStart', orderDir: 'desc', limit: 720 })
  const alerts = useQuery<AlertRow & { workspaceId: string }>('alerts', { where: { resourceId }, orderBy: 'updatedAt', orderDir: 'desc', limit: 50 })
  const actions = useQuery<ActionRow>('actions', { where: { resourceId }, orderBy: 'createdAt', orderDir: 'desc', limit: 10 })
  const policies = useQuery<{ workspaceId: string; id: string; name?: string; enabled: boolean; allowedResources: string[] }>('policies', { limit: 100 })
  const [notice, setNotice] = useState('')
  const resource = resources.records.find((row) => row.recordId === resourceId && row.data.workspaceId === workspace.workspaceId)?.data
  const map = metricMap(current.records.filter((row) => row.data.workspaceId === workspace.workspaceId), resourceId)
  const latest = actions.records.find((row) => row.data.workspaceId === workspace.workspaceId)?.data
  const applicable = policies.records.filter((row) => row.data.workspaceId === workspace.workspaceId && row.data.enabled && row.data.allowedResources.includes(resourceId))

  async function evaluate() {
    setNotice('Evaluation requested…')
    const response = await fetch('/api/actions/runAgentCycle', {
      method: 'POST',
      headers: { ...(await workspace.headers()), 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ workspaceId: workspace.workspaceId, resourceId, research: false }),
    })
    const body = await response.json() as { success?: boolean; error?: string; data?: { decision?: string; executionStatus?: string; reason?: string } }
    setNotice(body.success ? `${body.data?.decision} · ${body.data?.reason ?? body.data?.executionStatus}` : body.error ?? 'Evaluation failed.')
  }

  async function controls(patch: { monitoringEnabled?: boolean; autonomousEnabled?: boolean }) {
    const response = await fetch(`/api/avmos/resources/${encodeURIComponent(resourceId)}/controls`, {
      method: 'POST',
      headers: { ...(await workspace.headers()), 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    setNotice(response.ok ? 'Resource controls updated.' : 'Resource controls could not be updated.')
  }

  if (!resource) return <ConsoleShell eyebrow="RESOURCE" title={resourceId} description="Resource state is unavailable."><Empty>No matching workspace resource.</Empty></ConsoleShell>
  return <ConsoleShell eyebrow="RESOURCE DETAIL" title={resource.hostname} description={`New Relic · updated ${relative(resource.lastObservedAt)}`} actions={<Button disabled={!resource.monitoringEnabled} onClick={() => void evaluate()}>Run evaluation</Button>}>
    <section className="summary-grid">
      <MetricCard label="State" value={<StatusPill status={resource.telemetryStatus}/>} detail={`Updated ${relative(resource.lastObservedAt)}`}/>
      <MetricCard label="CPU" value={<MetricValue metric={map.cpu_utilization}/>}/>
      <MetricCard label="Memory" value={<MetricValue metric={map.memory_utilization}/>}/>
      <MetricCard label="Storage" value={<MetricValue metric={map.storage_utilization}/>}/>
      <MetricCard label="Network receive" value={<MetricValue metric={map.network_receive_bytes_per_second}/>}/>
    </section>
    {notice && <p className="console-notice">{notice}</p>}
    <div className="console-grid">
      <Panel title="Lifecycle">
        <div className="settings-row"><span>Monitoring</span><button className="text-action" onClick={() => void controls({ monitoringEnabled: !resource.monitoringEnabled })}>{resource.monitoringEnabled ? 'ON' : 'OFF'}</button></div>
        <div className="settings-row"><span>Autonomous</span><button className="text-action" disabled={!resource.monitoringEnabled} onClick={() => void controls({ autonomousEnabled: !resource.autonomousEnabled })}>{resource.autonomousEnabled ? 'ON' : 'OFF'}</button></div>
      </Panel>
      <Panel title="Trend" detail="Stored hourly storage aggregates" className="span-2"><Sparkline points={history.records.filter((row) => row.data.workspaceId === workspace.workspaceId && row.data.metric === 'storage_utilization').reverse().map((row) => row.data.average)}/></Panel>
      <Panel title="Agent"><dl className="detail-list"><div><dt>Last evaluation</dt><dd>{latest ? relative(latest.createdAt) : 'Never'}</dd></div><div><dt>State</dt><dd>{latest ? <StatusPill status={latest.executionStatus}/> : <StatusPill status="IDLE"/>}</dd></div><div><dt>Summary</dt><dd>{latest?.decisionSummary ?? 'No evaluation recorded.'}</dd></div></dl></Panel>
      <Panel title="Applicable policy"><p>{applicable.length === 1 ? applicable[0].data.name ?? applicable[0].data.id : applicable.length ? 'AMBIGUOUS' : 'NO APPLICABLE POLICY'}</p></Panel>
      <Panel title="Result"><p>{latest?.policyDecision.reason ?? 'Run an evaluation to produce a result.'}</p></Panel>
      <Panel title="Alert history">{alerts.records.filter((row) => row.data.workspaceId === workspace.workspaceId).length ? <div className="attention-list">{alerts.records.filter((row) => row.data.workspaceId === workspace.workspaceId).map((row) => <article key={row.recordId}><StatusPill status={row.data.status}/><strong>{row.data.severity}</strong><p>{row.data.value.toFixed(1)}% · {relative(row.data.updatedAt)}</p></article>)}</div> : <Empty>No alert history.</Empty>}</Panel>
    </div>
  </ConsoleShell>
}
