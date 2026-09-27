import { useState } from 'react'
import { useQuery } from 'deepspace'
import { Button, Tabs, TabsList, TabsTrigger } from '@/components/ui'
import { ConsoleShell, Empty, MetricValue, Panel, ResourceTable, StatusPill, metricMap, type CurrentMetric, type ResourceRow } from '@/components/console-data'
import { useWorkspace } from '@/workspace-context'

export default function ResourcesPage() {
  const workspace = useWorkspace()
  const resources = useQuery<ResourceRow>('resources', { limit: 500 })
  const metrics = useQuery<CurrentMetric>('current-telemetry', { limit: 2500 })
  const [tab, setTab] = useState<'monitored' | 'available'>('monitored')
  const [notice, setNotice] = useState('')
  const fleet = resources.records.filter((row) => row.data.workspaceId === workspace.workspaceId)
  const monitored = fleet.filter((row) => row.data.monitoringEnabled)
  const available = fleet.filter((row) => !row.data.monitoringEnabled)

  async function update(resourceId: string, controls: { monitoringEnabled?: boolean; autonomousEnabled?: boolean }) {
    setNotice('Updating resource controls…')
    const response = await fetch(`/api/avmos/resources/${encodeURIComponent(resourceId)}/controls`, {
      method: 'POST',
      headers: { ...(await workspace.headers()), 'Content-Type': 'application/json' },
      body: JSON.stringify(controls),
    })
    const body = await response.json() as { error?: { message?: string } }
    setNotice(response.ok ? 'Resource controls updated.' : body.error?.message ?? 'Resource controls could not be updated.')
  }

  return <ConsoleShell eyebrow="INFRASTRUCTURE" title="Resources" description="Discovered New Relic hosts and explicit AVMOS enrollment.">
    <Tabs value={tab} onValueChange={(value) => setTab(value as 'monitored' | 'available')}>
      <TabsList aria-label="Resource lifecycle">
        <TabsTrigger value="monitored">MONITORED ({monitored.length})</TabsTrigger>
        <TabsTrigger value="available">AVAILABLE ({available.length})</TabsTrigger>
      </TabsList>
    </Tabs>
    {notice && <p className="console-notice">{notice}</p>}
    {tab === 'monitored'
      ? <Panel title="Monitored resources" detail={`${monitored.filter((row) => row.data.autonomousEnabled).length} autonomous`}>
          {monitored.length
            ? <ResourceTable resources={monitored} metrics={metrics.records} onControls={update}/>
            : <Empty>No resources are enrolled. Select Available to monitor a discovered host.</Empty>}
        </Panel>
      : <Panel title="Available resources" detail={`${available.length} discovered`}>
          {available.length
            ? <div className="integration-grid compact">{available.map((row) => {
                const current = metricMap(metrics.records, row.recordId)
                return <article className="integration-card" key={row.recordId}>
                  <header><div><h2>{row.data.hostname}</h2><span>{row.data.externalId}</span></div><StatusPill status="AVAILABLE"/></header>
                  <p>CPU <MetricValue metric={current.cpu_utilization}/> · Memory <MetricValue metric={current.memory_utilization}/> · Storage <MetricValue metric={current.storage_utilization}/></p>
                  <Button onClick={() => void update(row.recordId, { monitoringEnabled: true })}>Monitor</Button>
                </article>
              })}</div>
            : <Empty>No available hosts. Verify New Relic discovery in Integrations.</Empty>}
        </Panel>}
  </ConsoleShell>
}
