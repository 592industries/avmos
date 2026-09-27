import type { TelemetryTrend } from '../domain/operations'

export type TrendForecast = {
  sampleCount: number
  slopePercentagePointsPerDay: number
  movingAverage: number
  daysTo95Percent: number | null
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'
}

/** Linear regression over actual sample timestamps. No model-generated forecast. */
export function forecastStorage(trend: TelemetryTrend): TrendForecast {
  const points = trend.points.map((point) => ({ day: Date.parse(point.timestamp) / 86_400_000, value: point.value }))
  const n = points.length
  const meanX = points.reduce((sum, p) => sum + p.day, 0) / n
  const meanY = points.reduce((sum, p) => sum + p.value, 0) / n
  const denominator = points.reduce((sum, p) => sum + (p.day - meanX) ** 2, 0)
  const slope = denominator > 0 ? points.reduce((sum, p) => sum + (p.day - meanX) * (p.value - meanY), 0) / denominator : 0
  const latest = points.at(-1)!.value
  const days = slope > 0 && latest < 95 ? (95 - latest) / slope : null
  return {
    sampleCount: n,
    slopePercentagePointsPerDay: Number(slope.toFixed(3)),
    movingAverage: Number((points.slice(-Math.min(5, n)).reduce((sum, p) => sum + p.value, 0) / Math.min(5, n)).toFixed(2)),
    daysTo95Percent: days === null ? null : Number(days.toFixed(2)),
    confidence: n >= 12 ? 'HIGH' : n >= 5 ? 'MEDIUM' : 'LOW',
  }
}
