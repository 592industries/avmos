import { useEffect, useState } from 'react'
import { Settings, X } from 'lucide-react'
import { Button } from '@/components/ui'
import { ConsoleShell, StatusPill, relative } from '@/components/console-data'
import { useWorkspace } from '@/workspace-context'

type Provider = {
  id: string
  displayName: string
  category: string
  isImplemented: boolean
  requiresSecrets: string[]
  publicFields: string[]
  supportsTest: boolean
  configured: boolean
  status: string
  discoveryStatus?: string
  discoveryCount?: number
  telemetryStatus?: string
  configuration?: {
    publicConfig?: Record<string, string | number | boolean>
    lastVerifiedAt?: string
    lastTelemetryAt?: string
  } | null
}

export default function IntegrationsPage() {
  const workspace = useWorkspace()
  const [providers, setProviders] = useState<Provider[]>([])
  const [selected, setSelected] = useState<Provider | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [visible, setVisible] = useState<Record<string, boolean>>({})
  const [message, setMessage] = useState('')

  async function load() {
    const response = await fetch('/api/avmos/integrations', { headers: await workspace.headers() })
    if (response.ok) setProviders((await response.json() as { providers: Provider[] }).providers)
  }

  useEffect(() => { void load() }, [workspace.workspaceId])

  function open(provider: Provider) {
    setSelected(provider)
    setValues(Object.fromEntries(Object.entries(provider.configuration?.publicConfig ?? {}).map(([key, value]) => [key, String(value)])))
    setSecrets({})
    setVisible({})
    setMessage('')
  }

  async function submit(endpoint: 'test' | 'configure' | 'clear') {
    if (!selected) return
    setMessage(endpoint === 'test' ? 'Testing connection and discovering fleet…' : 'Saving…')
    const response = await fetch(`/api/avmos/integrations/${selected.id}/${endpoint}`, {
      method: 'POST',
      headers: { ...(await workspace.headers()), 'Content-Type': 'application/json' },
      body: JSON.stringify(endpoint === 'clear' ? {} : { values, secrets }),
    })
    const body = await response.json() as { message?: string; error?: { message?: string } }
    setMessage(body.message ?? body.error?.message ?? 'Request failed.')
    if (response.ok) {
      await load()
      if (endpoint === 'clear') setValues({})
      setSecrets({})
      setVisible({})
    }
  }

  return <ConsoleShell eyebrow="CONNECTIONS" title="Integrations" description={`Workspace integrations · ${workspace.workspace?.name ?? workspace.workspaceId}`}>
    <div className="integration-grid compact">
      {providers.map((provider) => <article className="integration-card" key={provider.id}>
        <header>
          <div><h2>{provider.displayName}</h2><span>{label(provider.category)}</span></div>
          <button className="gear-button" aria-label={`Configure ${provider.displayName}`} onClick={() => open(provider)}><Settings size={16}/></button>
        </header>
        <StatusPill status={provider.status}/>
        {provider.id === 'newrelic' && <>
          <p>Fleet discovery <StatusPill status={provider.discoveryStatus ?? 'NEVER_RUN'}/> · {provider.discoveryCount ?? 0} resources</p>
          <p>Telemetry <StatusPill status={provider.telemetryStatus ?? 'UNAVAILABLE'}/>{provider.configuration?.lastTelemetryAt ? ` · ${relative(provider.configuration.lastTelemetryAt)}` : ''}</p>
        </>}
        <p>{provider.configuration?.lastVerifiedAt ? `Last verified ${relative(provider.configuration.lastVerifiedAt)}` : provider.configured ? 'Configured · no verified run yet' : provider.isImplemented ? 'Credentials not configured' : 'Adapter not implemented'}</p>
      </article>)}
    </div>
    {selected && <div className="drawer-backdrop" role="presentation">
      <aside className="config-drawer" role="dialog" aria-modal="true" aria-label={`${selected.displayName} configuration`}>
        <header>
          <div><p className="landing-section-label">INTEGRATION</p><h2>{selected.displayName}</h2></div>
          <button aria-label="Close" onClick={() => setSelected(null)}><X/></button>
        </header>
        <StatusPill status={selected.status}/>
        <div className="config-fields">
          {selected.publicFields.map((field) => <PublicField key={field} field={field} value={values[field] ?? ''} onChange={(value) => setValues({ ...values, [field]: value })}/>)}
          {selected.requiresSecrets.map((field) => <label key={field}>
            <span>{fieldLabel(field)}</span>
            <div className="secret-input">
              <input type={visible[field] ? 'text' : 'password'} autoComplete="new-password" placeholder={selected.configuration ? 'Credential stored securely' : 'Enter credential'} value={secrets[field] ?? ''} onChange={(event) => setSecrets({ ...secrets, [field]: event.target.value })}/>
              <button type="button" onClick={() => setVisible({ ...visible, [field]: !visible[field] })}>{visible[field] ? 'Hide' : 'Show'}</button>
            </div>
            <small>Encrypted server-side and never returned to the browser.</small>
          </label>)}
        </div>
        {message && <p className="console-notice">{message}</p>}
        <div className="drawer-actions">
          <Button variant="secondary" disabled={!selected.supportsTest} onClick={() => void submit('test')}>Verify & discover</Button>
          <Button disabled={!selected.isImplemented} onClick={() => void submit('configure')}>Save configuration</Button>
          <button className="text-action" onClick={() => void submit('clear')}>Disconnect</button>
        </div>
      </aside>
    </div>}
  </ConsoleShell>
}

function label(value: string) {
  return ({ telemetry: 'Infrastructure telemetry', reasoning: 'Constrained reasoning', research: 'Optional remediation research', settlement: 'Protected settlement', future: 'Future provider' } as Record<string, string>)[value] ?? value
}

function fieldLabel(value: string) {
  return value.replace(/([A-Z])/g, ' $1').replace(/^./, (character) => character.toUpperCase())
}

function PublicField({ field, value, onChange }: { field: string; value: string; onChange: (value: string) => void }) {
  const choices: Record<string, string[]> = { region: ['US', 'EU', 'JP'], executionMode: ['simulated', 'live'], currency: ['RLUSD'] }
  return <label>
    <span>{fieldLabel(field)}</span>
    {choices[field]
      ? <select value={value} onChange={(event) => onChange(event.target.value)}><option value="">Select</option>{choices[field].map((choice) => <option key={choice}>{choice}</option>)}</select>
      : <input type={field === 'accountId' ? 'number' : 'text'} value={value} onChange={(event) => onChange(event.target.value)}/>}
  </label>
}
