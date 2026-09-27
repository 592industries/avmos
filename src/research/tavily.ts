export type ResearchResult = {
  status: 'RESEARCH_COMPLETE' | 'RESEARCH_TIMEOUT' | 'RESEARCH_FAILED' | 'RESEARCH_UNAVAILABLE'
  query: string
  requestedAt: string
  answer?: string
  sources: Array<{ title: string; url: string; content: string }>
}

export interface ResearchProvider {
  search(query: string, signal?: AbortSignal): Promise<ResearchResult>
}

export class TavilyResearchProvider implements ResearchProvider {
  constructor(private readonly apiKey: string) {}

  async search(query: string, signal?: AbortSignal): Promise<ResearchResult> {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        search_depth: 'basic',
        max_results: 3,
        include_answer: true,
      }),
      signal,
    })
    if (!response.ok) throw new Error(`Tavily search failed (${response.status})`)
    const data = (await response.json()) as {
      answer?: unknown
      results?: Array<{ title?: unknown; url?: unknown; content?: unknown }>
    }
    return {
      status: 'RESEARCH_COMPLETE', query, requestedAt: new Date().toISOString(),
      answer: typeof data.answer === 'string' ? data.answer : undefined,
      sources: (data.results ?? []).flatMap((item) =>
        typeof item.title === 'string' &&
        typeof item.url === 'string' &&
        typeof item.content === 'string'
          ? [{ title: item.title, url: item.url, content: item.content }]
          : [],
      ),
    }
  }
}

export class OptionalResearchProvider implements ResearchProvider {
  constructor(private readonly delegate?: ResearchProvider) {}

  async search(query: string, signal?: AbortSignal): Promise<ResearchResult> {
    const requestedAt = new Date().toISOString()
    if (!this.delegate) return { status: 'RESEARCH_UNAVAILABLE', query, requestedAt, sources: [] }
    try {
      const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000)
      return await this.delegate.search(query, bounded)
    } catch (error) {
      return { status: error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'RESEARCH_TIMEOUT' : 'RESEARCH_FAILED', query, requestedAt, sources: [] }
    }
  }
}
