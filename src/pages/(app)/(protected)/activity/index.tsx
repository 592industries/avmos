import { useState } from 'react'
import { useQuery } from 'deepspace'
import { Link } from 'react-router-dom'
import { Button, Input } from '@/components/ui'
import { ConsoleShell, Empty, Panel, relative, type AuditRow } from '@/components/console-data'
import { useWorkspace } from '@/workspace-context'

export default function ActivityPage() {
  const workspace = useWorkspace()
  const events = useQuery<AuditRow & { workspaceId: string }>('audit-events', { orderBy: 'timestamp', orderDir: 'desc', limit: 200 })
  const [search, setSearch] = useState('')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const rows = events.records
    .filter((row) => row.data.workspaceId === workspace.workspaceId)
    .filter((row) => `${row.data.eventType} ${row.data.resourceId} ${row.data.actor}`.toLowerCase().includes(search.toLowerCase()))

  async function ask() {
    const response = await fetch('/api/actions/askOperator', {
      method: 'POST',
      headers: { ...(await workspace.headers()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: workspace.workspaceId, question }),
    })
    const body = await response.json() as { data?: { answer?: string }; error?: string }
    setAnswer(body.data?.answer ?? body.error ?? 'No answer available.')
  }

  return <ConsoleShell eyebrow="AUDIT" title="Activity" description="Chronological operational events, policy decisions, execution, and recovery.">
    <div className="console-grid">
      <Panel title="Timeline" detail={`${rows.length} events`} className="span-2">
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search event, resource, or actor"/>
        {rows.length
          ? <div className="event-table activity-events">{rows.map((row) => <Link to={`/activity/${encodeURIComponent(row.recordId)}`} key={row.recordId}><strong>{row.data.eventType.replaceAll('_', ' ')}</strong><span>{row.data.resourceId} · {row.data.actor}</span><small>{relative(row.data.timestamp)}</small></Link>)}</div>
          : <Empty>No activity matches this search.</Empty>}
      </Panel>
      <Panel title="Ask about recorded state" detail="Read only">
        <p className="panel-copy">AVMOS answers from stored resources, decisions, and audit records. It cannot authorize or execute actions.</p>
        <Input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Why was the last action denied?"/>
        <Button className="mt-3" onClick={() => void ask()} disabled={!question.trim()}>Ask AVMOS</Button>
        {answer && <p className="console-notice">{answer}</p>}
      </Panel>
    </div>
  </ConsoleShell>
}
