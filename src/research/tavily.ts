export type ResearchResult = {
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
    if (!this.delegate) return { sources: [] }
    try {
      return await this.delegate.search(query, signal)
    } catch {
      return { sources: [] }
    }
  }
}
