import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import cron from 'node-cron'
import PptxGenJS from 'pptxgenjs'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import sharp from 'sharp'
import type { EmailAttachment } from '../../../lib/google/gmail'
import { get_weekly_kpis, get_all_clients, get_all_properties, get_all_leads, get_all_deals, get_leads_vs_sales_last_6_months, find_properties_missing_reconstruction_data, get_deals_by_stage, get_properties_by_status, get_leads_by_status, get_client_sources_breakdown } from '../../../lib/tools'
import { get_calendar_availability, suggest_meeting_slots, draft_email, send_email, create_calendar_event, draft_viewing_email_from_availability, get_calendar_events_in_range, update_calendar_event, delete_calendar_event, list_recent_emails, get_email_thread, reply_to_email_thread } from '../../../lib/google-tools'
import { supabase } from '../../../lib/supabase'
import { getPropertiesForMap } from '../../../lib/property-map'
import { createDataRecord, deleteDataRecord, getDataEntityDefinition, getDataRecord, isDataEntity, listDataRecords, updateDataRecord } from '../../../lib/data-admin'
import { workflowEngine } from '../../../lib/workflow-engine'
import { fetchMarketWatchSnapshot, runMarketWatch } from '../../../lib/market-watch'
import { countMarketListings, queryMarketListings, storeMarketListings, syncSrealityListings } from '../../../lib/market-db'

const pendingEmailByUser: Record<string, { to: string; subject: string; body: string }> = {}
const pendingMarketContextByUser: Record<
  string,
  {
    sources?: ('sreality' | 'bezrealitky')[]
    category?: 'byty' | 'domy'
    locationLabel?: string
    listings?: Array<{
      source: 'sreality' | 'bezrealitky'
      listingId: string
      title: string
      price: string
      location: string
      url: string
    }>
    limit?: number
  }
> = {}
type ChartDatum = { name: string; value: number } | Record<string, string | number>
type PendingChart = {
  type: 'pie' | 'bar' | 'line'
  data: ChartDatum[]
  title?: string
  description?: string
  xKey?: string
  yKey?: string
  createdAt?: string
  reportSpec?: ChartNarrativeSpec
}
type PresentationSlideSpec = {
  layout?: 'cover' | 'chart-summary' | 'actions'
  title: string
  subtitle?: string
  bullets?: string[]
  insight?: string
  kpis?: Array<{
    label: string
    value: string
  }>
}
type ChartNarrativeSpec = {
  headline?: string
  subheadline?: string
  executiveSummary?: string
  insights?: string[]
  recommendedActions?: string[]
  layout?: {
    preferredChartType?: 'pie' | 'bar' | 'line'
    maxCategories?: number
    xLabelMaxLength?: number
    showSliceLabels?: boolean
    aggregateSmallSlices?: boolean
    sortDescending?: boolean
  }
  presentation?: {
    slides?: PresentationSlideSpec[]
  }
}
type ChatMessage = { role: 'user' | 'assistant' | 'tool'; content: string }
type MapAction = {
  filters?: {
    city?: string
    locality?: string
    propertyType?: string
    status?: string
    missingReconstruction?: boolean
    maxPrice?: number
  }
  selectedPropertyId?: string | null
}

type DataAction = {
  entity?: 'clients' | 'properties' | 'leads' | 'deals'
  query?: string
  selectedRecordId?: string | null
  refresh?: boolean
}

type CalendarEventLite = {
  id?: string | null
  summary?: string | null
  description?: string | null
  start?: string | null
  end?: string | null
  htmlLink?: string | null
}

const pendingChartByUser: Record<string, PendingChart> = {}
const EXPORT_FONT_FAMILY = '"DejaVu Sans","Liberation Sans","Arial","Helvetica",sans-serif'

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null

function isChartResult(result: any): result is PendingChart {
  return Boolean(
    result &&
    typeof result === 'object' &&
    typeof result.type === 'string' &&
    Array.isArray(result.data) &&
    ['pie', 'bar', 'line'].includes(result.type)
  )
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function slugifyFilename(value?: string | null) {
  const normalized = (value || 'graf')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()

  return normalized || 'graf'
}

function inferChartAxes(chart: PendingChart) {
  if (chart.xKey && chart.yKey) {
    return {
      xKey: chart.xKey,
      yKey: chart.yKey,
    }
  }

  const firstItem = chart.data[0] as Record<string, string | number> | undefined
  if (!firstItem) {
    return {
      xKey: 'name',
      yKey: 'value',
    }
  }

  const keys = Object.keys(firstItem)
  const numericKeys = keys.filter((key) => typeof firstItem[key] === 'number')
  const yKey = chart.yKey || numericKeys[0] || 'value'
  const xKey = chart.xKey || keys.find((key) => key !== yKey) || 'name'

  return { xKey, yKey }
}

function normalizeSeriesData(chart: PendingChart) {
  const { xKey, yKey } = inferChartAxes(chart)

  return {
    xKey,
    yKey,
    rows: chart.data.map((item) => ({
      label: String((item as any)[xKey] ?? (item as any).name ?? 'Unknown'),
      value: Number((item as any)[yKey] ?? (item as any).value ?? 0),
    })),
  }
}

function summarizeChart(chart: PendingChart) {
  if (chart.type === 'bar' || chart.type === 'line') {
    const normalized = normalizeSeriesData(chart)
    return normalized.rows
      .slice(0, 12)
      .map((item) => `${item.label}: ${item.value}`)
      .join('\n')
  }

  const total = chart.data.reduce((sum, item) => sum + Number((item as any).value || 0), 0)

  return chart.data
    .map((item) => {
      const name = String((item as any).name ?? 'Unknown')
      const value = Number((item as any).value || 0)
      const percentage = total > 0 ? Math.round((value / total) * 100) : 0
      return `${name}: ${value} (${percentage}%)`
    })
    .join('\n')
}

function truncateLabel(value: string, maxLength = 22) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 1)).trim()}…`
}

function normalizeExportText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeExportTitle(value: string) {
  const normalized = normalizeExportText(value)
  return normalized || 'Graf'
}

function normalizeExportLabel(value: string, fallback = 'Polozka') {
  const normalized = normalizeExportText(value)
  return normalized || fallback
}

function getChartLayoutHints(chart: PendingChart) {
  const raw = chart.reportSpec?.layout
  return {
    preferredChartType: raw?.preferredChartType,
    maxCategories: typeof raw?.maxCategories === 'number' && Number.isFinite(raw.maxCategories) ? Math.max(3, Math.min(12, Math.round(raw.maxCategories))) : chart.type === 'pie' ? 8 : 24,
    xLabelMaxLength: typeof raw?.xLabelMaxLength === 'number' && Number.isFinite(raw.xLabelMaxLength) ? Math.max(8, Math.min(28, Math.round(raw.xLabelMaxLength))) : chart.type === 'pie' ? 18 : 16,
    showSliceLabels: typeof raw?.showSliceLabels === 'boolean' ? raw.showSliceLabels : chart.type === 'pie',
    aggregateSmallSlices: typeof raw?.aggregateSmallSlices === 'boolean' ? raw.aggregateSmallSlices : chart.type === 'pie',
    sortDescending: typeof raw?.sortDescending === 'boolean' ? raw.sortDescending : true,
  }
}

function applyNarrativeLayout(chart: PendingChart) {
  const hints = getChartLayoutHints(chart)
  if (hints.preferredChartType && hints.preferredChartType !== chart.type) {
    return {
      ...chart,
      type: hints.preferredChartType,
    }
  }
  return chart
}

function extractEmailAddressesFromText(value: string) {
  return Array.from(
    new Set(
      (value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((email) => email.trim())
    )
  )
}

function findMostRecentEmailAddress(message: string, history: ChatMessage[] = []) {
  const current = extractEmailAddressesFromText(message)
  if (current.length > 0) return current[0]

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const emails = extractEmailAddressesFromText(history[index]?.content || '')
    if (emails.length > 0) return emails[0]
  }

  return null
}

function buildAttachmentFlags(parsedArgs: Record<string, any>) {
  const hasExplicitAttachmentSelection =
    typeof parsedArgs.includeJpeg === 'boolean' ||
    typeof parsedArgs.includeCsv === 'boolean' ||
    typeof parsedArgs.includePresentation === 'boolean' ||
    typeof parsedArgs.includePptx === 'boolean' ||
    typeof parsedArgs.includePdf === 'boolean' ||
    typeof parsedArgs.includeSvg === 'boolean' ||
    typeof parsedArgs.includeHtmlReport === 'boolean'

  return {
    includeHtmlReport: hasExplicitAttachmentSelection ? Boolean(parsedArgs.includeHtmlReport) : true,
    includeSvg: hasExplicitAttachmentSelection ? Boolean(parsedArgs.includeSvg) : true,
    includeJpeg: typeof parsedArgs.includeJpeg === 'boolean' ? Boolean(parsedArgs.includeJpeg) : !hasExplicitAttachmentSelection,
    includeCsv: Boolean(parsedArgs.includeCsv),
    includePresentation: Boolean(parsedArgs.includePresentation),
    includePptx: Boolean(parsedArgs.includePptx),
    includePdf: Boolean(parsedArgs.includePdf),
  }
}

function detectDirectDeliveryRequest(message: string, history: ChatMessage[] = []) {
  const normalized = normalizeText(message)
  const email = findMostRecentEmailAddress(message, history)
  if (!email) return null
  if (!/(posli|odesli|zasli|mail)/.test(normalized)) return null

  if (normalized.includes('prezentac') && normalized.includes('klient')) {
    return {
      kind: 'clients-presentation' as const,
      email,
    }
  }

  if (normalized.includes('graf') && normalized.includes('nemovit') && (normalized.includes('mesto') || normalized.includes('mest'))) {
    return {
      kind: 'properties-by-city-chart' as const,
      email,
    }
  }

  return null
}

function polarToCartesian(cx: number, cy: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180
  return {
    x: cx + radius * Math.cos(angleInRadians),
    y: cy + radius * Math.sin(angleInRadians),
  }
}

function describePieSlice(cx: number, cy: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, radius, endAngle)
  const end = polarToCartesian(cx, cy, radius, startAngle)
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1'

  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y} Z`
}

function createPieChartSvg(chart: PendingChart) {
  const width = 720
  const height = 420
  const layout = getChartLayoutHints(chart)
  const title = escapeXml(normalizeExportTitle(chart.title || 'Graf'))
  const description = escapeXml(normalizeExportLabel(chart.description || 'Vygenerovano z dat v aplikaci', 'Prehled dat'))
  const colors = ['#2563eb', '#14b8a6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']
  let items = chart.data
    .map((item) => ({
      name: normalizeExportLabel(truncateLabel(String((item as any).name ?? 'Unknown'), layout.xLabelMaxLength), 'Polozka'),
      value: Number((item as any).value || 0),
    }))
    .filter((item) => item.value >= 0)

  if (layout.sortDescending) {
    items = [...items].sort((left, right) => right.value - left.value)
  }

  if (layout.aggregateSmallSlices && items.length > layout.maxCategories) {
    const primary = items.slice(0, Math.max(1, layout.maxCategories - 1))
    const remainder = items.slice(Math.max(1, layout.maxCategories - 1))
    const otherValue = remainder.reduce((sum, item) => sum + item.value, 0)
    items = otherValue > 0 ? [...primary, { name: 'Ostatni', value: otherValue }] : primary
  } else if (items.length > layout.maxCategories) {
    items = items.slice(0, layout.maxCategories)
  }

  const total = items.reduce((sum, item) => sum + item.value, 0)

  const slices: string[] = []
  const labels: string[] = []
  const showSliceLabels = layout.showSliceLabels && items.length <= layout.maxCategories
  let currentAngle = 0

  items.forEach((item, index) => {
    const sliceAngle = total > 0 ? (item.value / total) * 360 : 0
    const endAngle = currentAngle + sliceAngle
    const midAngle = currentAngle + sliceAngle / 2
    const labelPosition = polarToCartesian(190, 210, 110, midAngle)
    const percentage = total > 0 ? Math.round((item.value / total) * 100) : 0

    slices.push(
      `<path d="${describePieSlice(190, 210, 120, currentAngle, endAngle)}" fill="${colors[index % colors.length]}" stroke="#ffffff" stroke-width="2" />`
    )

    if (showSliceLabels) {
      labels.push(
        `<text x="${labelPosition.x}" y="${labelPosition.y}" font-family="${EXPORT_FONT_FAMILY}" font-size="14" text-anchor="middle" fill="#0f172a">${percentage}%</text>`
      )
    }

    currentAngle = endAngle
  })

  const legend = items
    .map((item, index) => {
      const y = 90 + index * 48
      const percentage = total > 0 ? Math.round((item.value / total) * 100) : 0
      return [
        `<rect x="390" y="${y}" width="18" height="18" rx="4" fill="${colors[index % colors.length]}" />`,
        `<text x="420" y="${y + 14}" font-family="${EXPORT_FONT_FAMILY}" font-size="18" fill="#0f172a">${escapeXml(item.name)}</text>`,
        `<text x="655" y="${y + 14}" font-family="${EXPORT_FONT_FAMILY}" font-size="16" text-anchor="end" fill="#475569">${item.value} (${percentage}%)</text>`,
      ].join('')
    })
    .join('')

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<rect width="100%" height="100%" fill="#f8fafc" />',
    `<text x="40" y="50" font-family="${EXPORT_FONT_FAMILY}" font-size="28" font-weight="700" fill="#0f172a">${title}</text>`,
    `<text x="40" y="80" font-family="${EXPORT_FONT_FAMILY}" font-size="15" fill="#475569">${description}</text>`,
    ...slices,
    ...labels,
    legend,
    '</svg>',
  ].join('')
}

function createCartesianChartSvg(chart: PendingChart) {
  const width = 820
  const height = 460
  const layout = getChartLayoutHints(chart)
  const title = escapeXml(normalizeExportTitle(chart.title || 'Graf'))
  const description = escapeXml(normalizeExportLabel(chart.description || 'Vygenerovano z dat v aplikaci', 'Prehled dat'))
  const normalized = normalizeSeriesData(chart)
  let rows = normalized.rows
  if (layout.sortDescending && chart.type === 'bar') {
    rows = [...rows].sort((left, right) => right.value - left.value)
  }
  rows = rows.slice(0, layout.maxCategories)
  const values = rows.map((row) => row.value)
  const maxValue = Math.max(...values, 1)
  const chartLeft = 70
  const chartTop = 95
  const chartWidth = 680
  const chartHeight = 260
  const bottom = chartTop + chartHeight
  const stepX = rows.length > 1 ? chartWidth / (rows.length - 1) : chartWidth

  const yGrid = Array.from({ length: 5 }).map((_, index) => {
    const value = Math.round((maxValue / 4) * index)
    const y = bottom - (chartHeight * index) / 4
    return [
      `<line x1="${chartLeft}" y1="${y}" x2="${chartLeft + chartWidth}" y2="${y}" stroke="#cbd5e1" stroke-width="1" />`,
      `<text x="${chartLeft - 12}" y="${y + 5}" font-family="${EXPORT_FONT_FAMILY}" font-size="12" text-anchor="end" fill="#64748b">${value}</text>`,
    ].join('')
  })

  const points = rows.map((row, index) => {
    const x = chartLeft + (rows.length > 1 ? stepX * index : chartWidth / 2)
    const y = bottom - (row.value / maxValue) * chartHeight
    return { ...row, x, y }
  })

  const chartBody =
    chart.type === 'bar'
      ? points
          .map((point, index) => {
            const barWidth = Math.min(44, chartWidth / Math.max(rows.length * 1.8, 2))
            const x = point.x - barWidth / 2
            const y = point.y
            const barHeight = bottom - y
            return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="8" fill="${index % 2 === 0 ? '#2563eb' : '#14b8a6'}" />`
          })
          .join('')
      : [
          `<path d="M ${points.map((point) => `${point.x} ${point.y}`).join(' L ')}" fill="none" stroke="#2563eb" stroke-width="4" stroke-linejoin="round" stroke-linecap="round" />`,
          ...points.map(
            (point) => `<circle cx="${point.x}" cy="${point.y}" r="5" fill="#ffffff" stroke="#2563eb" stroke-width="3" />`
          ),
        ].join('')

  const labels = points
    .map((point) => {
      const labelStep = rows.length > 10 ? Math.ceil(rows.length / 10) : 1
      const safeLabel = escapeXml(normalizeExportLabel(truncateLabel(point.label, rows.length > 12 ? Math.min(layout.xLabelMaxLength, 12) : layout.xLabelMaxLength), 'Polozka'))
      const showXAxisLabel = points.length <= 10 || points.indexOf(point) % labelStep === 0
      return [
        showXAxisLabel
          ? `<text x="${point.x}" y="${bottom + 24}" font-family="${EXPORT_FONT_FAMILY}" font-size="12" text-anchor="middle" fill="#475569">${safeLabel}</text>`
          : '',
        `<text x="${point.x}" y="${point.y - 12}" font-family="${EXPORT_FONT_FAMILY}" font-size="12" text-anchor="middle" fill="#0f172a">${point.value}</text>`,
      ].join('')
    })
    .join('')

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<rect width="100%" height="100%" fill="#f8fafc" />',
    `<text x="40" y="50" font-family="${EXPORT_FONT_FAMILY}" font-size="28" font-weight="700" fill="#0f172a">${title}</text>`,
    `<text x="40" y="80" font-family="${EXPORT_FONT_FAMILY}" font-size="15" fill="#475569">${description}</text>`,
    `<line x1="${chartLeft}" y1="${bottom}" x2="${chartLeft + chartWidth}" y2="${bottom}" stroke="#0f172a" stroke-width="2" />`,
    `<line x1="${chartLeft}" y1="${chartTop}" x2="${chartLeft}" y2="${bottom}" stroke="#0f172a" stroke-width="2" />`,
    ...yGrid,
    chartBody,
    labels,
    '</svg>',
  ].join('')
}

function getChartHeadline(chart: PendingChart) {
  return chart.reportSpec?.headline || chart.title || 'Datový přehled'
}

function getChartSubheadline(chart: PendingChart) {
  return chart.reportSpec?.subheadline || chart.description || 'Automaticky vygenerovaný přehled nad firemními daty.'
}

function getTopChartRows(chart: PendingChart, limit = 5) {
  if (chart.type === 'pie') {
    return chart.data
      .map((item) => ({
        label: String((item as any).name ?? 'Unknown'),
        value: Number((item as any).value || 0),
      }))
      .sort((left, right) => right.value - left.value)
      .slice(0, limit)
  }

  const normalized = normalizeSeriesData(chart)
  return normalized.rows
    .map((row) => ({
      label: row.label,
      value: row.value,
    }))
    .sort((left, right) => right.value - left.value)
    .slice(0, limit)
}

function getChartKpiSummary(chart: PendingChart) {
  const rows =
    chart.type === 'pie'
      ? chart.data.map((item) => ({
          label: String((item as any).name ?? 'Unknown'),
          value: Number((item as any).value || 0),
        }))
      : normalizeSeriesData(chart).rows.map((row) => ({
          label: row.label,
          value: row.value,
        }))

  const total = rows.reduce((sum, row) => sum + row.value, 0)
  const sorted = [...rows].sort((left, right) => right.value - left.value)
  const top = sorted[0]
  const second = sorted[1]

  return {
    total,
    itemCount: rows.length,
    top,
    second,
  }
}

function createExecutiveInsights(chart: PendingChart) {
  if (Array.isArray(chart.reportSpec?.insights) && chart.reportSpec!.insights!.length > 0) {
    return chart.reportSpec!.insights!.slice(0, 4)
  }

  const summary = getChartKpiSummary(chart)
  const topRows = getTopChartRows(chart, 4)
  const topShare = summary.top && summary.total > 0 ? Math.round((summary.top.value / summary.total) * 100) : 0

  const insights: string[] = []

  if (summary.top) {
    insights.push(`Nejvýraznější položkou je ${summary.top.label} s hodnotou ${summary.top.value}${summary.total > 0 ? `, což představuje přibližně ${topShare} % celku` : ''}.`)
  }

  if (summary.second) {
    insights.push(`Druhá nejsilnější položka je ${summary.second.label} s hodnotou ${summary.second.value}.`)
  }

  if (topRows.length >= 3) {
    insights.push(`Nejsilnější část portfolia tvoří ${topRows.slice(0, 3).map((row) => row.label).join(', ')}.`)
  }

  insights.push(`Celkem graf pracuje s ${summary.itemCount} položkami a agregovanou hodnotou ${summary.total}.`)

  return insights
}

function createRecommendedActions(chart: PendingChart) {
  if (Array.isArray(chart.reportSpec?.recommendedActions) && chart.reportSpec!.recommendedActions!.length > 0) {
    return chart.reportSpec!.recommendedActions!.slice(0, 4)
  }

  const summary = getChartKpiSummary(chart)
  const actions: string[] = []

  if (summary.top) {
    actions.push(`Prověřit detailně segment ${summary.top.label}, protože má v přehledu největší váhu.`)
  }

  actions.push('Sdílet výstup s týmem jako podklad pro prioritizaci dalších kroků.')
  actions.push('Použít stejné seskupení i v navazujícím reportu za delší časové období pro porovnání trendu.')

  return actions
}

function getPresentationKpis(chart: PendingChart) {
  const summary = getChartKpiSummary(chart)
  return [
    {
      label: 'Celkem',
      value: String(summary.total),
    },
    {
      label: 'Položek',
      value: String(summary.itemCount),
    },
    ...(summary.top
      ? [
          {
            label: 'Nejsilnější segment',
            value: String(summary.top.label),
          },
        ]
      : []),
  ].slice(0, 3)
}

function buildFallbackPresentationSlides(chart: PendingChart): PresentationSlideSpec[] {
  const title = getChartHeadline(chart)
  const subtitle = getChartSubheadline(chart)
  const insights = createExecutiveInsights(chart)
  const actions = createRecommendedActions(chart)

  return [
    {
      layout: 'cover',
      title,
      subtitle,
      insight:
        chart.reportSpec?.executiveSummary ||
        'Stručný management přehled vytvořený nad aktuálními daty v PepaOS.',
    },
    {
      layout: 'chart-summary',
      title: 'Klíčové poznatky a vizualizace',
      subtitle: subtitle || 'Shrnutí hlavních signálů z dostupných dat.',
      bullets: insights.slice(0, 4),
      insight: chart.reportSpec?.executiveSummary || insights[0],
      kpis: getPresentationKpis(chart),
    },
    {
      layout: 'actions',
      title: 'Doporučené další kroky',
      subtitle: 'Návrh priorit pro další operativní práci týmu.',
      bullets: actions.slice(0, 4),
      insight: insights[1] || insights[0] || chart.reportSpec?.executiveSummary,
      kpis: getTopChartRows(chart, 3).map((row) => ({
        label: normalizeExportLabel(row.label, 'Polozka'),
        value: String(row.value),
      })),
    },
  ]
}

function normalizePresentationSlideSpec(raw: any, fallback: PresentationSlideSpec): PresentationSlideSpec {
  const parsedBullets = Array.isArray(raw?.bullets)
    ? raw.bullets.map((item: any) => String(item).trim()).filter(Boolean).slice(0, 5)
    : fallback.bullets

  const parsedKpis = Array.isArray(raw?.kpis)
    ? raw.kpis
        .map((item: any) =>
          item && typeof item === 'object'
            ? {
                label: String(item.label ?? '').trim(),
                value: String(item.value ?? '').trim(),
              }
            : null
        )
        .filter((item: { label: string; value: string } | null): item is { label: string; value: string } => Boolean(item?.label && item?.value))
        .slice(0, 4)
    : fallback.kpis

  return {
    layout:
      raw?.layout === 'cover' || raw?.layout === 'chart-summary' || raw?.layout === 'actions'
        ? raw.layout
        : fallback.layout,
    title: typeof raw?.title === 'string' && raw.title.trim() ? raw.title.trim() : fallback.title,
    subtitle: typeof raw?.subtitle === 'string' && raw.subtitle.trim() ? raw.subtitle.trim() : fallback.subtitle,
    bullets: parsedBullets?.length ? parsedBullets : fallback.bullets,
    insight: typeof raw?.insight === 'string' && raw.insight.trim() ? raw.insight.trim() : fallback.insight,
    kpis: parsedKpis?.length ? parsedKpis : fallback.kpis,
  }
}

function getPresentationSlides(chart: PendingChart): PresentationSlideSpec[] {
  const fallbackSlides = buildFallbackPresentationSlides(chart)
  const rawSlides = Array.isArray(chart.reportSpec?.presentation?.slides) ? chart.reportSpec?.presentation?.slides || [] : []

  return fallbackSlides.map((fallbackSlide, index) =>
    rawSlides[index] ? normalizePresentationSlideSpec(rawSlides[index], fallbackSlide) : fallbackSlide
  )
}

function formatPptxBulletText(lines?: string[]) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return 'Bez doplňujících bodů.'
  }

  return lines
    .map((line) => String(line).trim())
    .filter(Boolean)
    .map((line) => `- ${line}`)
    .join('\n')
}

async function createChartNarrativeSpec(chart: PendingChart): Promise<ChartNarrativeSpec | null> {
  if (!openai) return null

  try {
    const summaryRows = getTopChartRows(chart, 8)
    const payload = {
      title: chart.title || 'Datový přehled',
      description: chart.description || '',
      type: chart.type,
      topRows: summaryRows,
      totals: getChartKpiSummary(chart),
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You create concise executive report specs in Czech for business charts. Return valid JSON only with keys headline, subheadline, executiveSummary, insights, recommendedActions, layout, presentation. Keep headline short. Return 3 insights and 3 recommendedActions max. layout may contain preferredChartType, maxCategories, xLabelMaxLength, showSliceLabels, aggregateSmallSlices, sortDescending. Prefer bar charts for many categories such as cities. presentation must contain exactly 3 slides in Czech. Each slide may contain layout (cover, chart-summary, actions), title, subtitle, bullets, insight, kpis. kpis must be an array of objects with label and value. Use concise management language. Do not use markdown.',
        },
        {
          role: 'user',
          content: `Vytvoř executive spec pro tento graf: ${JSON.stringify(payload)}`,
        },
      ],
      max_tokens: 500,
    })

    const raw = completion.choices[0]?.message?.content || '{}'
    const parsed = JSON.parse(raw)
    return {
      headline: typeof parsed.headline === 'string' ? parsed.headline.trim() : undefined,
      subheadline: typeof parsed.subheadline === 'string' ? parsed.subheadline.trim() : undefined,
      executiveSummary: typeof parsed.executiveSummary === 'string' ? parsed.executiveSummary.trim() : undefined,
      insights: Array.isArray(parsed.insights) ? parsed.insights.map((item: any) => String(item).trim()).filter(Boolean).slice(0, 4) : undefined,
      recommendedActions: Array.isArray(parsed.recommendedActions)
        ? parsed.recommendedActions.map((item: any) => String(item).trim()).filter(Boolean).slice(0, 4)
        : undefined,
      layout:
        parsed.layout && typeof parsed.layout === 'object'
          ? {
              preferredChartType: ['pie', 'bar', 'line'].includes(String(parsed.layout.preferredChartType)) ? parsed.layout.preferredChartType : undefined,
              maxCategories: typeof parsed.layout.maxCategories === 'number' ? parsed.layout.maxCategories : undefined,
              xLabelMaxLength: typeof parsed.layout.xLabelMaxLength === 'number' ? parsed.layout.xLabelMaxLength : undefined,
              showSliceLabels: typeof parsed.layout.showSliceLabels === 'boolean' ? parsed.layout.showSliceLabels : undefined,
              aggregateSmallSlices: typeof parsed.layout.aggregateSmallSlices === 'boolean' ? parsed.layout.aggregateSmallSlices : undefined,
              sortDescending: typeof parsed.layout.sortDescending === 'boolean' ? parsed.layout.sortDescending : undefined,
            }
          : undefined,
      presentation:
        parsed.presentation && typeof parsed.presentation === 'object'
          ? {
              slides: Array.isArray(parsed.presentation.slides)
                ? parsed.presentation.slides
                    .slice(0, 3)
                    .map((slide: any, index: number) =>
                      normalizePresentationSlideSpec(slide, buildFallbackPresentationSlides(chart)[index] || buildFallbackPresentationSlides(chart)[0])
                    )
                : undefined,
            }
          : undefined,
    }
  } catch (error) {
    console.log('Failed to create chart narrative spec:', error)
    return null
  }
}

function normalizeChartGrouping(dataSource: 'clients' | 'properties' | 'leads' | 'deals', requested?: string | null) {
  const value = normalizeText(requested || '')

  if (!value) {
    if (dataSource === 'properties') return 'city'
    if (dataSource === 'clients') return 'source'
    if (dataSource === 'leads') return 'source_channel'
    return 'stage'
  }

  if (value.includes('mesto') || value === 'city') return 'city'
  if (value.includes('lokalit') || value === 'locality') return 'locality'
  if (value.includes('typ') || value.includes('type') || value === 'property_type') return 'property_type'
  if (value.includes('stav') || value === 'status') return 'status'
  if (value.includes('zdroj') || value === 'source') return dataSource === 'leads' ? 'source_channel' : 'source'
  if (value.includes('owner') || value.includes('vlastnik')) return 'owner'
  if (value.includes('stage')) return 'stage'

  return requested || (dataSource === 'properties' ? 'city' : dataSource === 'clients' ? 'source' : dataSource === 'leads' ? 'source_channel' : 'stage')
}

function cleanChartGroupingLabel(value: any, groupBy: string) {
  const raw = String(value ?? '').trim()
  if (!raw) return 'Neuvedeno'

  let cleaned = raw
    .replace(/^\s*\d+\s*m²\s+/i, '')
    .replace(/^\s*pozemek\s+\d+\s*m²\s+/i, '')
    .replace(/^\s*(prodej|pronajem)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (groupBy === 'city') {
    cleaned = cleaned.replace(/^\d+\s*m²\s+/i, '').trim()
    if (cleaned.includes(',')) {
      const parts = cleaned.split(',').map((part) => part.trim()).filter(Boolean)
      cleaned = parts[parts.length - 1] || cleaned
    }
    if (cleaned.includes(' - ')) {
      cleaned = cleaned.split(' - ')[0].trim()
    }
  }

  return cleaned || 'Neuvedeno'
}

async function buildDatabaseChart(params: {
  dataSource: 'clients' | 'properties' | 'leads' | 'deals'
  groupBy?: string
  chartType?: 'pie' | 'bar' | 'line'
  title?: string
  description?: string
}): Promise<PendingChart> {
  const dataSource = params.dataSource
  const chartType = params.chartType || 'bar'
  const groupBy = normalizeChartGrouping(dataSource, params.groupBy)

  const table = dataSource
  const selectColumns =
    dataSource === 'properties'
      ? `${groupBy},created_at`
      : dataSource === 'clients'
        ? `${groupBy},created_at`
        : dataSource === 'leads'
          ? `${groupBy},created_at`
          : `${groupBy},closed_at,created_at`

  const { data, error } = await supabase.from(table).select(selectColumns)
  if (error) throw new Error(error.message)

  const grouped = new Map<string, number>()
  ;(data || []).forEach((row: any) => {
    const label = cleanChartGroupingLabel(row[groupBy], groupBy)
    grouped.set(label, (grouped.get(label) || 0) + 1)
  })

  const chartRows = Array.from(grouped.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => right.value - left.value)

  const defaultTitle =
    dataSource === 'properties'
      ? `Nemovitosti podle ${groupBy === 'city' ? 'města' : groupBy === 'locality' ? 'lokality' : groupBy === 'property_type' ? 'typu' : groupBy}`
      : dataSource === 'clients'
        ? `Klienti podle ${groupBy === 'source' ? 'zdroje' : groupBy}`
        : dataSource === 'leads'
          ? `Leady podle ${groupBy === 'source_channel' ? 'zdroje' : groupBy}`
          : `Dealy podle ${groupBy}`

  const defaultDescription =
    dataSource === 'properties'
      ? `Rozdělení nemovitostí podle pole ${groupBy}.`
      : `Rozdělení ${dataSource} podle pole ${groupBy}.`

  return {
    type: chartType,
    title: params.title || defaultTitle,
    description: params.description || defaultDescription,
    createdAt: new Date().toISOString(),
    data: chartRows,
  }
}

async function sendPreparedChartEmail(
  userId: string,
  chart: PendingChart,
  parsedArgs: Record<string, any>
) {
  const chartTitle = chart.title || 'Vygenerovaný graf'
  const chartFilenameBase = getChartAttachmentBaseName(chart)
  const chartEmailBody = [
    parsedArgs.body || `V příloze posílám výstup z ${REPORT_BRAND_NAME}: ${chartTitle}.`,
    '',
    summarizeChart(chart),
  ].join('\n')
  const chartEmailHtml = createChartEmailHtml(chart, parsedArgs.body)
  const {
    includeHtmlReport,
    includeSvg,
    includeJpeg,
    includeCsv,
    includePresentation,
    includePptx,
    includePdf,
  } = buildAttachmentFlags(parsedArgs)

  const chartAttachments: EmailAttachment[] = []

  if (includeHtmlReport) {
    chartAttachments.push({
      filename: `${chartFilenameBase}-report.html`,
      contentType: 'text/html; charset=UTF-8',
      content: createChartAttachmentHtml(chart),
    })
  }
  if (includeSvg) {
    chartAttachments.push({
      filename: `${chartFilenameBase}.svg`,
      contentType: 'image/svg+xml',
      content: createChartSvg(chart),
    })
  }
  if (includeJpeg) {
    chartAttachments.push({
      filename: `${chartFilenameBase}.jpg`,
      contentType: 'image/jpeg',
      content: await createChartJpegBase64(chart),
      encoding: 'base64',
    })
  }
  if (includePdf) {
    chartAttachments.push({
      filename: `${chartFilenameBase}-report.pdf`,
      contentType: 'application/pdf',
      content: await createChartPdfBase64(chart),
      encoding: 'base64',
    })
  }
  if (includeCsv) {
    chartAttachments.push({
      filename: `${chartFilenameBase}.csv`,
      contentType: 'text/csv; charset=UTF-8',
      content: createChartCsv(chart),
    })
  }
  if (includePresentation) {
    chartAttachments.push({
      filename: `${chartFilenameBase}-prezentace.html`,
      contentType: 'text/html; charset=UTF-8',
      content: createPresentationHtml(chart),
    })
  }
  if (includePptx) {
    chartAttachments.push({
      filename: `${chartFilenameBase}-prezentace.pptx`,
      contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      content: await createPresentationPptxBase64(chart),
      encoding: 'base64',
    })
  }

  pendingChartByUser[userId] = chart
  const chartMailResult = await send_email(
    parsedArgs.to,
    parsedArgs.subject || `${REPORT_BRAND_NAME}: ${chartTitle}`,
    chartEmailBody,
    chartEmailHtml,
    chartAttachments
  )
  delete pendingChartByUser[userId]
  return chartMailResult
}

function createChartDataTableHtml(chart: PendingChart, limit = 10) {
  const rows =
    chart.type === 'pie'
      ? chart.data.map((item) => ({
          label: String((item as any).name ?? 'Unknown'),
          value: Number((item as any).value || 0),
        }))
      : normalizeSeriesData(chart).rows.map((row) => ({
          label: row.label,
          value: row.value,
        }))

  const topRows = [...rows].sort((left, right) => right.value - left.value).slice(0, limit)

  const body = topRows
    .map(
      (row, index) => `
        <tr>
          <td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;color:#334155;">${index + 1}</td>
          <td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-weight:600;">${escapeXml(row.label)}</td>
          <td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;color:#0f172a;text-align:right;">${row.value}</td>
        </tr>
      `
    )
    .join('')

  return `
    <table style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;">
      <thead style="background:#f8fafc;">
        <tr>
          <th style="padding:12px 14px;text-align:left;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#64748b;">#</th>
          <th style="padding:12px 14px;text-align:left;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#64748b;">Položka</th>
          <th style="padding:12px 14px;text-align:right;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#64748b;">Hodnota</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `
}

function createPresentationHtml(chart: PendingChart) {
  const title = escapeXml(getChartHeadline(chart))
  const slides = getPresentationSlides(chart)
  const generatedAt = escapeXml(
    new Date(chart.createdAt || Date.now()).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' })
  )

  const slideHtml = slides
    .map((slide, index) => {
      const safeTitle = escapeXml(slide.title)
      const safeSubtitle = slide.subtitle ? `<p>${escapeXml(slide.subtitle)}</p>` : ''
      const bulletList =
        Array.isArray(slide.bullets) && slide.bullets.length > 0
          ? `<ul>${slide.bullets.map((line) => `<li>${escapeXml(line)}</li>`).join('')}</ul>`
          : '<p style="color:#64748b;">Bez dalších bodů.</p>'
      const insightBlock = slide.insight
        ? `<div class="panel"><h2 style="font-size:22px;margin:0 0 16px;">Hlavní insight</h2><p style="margin:0;color:#334155;line-height:1.7;">${escapeXml(slide.insight)}</p></div>`
        : ''
      const kpiBlock =
        Array.isArray(slide.kpis) && slide.kpis.length > 0
          ? `<div class="panel"><h2 style="font-size:22px;margin:0 0 16px;">Klíčové ukazatele</h2><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">${slide.kpis
              .map(
                (item) =>
                  `<div style="padding:14px;border:1px solid #dbeafe;border-radius:18px;background:#eff6ff;"><div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#1d4ed8;font-weight:700;">${escapeXml(item.label)}</div><div style="margin-top:8px;font-size:22px;font-weight:700;color:#0f172a;">${escapeXml(item.value)}</div></div>`
              )
              .join('')}</div></div>`
          : `<div class="panel"><h2 style="font-size:22px;margin:0 0 16px;">Top data</h2>${createChartDataTableHtml(chart, 6)}</div>`

      if (slide.layout === 'cover' || index === 0) {
        return `<section class="slide"><span class="eyebrow">${escapeXml(REPORT_BRAND_NAME)}</span><h1>${safeTitle}</h1>${safeSubtitle}<p class="meta">Vygenerováno: ${generatedAt}</p>${slide.insight ? `<div class="panel" style="margin-top:28px;"><p style="margin:0;color:#334155;line-height:1.8;">${escapeXml(slide.insight)}</p></div>` : ''}</section>`
      }

      if (slide.layout === 'chart-summary') {
        return `<section class="slide"><h2>${safeTitle}</h2>${safeSubtitle}<div class="grid"><div class="panel chart">${createChartSvg(chart)}</div><div class="panel"><h2 style="font-size:22px;margin:0 0 16px;">Klíčové body</h2>${bulletList}</div></div><div class="grid" style="margin-top:22px;">${insightBlock || '<div class="panel"></div>'}${kpiBlock}</div></section>`
      }

      return `<section class="slide"><h2>${safeTitle}</h2>${safeSubtitle}<div class="grid"><div class="panel">${bulletList}</div>${kpiBlock}</div>${slide.insight ? `<div class="panel" style="margin-top:22px;"><h2 style="font-size:22px;margin:0 0 16px;">Komentář</h2><p style="margin:0;color:#334155;line-height:1.7;">${escapeXml(slide.insight)}</p></div>` : ''}</section>`
    })
    .join('')

  return [
    '<!doctype html>',
    '<html lang="cs">',
    '<head>',
    '<meta charset="utf-8" />',
    `<title>${title}</title>`,
    '<style>',
    'body{font-family:Arial,sans-serif;background:linear-gradient(180deg,#dbeafe 0%,#f8fafc 100%);margin:0;padding:28px;color:#0f172a}',
    '.slide{background:#fff;border-radius:28px;padding:40px;margin:0 auto 28px;max-width:1080px;box-shadow:0 24px 60px rgba(15,23,42,.12);border:1px solid #dbeafe}',
    '.eyebrow{display:inline-block;padding:8px 14px;border-radius:999px;background:#e0f2fe;color:#075985;font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;margin-bottom:20px}',
    'h1{font-size:40px;margin:0 0 14px} h2{font-size:28px;margin:0 0 18px}',
    'p,li{font-size:18px;line-height:1.7} ul{margin:0;padding-left:24px}',
    '.meta{color:#475569;font-size:15px}',
    '.chart{margin-top:20px}',
    '.grid{display:grid;grid-template-columns:1.1fr .9fr;gap:28px}',
    '.panel{background:#f8fafc;border:1px solid #e2e8f0;border-radius:20px;padding:22px}',
    '</style>',
    '</head>',
    '<body>',
    slideHtml,
    '</body>',
    '</html>',
  ].join('')
}

function createChartAttachmentHtml(chart: PendingChart) {
  const title = escapeXml(getChartHeadline(chart))
  const description = escapeXml(getChartSubheadline(chart))
  const generatedAt = escapeXml(
    new Date(chart.createdAt || Date.now()).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' })
  )
  const summaryItems = createExecutiveInsights(chart)
    .map((line) => `<li>${escapeXml(line)}</li>`)
    .join('')
  const recommendedActions = createRecommendedActions(chart)
    .map((line) => `<li>${escapeXml(line)}</li>`)
    .join('')

  return [
    '<!doctype html>',
    '<html lang="cs">',
    '<head>',
    '<meta charset="utf-8" />',
    `<title>${title}</title>`,
    '<style>',
    'body{font-family:Arial,sans-serif;background:linear-gradient(180deg,#f8fafc 0%,#eef2ff 100%);margin:0;padding:32px;color:#0f172a}',
    '.wrap{max-width:1180px;margin:0 auto}',
    '.hero{background:linear-gradient(135deg,#0f172a 0%,#1d4ed8 55%,#38bdf8 100%);color:#fff;border-radius:28px;padding:34px 36px;box-shadow:0 24px 48px rgba(15,23,42,.18);margin-bottom:24px}',
    '.card{background:#fff;border:1px solid #e2e8f0;border-radius:24px;padding:28px 32px;box-shadow:0 14px 34px rgba(15,23,42,.08);margin-bottom:24px}',
    '.grid{display:grid;grid-template-columns:1.2fr .8fr;gap:24px;align-items:start}',
    'h1{font-size:36px;margin:0 0 10px} h2{font-size:22px;margin:0 0 16px}',
    'p,li{font-size:16px;line-height:1.65} ul{padding-left:22px;margin:0}',
    '.meta{color:#64748b;font-size:14px}',
    '.chart svg{width:100%;height:auto;display:block}',
    '.pill{display:inline-flex;padding:8px 12px;border-radius:999px;background:rgba(255,255,255,.16);font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;margin-bottom:18px}',
    '</style>',
    '</head>',
    '<body>',
    '<div class="wrap">',
    `<section class="hero"><span class="pill">${escapeXml(REPORT_BRAND_NAME)}</span><h1>${title}</h1><p>${description}</p><p style="margin-top:14px;font-size:14px;opacity:.9;">Vygenerováno ${generatedAt}</p></section>`,
    `<section class="card"><div class="grid"><div><h2>Graf</h2><div class="chart">${createChartSvg(chart)}</div></div><div><h2>Executive summary</h2><ul>${summaryItems}</ul></div></div></section>`,
    `<section class="card"><div class="grid"><div><h2>Doporučení</h2><ul>${recommendedActions}</ul></div><div><h2>Top položky</h2>${createChartDataTableHtml(chart, 10)}</div></div></section>`,
    '</div>',
    '</body>',
    '</html>',
  ].join('')
}

function createChartCsv(chart: PendingChart) {
  if (!chart.data.length) {
    return 'label,value'
  }

  const keys = Object.keys(chart.data[0] as Record<string, string | number>)
  const escapeCsv = (value: string | number) => {
    const raw = String(value ?? '')
    return /[",\n;]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw
  }

  const header = keys.map(escapeCsv).join(',')
  const rows = chart.data.map((row) =>
    keys.map((key) => escapeCsv((row as Record<string, string | number>)[key] ?? '')).join(',')
  )

  return [header, ...rows].join('\n')
}

async function createChartJpegBase64(chart: PendingChart) {
  const svg = createChartSvg(chart)
  return await sharp(Buffer.from(svg, 'utf8'))
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer()
    .then((buffer) => buffer.toString('base64'))
}

const REPORT_BRAND_NAME = 'PepaOS Back Office'
const REPORT_BRAND_TAGLINE = 'Executive output prepared by PepaOS'

function getChartAttachmentBaseName(chart: PendingChart) {
  const dateStamp = new Date(chart.createdAt || Date.now()).toISOString().slice(0, 10).replace(/-/g, '')
  return `pepaos-${slugifyFilename(chart.title || 'graf')}-${dateStamp}`
}

async function createChartPdfBase64(chart: PendingChart) {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([842, 595])
  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const jpgBytes = Buffer.from(await createChartJpegBase64(chart), 'base64')
  const jpgImage = await pdf.embedJpg(jpgBytes)
  const imageDims = jpgImage.scale(0.48)
  const insights = createExecutiveInsights(chart)
  const actions = createRecommendedActions(chart)
  const generatedAt = new Date(chart.createdAt || Date.now()).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' })

  page.drawRectangle({ x: 0, y: 0, width: 842, height: 595, color: rgb(0.97, 0.98, 1) })
  page.drawRectangle({ x: 28, y: 500, width: 786, height: 66, color: rgb(0.06, 0.1, 0.2) })
  page.drawText(REPORT_BRAND_NAME.toUpperCase(), { x: 46, y: 540, size: 11, font: fontBold, color: rgb(0.75, 0.9, 1) })
  page.drawText(getChartHeadline(chart), { x: 46, y: 514, size: 24, font: fontBold, color: rgb(1, 1, 1) })
  page.drawText(getChartSubheadline(chart), { x: 46, y: 490, size: 10, font: fontRegular, color: rgb(0.85, 0.9, 0.96) })

  page.drawImage(jpgImage, {
    x: 36,
    y: 160,
    width: Math.min(imageDims.width, 360),
    height: Math.min(imageDims.height, 250),
  })

  page.drawText(`Vygenerováno: ${generatedAt}`, { x: 36, y: 140, size: 10, font: fontRegular, color: rgb(0.39, 0.45, 0.55) })

  page.drawText('Executive summary', { x: 440, y: 455, size: 16, font: fontBold, color: rgb(0.06, 0.1, 0.2) })
  insights.slice(0, 4).forEach((line, index) => {
    page.drawText(`• ${line}`, {
      x: 440,
      y: 430 - index * 28,
      size: 11,
      font: fontRegular,
      color: rgb(0.2, 0.24, 0.3),
      maxWidth: 330,
      lineHeight: 14,
    })
  })

  page.drawText('Doporučené kroky', { x: 440, y: 280, size: 16, font: fontBold, color: rgb(0.06, 0.1, 0.2) })
  actions.slice(0, 3).forEach((line, index) => {
    page.drawText(`• ${line}`, {
      x: 440,
      y: 255 - index * 28,
      size: 11,
      font: fontRegular,
      color: rgb(0.2, 0.24, 0.3),
      maxWidth: 330,
      lineHeight: 14,
    })
  })

  const bytes = await pdf.save()
  return Buffer.from(bytes).toString('base64')
}

async function createPresentationPptxBase64(chart: PendingChart) {
  try {
    const pptx = new PptxGenJS()
    pptx.layout = 'LAYOUT_WIDE'
    pptx.author = REPORT_BRAND_NAME
    pptx.company = REPORT_BRAND_NAME
    pptx.subject = getChartHeadline(chart)
    pptx.title = getChartHeadline(chart)
    pptx.theme = {
      headFontFace: 'Aptos Display',
      bodyFontFace: 'Aptos',
    }

    const chartJpegDataUri = `data:image/jpeg;base64,${await createChartJpegBase64(chart)}`
    const generatedAt = new Date(chart.createdAt || Date.now()).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' })
    const slides = getPresentationSlides(chart)

    slides.forEach((slide, index) => {
      const pptSlide = pptx.addSlide()
      pptSlide.background = { color: index === 0 ? 'F8FAFC' : 'FFFFFF' }

      if (slide.layout === 'cover' || index === 0) {
        pptSlide.addShape(pptx.ShapeType.roundRect, { x: 0.3, y: 0.3, w: 12.7, h: 1, fill: { color: '0F172A' }, line: { color: '0F172A' } })
        pptSlide.addText(REPORT_BRAND_TAGLINE, { x: 0.55, y: 0.55, w: 4.8, h: 0.25, fontSize: 10, bold: true, color: 'BAE6FD' })
        pptSlide.addText(slide.title, { x: 0.55, y: 1.55, w: 9.2, h: 0.65, fontSize: 24, bold: true, color: '0F172A' })
        if (slide.subtitle) {
          pptSlide.addText(slide.subtitle, { x: 0.55, y: 2.2, w: 8.8, h: 0.6, fontSize: 12, color: '475569' })
        }
        if (slide.insight) {
          pptSlide.addShape(pptx.ShapeType.roundRect, { x: 0.55, y: 3.0, w: 7.9, h: 1.4, rectRadius: 0.12, fill: { color: 'FFFFFF' }, line: { color: 'DBEAFE' } })
          pptSlide.addText(slide.insight, { x: 0.8, y: 3.35, w: 7.3, h: 0.7, fontSize: 13, color: '334155', breakLine: true })
        }
        if (Array.isArray(slide.kpis) && slide.kpis.length > 0) {
          slide.kpis.slice(0, 3).forEach((item, kpiIndex) => {
            pptSlide.addShape(pptx.ShapeType.roundRect, { x: 8.8, y: 1.65 + kpiIndex * 1.25, w: 3.4, h: 0.95, rectRadius: 0.1, fill: { color: 'EFF6FF' }, line: { color: 'BFDBFE' } })
            pptSlide.addText(item.label, { x: 9.05, y: 1.88 + kpiIndex * 1.25, w: 2.9, h: 0.2, fontSize: 9, bold: true, color: '1D4ED8' })
            pptSlide.addText(item.value, { x: 9.05, y: 2.13 + kpiIndex * 1.25, w: 2.9, h: 0.3, fontSize: 18, bold: true, color: '0F172A' })
          })
        }
        pptSlide.addText(`Vygenerováno: ${generatedAt}`, { x: 0.55, y: 6.8, w: 3.5, h: 0.25, fontSize: 10, color: '64748B' })
        pptSlide.addText(REPORT_BRAND_NAME, { x: 8.2, y: 6.75, w: 4.1, h: 0.25, align: 'right', fontSize: 11, color: '64748B' })
        return
      }

      pptSlide.addText(slide.title, { x: 0.55, y: 0.45, w: 7.0, h: 0.42, fontSize: 22, bold: true, color: '0F172A' })
      if (slide.subtitle) {
        pptSlide.addText(slide.subtitle, { x: 0.55, y: 0.88, w: 8.8, h: 0.28, fontSize: 11, color: '64748B' })
      }

      if (slide.layout === 'chart-summary') {
        pptSlide.addImage({ data: chartJpegDataUri, x: 0.55, y: 1.25, w: 6.15, h: 3.75 })
        pptSlide.addShape(pptx.ShapeType.roundRect, { x: 7.05, y: 1.25, w: 5.65, h: 4.15, rectRadius: 0.12, fill: { color: 'F8FAFC' }, line: { color: 'E2E8F0' } })
        pptSlide.addText('Klíčové body', { x: 7.35, y: 1.55, w: 2.6, h: 0.25, fontSize: 15, bold: true, color: '0F172A' })
        pptSlide.addText(formatPptxBulletText(slide.bullets), { x: 7.3, y: 1.95, w: 5.0, h: 2.45, fontSize: 11, color: '334155', breakLine: true, paraSpaceAfter: 10 })
        if (slide.insight) {
          pptSlide.addText('Executive insight', { x: 7.35, y: 4.55, w: 2.8, h: 0.22, fontSize: 13, bold: true, color: '0F172A' })
          pptSlide.addText(slide.insight, { x: 7.35, y: 4.86, w: 5.0, h: 0.55, fontSize: 10, color: '475569', breakLine: true })
        }
        if (Array.isArray(slide.kpis) && slide.kpis.length > 0) {
          slide.kpis.slice(0, 3).forEach((item, kpiIndex) => {
            pptSlide.addShape(pptx.ShapeType.roundRect, { x: 0.75 + kpiIndex * 2.05, y: 5.35, w: 1.85, h: 0.95, rectRadius: 0.1, fill: { color: 'EFF6FF' }, line: { color: 'BFDBFE' } })
            pptSlide.addText(item.label, { x: 0.95 + kpiIndex * 2.05, y: 5.58, w: 1.45, h: 0.18, fontSize: 8, bold: true, color: '1D4ED8' })
            pptSlide.addText(item.value, { x: 0.95 + kpiIndex * 2.05, y: 5.83, w: 1.45, h: 0.24, fontSize: 14, bold: true, color: '0F172A' })
          })
        }
        return
      }

      pptSlide.addShape(pptx.ShapeType.roundRect, { x: 0.55, y: 1.15, w: 5.8, h: 5.55, rectRadius: 0.12, fill: { color: 'F8FAFC' }, line: { color: 'E2E8F0' } })
      pptSlide.addShape(pptx.ShapeType.roundRect, { x: 6.6, y: 1.15, w: 6.1, h: 5.55, rectRadius: 0.12, fill: { color: 'F8FAFC' }, line: { color: 'E2E8F0' } })
      pptSlide.addText('Doporučené kroky', { x: 0.85, y: 1.45, w: 2.6, h: 0.25, fontSize: 15, bold: true, color: '0F172A' })
      pptSlide.addText(formatPptxBulletText(slide.bullets), { x: 0.8, y: 1.85, w: 5.0, h: 3.65, fontSize: 11, color: '334155', breakLine: true, paraSpaceAfter: 10 })
      if (slide.insight) {
        pptSlide.addText('Komentář', { x: 0.85, y: 5.72, w: 2.0, h: 0.2, fontSize: 13, bold: true, color: '0F172A' })
        pptSlide.addText(slide.insight, { x: 0.85, y: 6.0, w: 5.0, h: 0.45, fontSize: 10, color: '475569', breakLine: true })
      }

      pptSlide.addText('Top data a KPI', { x: 6.9, y: 1.45, w: 2.6, h: 0.25, fontSize: 15, bold: true, color: '0F172A' })
      if (Array.isArray(slide.kpis) && slide.kpis.length > 0) {
        slide.kpis.slice(0, 4).forEach((item, rowIndex) => {
          pptSlide.addText(item.label, { x: 6.95, y: 1.92 + rowIndex * 0.72, w: 3.95, h: 0.22, fontSize: 11, bold: true, color: '0F172A' })
          pptSlide.addText(item.value, { x: 10.95, y: 1.92 + rowIndex * 0.72, w: 1.0, h: 0.22, fontSize: 11, align: 'right', color: '334155' })
          pptSlide.addShape(pptx.ShapeType.line, { x: 6.9, y: 2.3 + rowIndex * 0.72, w: 5.15, h: 0, line: { color: 'E2E8F0', width: 1 } })
        })
      } else {
        getTopChartRows(chart, 6).forEach((row, rowIndex) => {
          pptSlide.addText(`${rowIndex + 1}. ${row.label}`, { x: 6.95, y: 1.92 + rowIndex * 0.62, w: 4.0, h: 0.22, fontSize: 11, bold: true, color: '0F172A' })
          pptSlide.addText(String(row.value), { x: 11.05, y: 1.92 + rowIndex * 0.62, w: 0.9, h: 0.22, fontSize: 11, align: 'right', color: '334155' })
          pptSlide.addShape(pptx.ShapeType.line, { x: 6.9, y: 2.28 + rowIndex * 0.62, w: 5.15, h: 0, line: { color: 'E2E8F0', width: 1 } })
        })
      }
    })

    const output = await pptx.write({ outputType: 'nodebuffer' })
    const normalizedBuffer =
      output instanceof Uint8Array
        ? Buffer.from(output)
        : output instanceof ArrayBuffer
          ? Buffer.from(new Uint8Array(output))
          : Buffer.isBuffer(output)
            ? output
            : Buffer.from(String(output))
    return normalizedBuffer.toString('base64')
  } catch (error) {
    console.log('Failed to create advanced PPTX presentation, using fallback deck:', error)

    const fallback = new PptxGenJS()
    fallback.layout = 'LAYOUT_WIDE'
    fallback.author = REPORT_BRAND_NAME
    fallback.company = REPORT_BRAND_NAME
    fallback.subject = getChartHeadline(chart)
    fallback.title = getChartHeadline(chart)

    const generatedAt = new Date(chart.createdAt || Date.now()).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' })
    const slides = buildFallbackPresentationSlides(chart)
    const topRowsText = getTopChartRows(chart, 6)
      .map((row, index) => `${index + 1}. ${row.label}: ${row.value}`)
      .join('\n')

    const cover = fallback.addSlide()
    cover.background = { color: 'F8FAFC' }
    cover.addText(getChartHeadline(chart), { x: 0.6, y: 1.3, w: 8.8, h: 0.6, fontSize: 24, bold: true, color: '0F172A' })
    cover.addText(getChartSubheadline(chart), { x: 0.6, y: 2.0, w: 8.8, h: 0.5, fontSize: 12, color: '475569' })
    cover.addText(`Vygenerováno: ${generatedAt}`, { x: 0.6, y: 2.75, w: 3.5, h: 0.2, fontSize: 10, color: '64748B' })
    if (slides[0]?.insight) {
      cover.addShape(fallback.ShapeType.roundRect, { x: 0.6, y: 3.3, w: 7.6, h: 1.25, rectRadius: 0.08, fill: { color: 'FFFFFF' }, line: { color: 'DBEAFE' } })
      cover.addText(slides[0].insight, { x: 0.85, y: 3.65, w: 7.1, h: 0.55, fontSize: 12, color: '334155', breakLine: true })
    }

    const chartSlide = fallback.addSlide()
    chartSlide.background = { color: 'FFFFFF' }
    chartSlide.addText(slides[1]?.title || 'Shrnutí a hlavní zjištění', { x: 0.55, y: 0.45, w: 7.2, h: 0.35, fontSize: 20, bold: true, color: '0F172A' })
    if (slides[1]?.subtitle) {
      chartSlide.addText(slides[1].subtitle!, { x: 0.55, y: 0.88, w: 9.5, h: 0.22, fontSize: 11, color: '64748B' })
    }
    chartSlide.addShape(fallback.ShapeType.roundRect, { x: 0.55, y: 1.3, w: 5.9, h: 4.8, rectRadius: 0.1, fill: { color: 'F8FAFC' }, line: { color: 'E2E8F0' } })
    chartSlide.addShape(fallback.ShapeType.roundRect, { x: 6.75, y: 1.3, w: 5.95, h: 4.8, rectRadius: 0.1, fill: { color: 'F8FAFC' }, line: { color: 'E2E8F0' } })
    chartSlide.addText('Klíčové body', { x: 0.85, y: 1.6, w: 2.5, h: 0.2, fontSize: 14, bold: true, color: '0F172A' })
    chartSlide.addText(formatPptxBulletText(slides[1]?.bullets), { x: 0.85, y: 1.95, w: 5.0, h: 2.5, fontSize: 11, color: '334155', breakLine: true })
    chartSlide.addText('Top segmenty', { x: 7.05, y: 1.6, w: 2.5, h: 0.2, fontSize: 14, bold: true, color: '0F172A' })
    chartSlide.addText(topRowsText || 'Bez dat.', { x: 7.05, y: 1.95, w: 5.0, h: 2.8, fontSize: 11, color: '334155', breakLine: true })
    if (slides[1]?.insight) {
      chartSlide.addText('Executive insight', { x: 0.85, y: 4.95, w: 2.6, h: 0.2, fontSize: 13, bold: true, color: '0F172A' })
      chartSlide.addText(slides[1].insight!, { x: 0.85, y: 5.25, w: 11.2, h: 0.45, fontSize: 10, color: '475569', breakLine: true })
    }

    const actionsSlide = fallback.addSlide()
    actionsSlide.background = { color: 'FFFFFF' }
    actionsSlide.addText(slides[2]?.title || 'Doporučené další kroky', { x: 0.55, y: 0.45, w: 6.0, h: 0.35, fontSize: 20, bold: true, color: '0F172A' })
    if (slides[2]?.subtitle) {
      actionsSlide.addText(slides[2].subtitle!, { x: 0.55, y: 0.88, w: 9.5, h: 0.22, fontSize: 11, color: '64748B' })
    }
    actionsSlide.addShape(fallback.ShapeType.roundRect, { x: 0.55, y: 1.3, w: 5.9, h: 4.9, rectRadius: 0.1, fill: { color: 'F8FAFC' }, line: { color: 'E2E8F0' } })
    actionsSlide.addShape(fallback.ShapeType.roundRect, { x: 6.75, y: 1.3, w: 5.95, h: 4.9, rectRadius: 0.1, fill: { color: 'F8FAFC' }, line: { color: 'E2E8F0' } })
    actionsSlide.addText('Doporučené kroky', { x: 0.85, y: 1.6, w: 2.5, h: 0.2, fontSize: 14, bold: true, color: '0F172A' })
    actionsSlide.addText(formatPptxBulletText(slides[2]?.bullets), { x: 0.85, y: 1.95, w: 5.0, h: 2.9, fontSize: 11, color: '334155', breakLine: true })
    actionsSlide.addText('Top data a KPI', { x: 7.05, y: 1.6, w: 2.5, h: 0.2, fontSize: 14, bold: true, color: '0F172A' })
    actionsSlide.addText(topRowsText || 'Bez dat.', { x: 7.05, y: 1.95, w: 5.0, h: 2.9, fontSize: 11, color: '334155', breakLine: true })
    if (slides[2]?.insight) {
      actionsSlide.addText('Komentář', { x: 0.85, y: 5.1, w: 2.0, h: 0.2, fontSize: 13, bold: true, color: '0F172A' })
      actionsSlide.addText(slides[2].insight!, { x: 0.85, y: 5.4, w: 11.0, h: 0.35, fontSize: 10, color: '475569', breakLine: true })
    }

    const output = await fallback.write({ outputType: 'nodebuffer' })
    const normalizedBuffer =
      output instanceof Uint8Array
        ? Buffer.from(output)
        : output instanceof ArrayBuffer
          ? Buffer.from(new Uint8Array(output))
          : Buffer.isBuffer(output)
            ? output
            : Buffer.from(String(output))
    return normalizedBuffer.toString('base64')
  }
}

function createChartEmailHtml(chart: PendingChart, body?: string | null) {
  const title = escapeXml(getChartHeadline(chart))
  const description = escapeXml(getChartSubheadline(chart))
  const intro = escapeXml(body || `V příloze posílám graf: ${title}.`)
  const summaryItems = createExecutiveInsights(chart)
    .map((line) => `<li>${escapeXml(line)}</li>`)
    .join('')

  return [
    '<!doctype html>',
    '<html lang="cs">',
    '<body style="margin:0;padding:24px;background:#f8fafc;color:#0f172a;font-family:Arial,sans-serif;">',
    '<div style="max-width:820px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:24px;overflow:hidden;">',
    '<div style="padding:28px 30px;background:linear-gradient(135deg,#0f172a 0%,#1d4ed8 60%,#38bdf8 100%);color:#ffffff;">',
    `<div style="display:inline-flex;padding:7px 12px;border-radius:999px;background:rgba(255,255,255,.16);font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;margin-bottom:16px;">${escapeXml(REPORT_BRAND_NAME)}</div>`,
    `<h1 style="margin:0 0 8px;font-size:30px;line-height:1.2;">${title}</h1>`,
    `<p style="margin:0;color:rgba(255,255,255,.86);font-size:15px;">${description}</p>`,
    '</div>',
    '<div style="padding:28px 30px;">',
    `<p style="margin:0 0 18px;color:#0f172a;font-size:15px;line-height:1.65;">${intro}</p>`,
    `<div style="margin:0 0 20px;padding:18px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:20px;">${createChartSvg(chart)}</div>`,
    `<h2 style="font-size:18px;margin:0 0 10px;">Shrnutí pro vedení</h2>`,
    `<ul style="padding-left:20px;margin:0;color:#334155;line-height:1.65;">${summaryItems}</ul>`,
    '<p style="margin:20px 0 0;color:#64748b;font-size:13px;">V příloze je přiložen export grafu a případně i další požadované formáty pro další sdílení.</p>',
    '</div>',
    '</div>',
    '</body>',
    '</html>',
  ].join('')
}

function createChartSvg(chart: PendingChart) {
  const layoutChart = applyNarrativeLayout(chart)

  if (layoutChart.type === 'pie') {
    return createPieChartSvg(layoutChart)
  }

  return createCartesianChartSvg(layoutChart)
}

function isMapToolResult(result: any): result is { mapAction: MapAction } {
  return Boolean(result && typeof result === 'object' && result.mapAction)
}

function isDataToolResult(result: any): result is { dataAction: DataAction } {
  return Boolean(result && typeof result === 'object' && result.dataAction)
}

function resolveMarketArgs(
  userId: string,
  parsedArgs: Record<string, any>
): {
  sources: ('sreality' | 'bezrealitky')[]
  category: 'byty' | 'domy'
  locationLabel?: string
  limit?: number
} {
  const previous = pendingMarketContextByUser[userId] || {}

  return {
    sources:
      parsedArgs.sources?.length
        ? parsedArgs.sources
        : previous.sources?.length
          ? previous.sources
          : ['sreality', 'bezrealitky'],
    category: parsedArgs.category || previous.category || 'byty',
    locationLabel:
      typeof parsedArgs.locationLabel !== 'undefined' ? parsedArgs.locationLabel : previous.locationLabel,
    limit: parsedArgs.limit,
  }
}

function extractDatabasePayload(parsedArgs: Record<string, any>, mode: 'create' | 'update') {
  const reservedKeys = new Set([
    'entity',
    'id',
    'query',
    'limit',
    'record',
    'changes',
  ])

  const nested = mode === 'create' ? parsedArgs.record : parsedArgs.changes
  if (nested && typeof nested === 'object' && !Array.isArray(nested) && Object.keys(nested).length > 0) {
    return nested
  }

  return Object.fromEntries(
    Object.entries(parsedArgs).filter(([key, value]) => !reservedKeys.has(key) && typeof value !== 'undefined')
  )
}

function normalizeCalendarText(value?: string | null) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function isValidCalendarEventId(eventId?: string) {
  return Boolean(eventId && eventId !== 'eventId' && eventId.trim().length > 6)
}

function scoreCalendarEventMatch(
  event: CalendarEventLite,
  summary?: string,
  expectedStart?: string
) {
  let score = 0

  if (summary) {
    const targetSummary = normalizeCalendarText(summary)
    const eventSummary = normalizeCalendarText(event.summary)
    if (eventSummary === targetSummary) score += 10
    else if (eventSummary.includes(targetSummary) || targetSummary.includes(eventSummary)) score += 6
  }

  if (expectedStart && event.start) {
    const expected = new Date(expectedStart).getTime()
    const actual = new Date(event.start).getTime()
    const minuteDiff = Math.abs(expected - actual) / 60000
    if (minuteDiff < 1) score += 10
    else if (minuteDiff <= 30) score += 6
    else if (minuteDiff <= 120) score += 2
  }

  return score
}

async function findBestCalendarEventMatch(params: {
  start: string
  end: string
  summary?: string
  expectedStart?: string
}) {
  const events = (await get_calendar_events_in_range(params.start, params.end)) as CalendarEventLite[]
  if (!events.length) {
    throw new Error('V zadaném období jsem nenašel žádné události.')
  }

  const ranked = events
    .filter((event) => !params.summary || normalizeCalendarText(event.summary).includes(normalizeCalendarText(params.summary)) || normalizeCalendarText(params.summary).includes(normalizeCalendarText(event.summary)))
    .map((event) => ({
      event,
      score: scoreCalendarEventMatch(event, params.summary, params.expectedStart),
    }))
    .sort((left, right) => right.score - left.score)

  const best = ranked[0]?.event
  if (!best?.id || !isValidCalendarEventId(best.id)) {
    throw new Error('Nepodařilo se jednoznačně určit konkrétní událost pro úpravu nebo smazání.')
  }

  return best
}

async function findSingleRecordBySearch(entity: 'clients' | 'properties', query: string) {
  const result = await listDataRecords({ entity, query, limit: 25 })
  if (result.count === 0) {
    throw new Error(entity === 'clients' ? `Klienta "${query}" jsem nenašel.` : `Nemovitost "${query}" jsem nenašel.`)
  }
  if (result.count > 1) {
    const preview = result.records
      .slice(0, 5)
      .map((record: any) => (entity === 'clients' ? record.name : record.title))
      .join(', ')
    throw new Error(`Našel jsem více možností pro "${query}": ${preview}. Upřesni prosím výběr.`)
  }
  return result.records[0]
}

function normalizeText(value?: string | null) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function sameText(left?: string | null, right?: string | null) {
  return normalizeText(left) === normalizeText(right)
}

async function findLeadByMatch(params: {
  clientName?: string
  source_channel?: string
  status?: string
  created_at?: string
}) {
  const result = await listDataRecords({ entity: 'leads', query: params.clientName || params.source_channel || params.status || '', limit: 100 })
  const filtered = result.records.filter((record: any) => {
    if (params.clientName && !sameText(record.client_name, params.clientName)) return false
    if (params.source_channel && !sameText(record.source_channel, params.source_channel)) return false
    if (params.status && !sameText(record.status, params.status)) return false
    if (params.created_at) {
      const expected = new Date(params.created_at).getTime()
      const actual = new Date(record.created_at).getTime()
      if (Number.isNaN(expected) || Number.isNaN(actual) || Math.abs(expected - actual) > 60_000) return false
    }
    return true
  })

  if (filtered.length === 0) {
    throw new Error('Odpovídající lead jsem nenašel.')
  }
  if (filtered.length > 1) {
    throw new Error('Našel jsem více odpovídajících leadů. Upřesni prosím klienta, zdroj, status nebo čas vytvoření.')
  }
  return filtered[0]
}

async function findDealByMatch(params: {
  clientName?: string
  propertyTitle?: string
  stage?: string
  amount?: number
}) {
  const result = await listDataRecords({ entity: 'deals', query: params.clientName || params.propertyTitle || params.stage || '', limit: 100 })
  const filtered = result.records.filter((record: any) => {
    if (params.clientName && !sameText(record.client_name, params.clientName)) return false
    if (params.propertyTitle && !sameText(record.property_title, params.propertyTitle)) return false
    if (params.stage && !sameText(record.stage, params.stage)) return false
    if (typeof params.amount === 'number' && Number(record.amount) !== Number(params.amount)) return false
    return true
  })

  if (filtered.length === 0) {
    throw new Error('Odpovídající deal jsem nenašel.')
  }
  if (filtered.length > 1) {
    throw new Error('Našel jsem více odpovídajících dealů. Upřesni prosím klienta, nemovitost, stage nebo částku.')
  }
  return filtered[0]
}

async function findWorkflowByName(name: string) {
  const { data, error } = await supabase.from('workflows').select('*').order('name', { ascending: true })
  if (error) throw new Error(error.message)

  const matches = (data || []).filter((workflow: any) => sameText(workflow.name, name) || normalizeText(workflow.name).includes(normalizeText(name)))
  if (matches.length === 0) {
    throw new Error(`Workflow "${name}" jsem nenašel.`)
  }
  if (matches.length > 1) {
    throw new Error(`Našel jsem více workflow pro "${name}". Upřesni prosím název.`)
  }
  return matches[0]
}

// Define available tools for OpenAI
const tools: any[] = [
  {
    type: "function",
    function: {
      name: "get_all_clients",
      description: "Retrieve all clients from the database with their details",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_all_properties",
      description: "Retrieve all properties from the database",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_all_leads",
      description: "Retrieve all leads from the database",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_all_deals",
      description: "Retrieve all deals from the database",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_weekly_kpis",
      description: "Get weekly key performance indicators",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_client_sources_breakdown",
      description: "Get breakdown of client sources",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            description: "Time period for the breakdown (e.g., 'last_30_days')"
          }
        },
        required: ["period"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "find_properties_missing_reconstruction_data",
      description: "Find properties with missing reconstruction data",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_property_types_pie_chart",
      description: "Create a pie chart showing distribution of properties by type",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_chart",
      description: "Create a chart with specified type and data. Supports pie, bar, and line charts with various data sources.",
      parameters: {
        type: "object",
        properties: {
          chart_type: {
            type: "string",
            enum: ["pie", "bar", "line"],
            description: "Type of chart to create"
          },
          data_source: {
            type: "string",
            enum: ["clients", "properties", "leads", "deals"],
            description: "Which data source to use"
          },
          group_by: {
            type: "string",
            description: "Column to group data by (e.g., 'owner', 'property_type', 'status', 'stage')"
          },
          x_axis: {
            type: "string",
            description: "For line/bar charts: column for X-axis (e.g., 'created_at', 'month')"
          },
          y_axis: {
            type: "string",
            description: "For line/bar charts: what to count/measure on Y-axis"
          }
        },
        required: ["chart_type", "data_source", "group_by"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_database_records",
      description: "List records from the operational database. Use this for the Data page and for searching clients, properties, leads, or deals.",
      parameters: {
        type: "object",
        properties: {
          entity: {
            type: "string",
            enum: ["clients", "properties", "leads", "deals"],
            description: "Database entity to search"
          },
          query: {
            type: "string",
            description: "Optional search text to filter records"
          },
          limit: {
            type: "number",
            description: "Maximum number of records to inspect"
          }
        },
        required: ["entity"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_database_record",
      description: "Load one database record by entity and exact id.",
      parameters: {
        type: "object",
        properties: {
          entity: {
            type: "string",
            enum: ["clients", "properties", "leads", "deals"]
          },
          id: {
            type: "string",
            description: "Exact record id"
          }
        },
        required: ["entity", "id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_database_record",
      description: "Create a new record in clients, properties, leads, or deals. Use field names exactly as the schema expects. Example for clients: { entity: 'clients', record: { name: 'Suotam', source: 'social', owner: 'agent1' } }.",
      parameters: {
        type: "object",
        properties: {
          entity: {
            type: "string",
            enum: ["clients", "properties", "leads", "deals"]
          },
          record: {
            type: "object",
            description: "Field values for the new record"
          }
        },
        required: ["entity", "record"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_client_record",
      description: "Create a new client immediately when the user gives a client name. Use this for requests like 'Vytvoř nového klienta se jménem Suotam, zdroj social, owner agent1'.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Client full name"
          },
          source: {
            type: "string",
            description: "Client source such as social, website, or referral"
          },
          owner: {
            type: "string",
            description: "Assigned owner, for example agent1"
          }
        },
        required: ["name"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_property_record",
      description: "Create a new property immediately when the user gives property fields in natural Czech. Example: 'Vytvoř mi novou nemovitost. Název Barák, Typ house, stav sold, nabídková cena 550000 Kč'.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Property title or name"
          },
          address: {
            type: "string",
            description: "Property address. If missing, use a temporary placeholder like 'Adresa bude doplněna'."
          },
          locality: {
            type: "string",
            description: "Optional locality or district"
          },
          city: {
            type: "string",
            description: "Optional city"
          },
          region: {
            type: "string",
            description: "Optional region"
          },
          property_type: {
            type: "string",
            description: "Property type such as house, apartment, condo"
          },
          status: {
            type: "string",
            description: "Property status such as active, sold, reserved"
          },
          asking_price: {
            type: "number",
            description: "Asking price in CZK"
          },
          reconstruction_status: {
            type: "string",
            description: "Optional reconstruction status"
          },
          structural_modifications: {
            type: "string",
            description: "Optional structural modifications"
          }
        },
        required: ["title"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_lead_record",
      description: "Create a new lead immediately when the user gives lead fields in natural Czech. Example: 'Vytvoř nový lead pro klienta Jan Novák, zdroj facebook, status new'.",
      parameters: {
        type: "object",
        properties: {
          client_id: {
            type: "string",
            description: "Exact client id when known"
          },
          client_name: {
            type: "string",
            description: "Client name to resolve when id is not known"
          },
          source_channel: {
            type: "string",
            description: "Lead source channel, for example facebook, email, phone"
          },
          status: {
            type: "string",
            description: "Lead status, for example new, contacted, qualified"
          }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_deal_record",
      description: "Create a new deal immediately when the user gives deal fields in natural Czech. Example: 'Vytvoř deal pro klienta Jan Novák a nemovitost Barák, stage negotiation, amount 550000'.",
      parameters: {
        type: "object",
        properties: {
          client_id: {
            type: "string",
            description: "Exact client id when known"
          },
          client_name: {
            type: "string",
            description: "Client name to resolve when id is not known"
          },
          property_id: {
            type: "string",
            description: "Exact property id when known"
          },
          property_title: {
            type: "string",
            description: "Property title to resolve when id is not known"
          },
          stage: {
            type: "string",
            description: "Deal stage such as initial, negotiation, closed"
          },
          amount: {
            type: "number",
            description: "Deal amount"
          },
          closed_at: {
            type: "string",
            description: "Optional close date in ISO format"
          }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_client_record_by_name",
      description: "Update a client found by name. Use this for requests like 'Uprav klienta Suotam na Šuotam'.",
      parameters: {
        type: "object",
        properties: {
          currentName: { type: "string", description: "Current client name" },
          newName: { type: "string", description: "New client name" },
          source: { type: "string", description: "Optional new source" },
          owner: { type: "string", description: "Optional new owner" }
        },
        required: ["currentName"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_property_record_by_title",
      description: "Update a property found by title. Use this for requests like 'Uprav nemovitost Barák, stav active'.",
      parameters: {
        type: "object",
        properties: {
          currentTitle: { type: "string", description: "Current property title" },
          title: { type: "string", description: "Optional new property title" },
          address: { type: "string", description: "Optional new address" },
          locality: { type: "string", description: "Optional new locality" },
          city: { type: "string", description: "Optional new city" },
          region: { type: "string", description: "Optional new region" },
          property_type: { type: "string", description: "Optional new property type" },
          status: { type: "string", description: "Optional new status" },
          asking_price: { type: "number", description: "Optional new asking price" },
          reconstruction_status: { type: "string", description: "Optional new reconstruction status" },
          structural_modifications: { type: "string", description: "Optional new structural modifications" }
        },
        required: ["currentTitle"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_lead_record_by_match",
      description: "Update a lead found by natural identifying fields such as client name, source, status, and optional created time.",
      parameters: {
        type: "object",
        properties: {
          clientName: { type: "string", description: "Lead client name" },
          source_channel: { type: "string", description: "Current lead source if known" },
          status: { type: "string", description: "Current lead status if known" },
          created_at: { type: "string", description: "Optional created timestamp to disambiguate" },
          newSourceChannel: { type: "string", description: "New source channel" },
          newStatus: { type: "string", description: "New status" },
          newClientName: { type: "string", description: "Optional new client name if lead should be reassigned" }
        },
        required: ["clientName"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_deal_record_by_match",
      description: "Update a deal found by client name, property title, stage, and optional amount.",
      parameters: {
        type: "object",
        properties: {
          clientName: { type: "string", description: "Deal client name" },
          propertyTitle: { type: "string", description: "Deal property title" },
          stage: { type: "string", description: "Current deal stage if known" },
          amount: { type: "number", description: "Current amount if known" },
          newStage: { type: "string", description: "New stage" },
          newAmount: { type: "number", description: "New amount" },
          newClosedAt: { type: "string", description: "New close time in ISO format" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_client_record_by_name",
      description: "Delete a client found by name. Use this for requests like 'Smaž klienta Suotam'.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Client name to delete" }
        },
        required: ["name"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_property_record_by_title",
      description: "Delete a property found by title. Use this for requests like 'Smaž nemovitost Barák'.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Property title to delete" }
        },
        required: ["title"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_lead_record_by_match",
      description: "Delete a lead found by natural identifying fields such as client name, source, status, and optional created time.",
      parameters: {
        type: "object",
        properties: {
          clientName: { type: "string", description: "Lead client name" },
          source_channel: { type: "string", description: "Current lead source if known" },
          status: { type: "string", description: "Current lead status if known" },
          created_at: { type: "string", description: "Optional created timestamp to disambiguate" }
        },
        required: ["clientName"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_deal_record_by_match",
      description: "Delete a deal found by client name, property title, stage, and optional amount.",
      parameters: {
        type: "object",
        properties: {
          clientName: { type: "string", description: "Deal client name" },
          propertyTitle: { type: "string", description: "Deal property title" },
          stage: { type: "string", description: "Current deal stage if known" },
          amount: { type: "number", description: "Current amount if known" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_scheduled_email_workflow",
      description: "Create a cron-based workflow that sends an email automatically at the scheduled time. Use this when the user wants a recurring or scheduled email task.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Workflow name visible in the workflow list" },
          description: { type: "string", description: "Short workflow description visible in the workflow list" },
          schedule: { type: "string", description: "Cron expression such as 0 9 * * * for every day at 9:00" },
          to: { type: "string", description: "Recipient email address" },
          subject: { type: "string", description: "Email subject" },
          body: { type: "string", description: "Email body" }
        },
        required: ["schedule", "to", "subject", "body"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_market_watch_workflow",
      description: "Create a cron-based workflow that monitors new real-estate listings from selected Czech websites and emails a report. Current supported sources are Sreality and Bezrealitky.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Workflow name" },
          description: { type: "string", description: "Workflow description" },
          schedule: { type: "string", description: "Cron expression such as 0 9 * * *" },
          to: { type: "string", description: "Recipient email address" },
          subject: { type: "string", description: "Email subject" },
          locationLabel: { type: "string", description: "Human-readable watched location, for example Praha Holešovice. Optional if the user wants listings from anywhere." },
          category: {
            type: "string",
            enum: ["byty", "domy"],
            description: "Property category to monitor"
          },
          mode: {
            type: "string",
            enum: ["new", "latest"],
            description: "Use new for only unseen listings since the last run, or latest for the most recent listings every time"
          },
          limit: {
            type: "number",
            description: "How many listings to include, for example 2 or 10"
          },
          sources: {
            type: "array",
            items: { type: "string", enum: ["sreality", "bezrealitky"] },
            description: "Market sources to monitor"
          }
        },
        required: ["schedule", "to", "subject"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_market_listings",
      description: "Get current listings from supported Czech real-estate websites without creating a workflow. Use this for direct questions like 'Jaké jsou poslední dvě nabídky na webu Sreality?'.",
      parameters: {
        type: "object",
        properties: {
          locationLabel: { type: "string", description: "Watched location, for example Praha Holešovice. Optional for anywhere." },
          category: {
            type: "string",
            enum: ["byty", "domy"],
            description: "Property category to query"
          },
          sources: {
            type: "array",
            items: { type: "string", enum: ["sreality", "bezrealitky"] },
            description: "Sources to query"
          },
          limit: { type: "number", description: "How many listings to return" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_market_listing_count",
      description: "Get the current total count of listings from supported real-estate websites, optionally filtered by category and location.",
      parameters: {
        type: "object",
        properties: {
          locationLabel: { type: "string", description: "Optional location such as Praha Holešovice" },
          category: {
            type: "string",
            enum: ["byty", "domy"],
            description: "Property category to count"
          },
          sources: {
            type: "array",
            items: { type: "string", enum: ["sreality", "bezrealitky"] },
            description: "Sources to query"
          }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "sync_sreality_listings_to_database",
      description: "Download listings from Sreality and store them into the internal database. Use this when the user asks to save/import/store Sreality listings into the database.",
      parameters: {
        type: "object",
        properties: {
          locationLabel: { type: "string", description: "Optional location like Praha Holešovice" },
          categories: {
            type: "array",
            items: { type: "string", enum: ["byty", "domy"] },
            description: "Categories to sync. If omitted, sync both byty and domy."
          },
          maxPrice: { type: "number", description: "Optional maximum price in CZK" },
          maxPages: { type: "number", description: "How many Sreality result pages to scan" },
          limit: { type: "number", description: "Maximum number of listings to save. Use this when the user asked for a specific count like 5 or 10." }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "save_recent_market_listings_to_database",
      description: "Save the most recently shown market listings into the internal database. Use this for follow-ups like 'ulož je do databáze' after listings were already displayed, so you save exactly those shown results instead of running a broader sync.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Optional number of the already shown listings to save. If omitted, save all listings from the most recent market result." }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "query_market_listings_database",
      description: "Query stored market listings from the internal database after they were imported from Sreality.",
      parameters: {
        type: "object",
        properties: {
          source: { type: "string", enum: ["sreality"], description: "Market source" },
          locationLabel: { type: "string", description: "Optional location text" },
          city: { type: "string", description: "Optional city filter" },
          district: { type: "string", description: "Optional district filter" },
          category: { type: "string", enum: ["byty", "domy"], description: "Property category" },
          maxPrice: { type: "number", description: "Maximum price in CZK" },
          minPrice: { type: "number", description: "Minimum price in CZK" },
          limit: { type: "number", description: "How many listings to return" },
          query: { type: "string", description: "Free text search" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "count_market_listings_database",
      description: "Count stored market listings in the internal database after they were imported from Sreality.",
      parameters: {
        type: "object",
        properties: {
          source: { type: "string", enum: ["sreality"], description: "Market source" },
          locationLabel: { type: "string", description: "Optional location text" },
          city: { type: "string", description: "Optional city filter" },
          district: { type: "string", description: "Optional district filter" },
          category: { type: "string", enum: ["byty", "domy"], description: "Property category" },
          maxPrice: { type: "number", description: "Maximum price in CZK" },
          minPrice: { type: "number", description: "Minimum price in CZK" },
          query: { type: "string", description: "Free text search" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_workflows",
      description: "List existing workflows and their current status.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "run_workflow_by_name",
      description: "Run an existing workflow immediately by its visible name.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Workflow name" }
        },
        required: ["name"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_workflow_by_name",
      description: "Delete an existing workflow by its visible name.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Workflow name" }
        },
        required: ["name"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_workflow_schedule_by_name",
      description: "Update the cron schedule of an existing workflow by its visible name.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Workflow name" },
          schedule: { type: "string", description: "New cron expression" }
        },
        required: ["name", "schedule"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_database_record",
      description: "Update an existing database record by exact id. Use this after finding the correct record first.",
      parameters: {
        type: "object",
        properties: {
          entity: {
            type: "string",
            enum: ["clients", "properties", "leads", "deals"]
          },
          id: {
            type: "string",
            description: "Exact record id"
          },
          changes: {
            type: "object",
            description: "Changed fields only"
          }
        },
        required: ["entity", "id", "changes"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_database_record",
      description: "Delete a database record by exact id. Only use after finding and confirming the intended record.",
      parameters: {
        type: "object",
        properties: {
          entity: {
            type: "string",
            enum: ["clients", "properties", "leads", "deals"]
          },
          id: {
            type: "string",
            description: "Exact record id"
          }
        },
        required: ["entity", "id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "filter_properties_on_map",
      description: "Filter and highlight properties for the property map page. Use this when the user asks to show, filter, highlight, or find properties on the map.",
      parameters: {
        type: "object",
        properties: {
          city: {
            type: "string",
            description: "City filter, for example Praha or Brno"
          },
          locality: {
            type: "string",
            description: "Locality or district filter"
          },
          propertyType: {
            type: "string",
            description: "Property type filter such as apartment, house, or condo"
          },
          status: {
            type: "string",
            description: "Property status such as active, reserved, pending, or sold"
          },
          missingReconstruction: {
            type: "boolean",
            description: "Whether to only show properties with missing reconstruction data"
          },
          maxPrice: {
            type: "number",
            description: "Maximum asking price in CZK"
          },
          sortBy: {
            type: "string",
            enum: ["price_desc", "price_asc", "newest"],
            description: "Optional sorting for selection logic"
          },
          focusTopResult: {
            type: "boolean",
            description: "Set true if the user asked to find the most expensive property or otherwise highlight the top result"
          }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_calendar_availability",
      description: "Get available time slots from Google Calendar. Returns free slots and suggested meeting times.",
      parameters: {
        type: "object",
        properties: {
          start: {
            type: "string",
            description: "Start date/time in ISO format (e.g., '2024-12-20T09:00:00Z')"
          },
          end: {
            type: "string",
            description: "End date/time in ISO format (e.g., '2024-12-20T18:00:00Z')"
          },
          durationMinutes: {
            type: "number",
            description: "Meeting duration in minutes (default: 30)"
          }
        },
        required: ["start", "end"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "suggest_meeting_slots",
      description: "Get the best suggested meeting time slots from your calendar",
      parameters: {
        type: "object",
        properties: {
          start: {
            type: "string",
            description: "Start date/time in ISO format"
          },
          end: {
            type: "string",
            description: "End date/time in ISO format"
          },
          durationMinutes: {
            type: "number",
            description: "Meeting duration in minutes (default: 30)"
          },
          maxSuggestions: {
            type: "number",
            description: "Maximum number of suggestions (default: 3)"
          }
        },
        required: ["start", "end"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "draft_email",
      description: "Create a Gmail draft email. The email will not be sent until explicitly requested.",
      parameters: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description: "Recipient email address"
          },
          subject: {
            type: "string",
            description: "Email subject"
          },
          body: {
            type: "string",
            description: "Email body text"
          }
        },
        required: ["to", "subject", "body"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_recent_emails",
      description: "List recent inbox emails. Use this when the user wants to read, review, or summarize recent emails.",
      parameters: {
        type: "object",
        properties: {
          maxResults: {
            type: "number",
            description: "Maximum number of recent emails to return"
          }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_email_thread",
      description: "Get a specific email thread with message bodies. Use this after listing emails when the user wants to read a thread in detail.",
      parameters: {
        type: "object",
        properties: {
          threadId: {
            type: "string",
            description: "Exact Gmail thread ID"
          }
        },
        required: ["threadId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "reply_to_email_thread",
      description: "Reply to an email thread. Use only when the user explicitly asks to send a reply.",
      parameters: {
        type: "object",
        properties: {
          threadId: {
            type: "string",
            description: "Exact Gmail thread ID"
          },
          to: {
            type: "string",
            description: "Recipient email address"
          },
          subject: {
            type: "string",
            description: "Reply subject"
          },
          body: {
            type: "string",
            description: "Reply body"
          }
        },
        required: ["threadId", "to", "subject", "body"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "send_email",
      description: "Send an email immediately. Use only when the user explicitly asks to send the email right now.",
      parameters: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description: "Recipient email address"
          },
          subject: {
            type: "string",
            description: "Email subject"
          },
          body: {
            type: "string",
            description: "Email body text"
          }
        },
        required: ["to", "subject", "body"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "send_pending_email",
      description: "Send the most recently prepared email draft after the user explicitly confirms sending.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "send_chart_email",
      description: "Send the currently pending chart as an email attachment to a specified recipient. Use this when user wants to email a previously created chart.",
      parameters: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description: "Recipient email address"
          },
          subject: {
            type: "string",
            description: "Email subject"
          },
          body: {
            type: "string",
            description: "Optional email body text"
          },
          includePresentation: {
            type: "boolean",
            description: "If true, also attach a simple HTML presentation with the chart and summary."
          },
          includePptx: {
            type: "boolean",
            description: "If true, attach the presentation as a real PowerPoint PPTX file."
          },
          includePdf: {
            type: "boolean",
            description: "If true, attach the chart report as a PDF file."
          },
          includeCsv: {
            type: "boolean",
            description: "If true, also attach chart data as a CSV file."
          },
          includeSvg: {
            type: "boolean",
            description: "If true, also attach the chart as SVG."
          },
          includeHtmlReport: {
            type: "boolean",
            description: "If true, also attach the chart report as HTML."
          },
          includeJpeg: {
            type: "boolean",
            description: "If true, also attach the chart rendered as a JPEG image."
          }
        },
        required: ["to"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_and_send_chart_email",
      description: "Create a chart directly from database data and send it immediately by email in the requested format. Prefer this over chaining create_chart + send_chart_email when the user asks to create and send a chart or presentation in one step.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address" },
          data_source: { type: "string", enum: ["clients", "properties", "leads", "deals"] },
          group_by: { type: "string", description: "Grouping field such as city, property_type, locality, status, source, source_channel, or stage" },
          chart_type: { type: "string", enum: ["pie", "bar", "line"], description: "Chart type. Defaults to bar." },
          title: { type: "string", description: "Optional custom chart title" },
          description: { type: "string", description: "Optional custom chart description" },
          subject: { type: "string", description: "Optional email subject" },
          body: { type: "string", description: "Optional email body" },
          includePresentation: { type: "boolean" },
          includePptx: { type: "boolean" },
          includePdf: { type: "boolean" },
          includeCsv: { type: "boolean" },
          includeSvg: { type: "boolean" },
          includeHtmlReport: { type: "boolean" },
          includeJpeg: { type: "boolean" }
        },
        required: ["to", "data_source"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_calendar_event",
      description: "Create an event in Google Calendar",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "Event title"
          },
          start: {
            type: "string",
            description: "Start date/time in ISO format using Europe/Prague local time, for example 2026-03-27T19:30:00+01:00. Never use UTC Z when user gives local Czech time."
          },
          end: {
            type: "string",
            description: "End date/time in ISO format using Europe/Prague local time, for example 2026-03-27T21:00:00+01:00. Never use UTC Z when user gives local Czech time."
          },
          description: {
            type: "string",
            description: "Event description (optional)"
          },
          attendeeEmails: {
            type: "array",
            items: { type: "string" },
            description: "List of attendee email addresses (optional)"
          }
        },
        required: ["summary", "start", "end"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_calendar_events_in_range",
      description: "List calendar events in a date/time range. Use this before deleting or updating calendar events if the user refers to an existing event by name or time.",
      parameters: {
        type: "object",
        properties: {
          start: {
            type: "string",
            description: "Range start in ISO format using Europe/Prague local time with explicit offset."
          },
          end: {
            type: "string",
            description: "Range end in ISO format using Europe/Prague local time with explicit offset."
          }
        },
        required: ["start", "end"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_calendar_event",
      description: "Update an existing Google Calendar event. Use only after identifying the exact eventId, usually via get_calendar_events_in_range.",
      parameters: {
        type: "object",
        properties: {
          eventId: {
            type: "string",
            description: "Exact Google Calendar event ID"
          },
          summary: {
            type: "string",
            description: "Updated event title"
          },
          description: {
            type: "string",
            description: "Updated event description"
          },
          start: {
            type: "string",
            description: "Updated start time in ISO format using Europe/Prague local time with explicit offset"
          },
          end: {
            type: "string",
            description: "Updated end time in ISO format using Europe/Prague local time with explicit offset"
          },
          attendeeEmails: {
            type: "array",
            items: { type: "string" },
            description: "Updated attendee emails"
          }
        },
        required: ["eventId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "rename_calendar_event_by_match",
      description: "Find a calendar event in a date range by title and optionally start time, then rename it. Prefer this over update_calendar_event when the user refers to an event naturally by name/date/time.",
      parameters: {
        type: "object",
        properties: {
          start: {
            type: "string",
            description: "Search range start in ISO format using Europe/Prague local time with explicit offset"
          },
          end: {
            type: "string",
            description: "Search range end in ISO format using Europe/Prague local time with explicit offset"
          },
          currentSummary: {
            type: "string",
            description: "Current event title or partial title to match"
          },
          newSummary: {
            type: "string",
            description: "New event title"
          },
          expectedStart: {
            type: "string",
            description: "Optional expected event start in ISO format to disambiguate the event"
          }
        },
        required: ["start", "end", "currentSummary", "newSummary"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_calendar_event",
      description: "Delete an existing Google Calendar event by exact eventId. Use only after identifying the correct event via get_calendar_events_in_range unless the eventId is already known.",
      parameters: {
        type: "object",
        properties: {
          eventId: {
            type: "string",
            description: "Exact Google Calendar event ID"
          }
        },
        required: ["eventId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_calendar_event_by_match",
      description: "Find a calendar event in a date range by title and optionally start time, then delete it. Prefer this over delete_calendar_event when the user refers to an event naturally by name/date/time.",
      parameters: {
        type: "object",
        properties: {
          start: {
            type: "string",
            description: "Search range start in ISO format using Europe/Prague local time with explicit offset"
          },
          end: {
            type: "string",
            description: "Search range end in ISO format using Europe/Prague local time with explicit offset"
          },
          summary: {
            type: "string",
            description: "Event title or partial title to match"
          },
          expectedStart: {
            type: "string",
            description: "Optional expected event start in ISO format to disambiguate the event"
          }
        },
        required: ["start", "end", "summary"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "draft_viewing_email_from_availability",
      description: "Create a Gmail draft email with suggested meeting times based on your calendar availability",
      parameters: {
        type: "object",
        properties: {
          recipientName: {
            type: "string",
            description: "Name of the recipient"
          },
          recipientEmail: {
            type: "string",
            description: "Email address of the recipient"
          },
          start: {
            type: "string",
            description: "Start date/time for availability search in ISO format"
          },
          end: {
            type: "string",
            description: "End date/time for availability search in ISO format"
          },
          durationMinutes: {
            type: "number",
            description: "Meeting duration in minutes (default: 30)"
          },
          context: {
            type: "string",
            description: "Additional context or custom message (optional)"
          }
        },
        required: ["recipientName", "recipientEmail", "start", "end"]
      }
    }
  }
]

// Function to execute tool calls
async function executeTool(toolCall: any) {
  const { name, arguments: args } = toolCall.function
  const parsedArgs = JSON.parse(args)
  const userId = process.env.SESSION_USER_ID || 'default-user'

  switch (name) {
    case 'get_all_clients':
      return await get_all_clients()
    case 'get_all_properties':
      return await get_all_properties()
    case 'get_all_leads':
      return await get_all_leads()
    case 'get_all_deals':
      return await get_all_deals()
    case 'get_weekly_kpis':
      return await get_weekly_kpis()
    case 'get_client_sources_breakdown':
      return await get_client_sources_breakdown(parsedArgs.period || 'last_30_days')
    case 'find_properties_missing_reconstruction_data':
      return await find_properties_missing_reconstruction_data()
    case 'create_property_types_pie_chart':
      const properties = await get_all_properties()
      const typeCounts: { [key: string]: number } = {}
      properties.forEach((p: any) => {
        typeCounts[p.property_type] = (typeCounts[p.property_type] || 0) + 1
      })
      return {
        type: 'pie',
        title: 'Nemovitosti podle typu',
        description: 'Rozdělení portfolia podle typu nemovitosti.',
        createdAt: new Date().toISOString(),
        data: Object.entries(typeCounts).map(([type, count]) => ({ name: type, value: count }))
      }
    case 'create_client_growth_line_chart':
      // For now, return a placeholder since all clients have same date
      // In real implementation, would query by month
      return {
        type: 'line',
        title: 'Vývoj klientů v čase',
        description: 'Jednoduchý časový přehled růstu klientů.',
        xKey: 'month',
        yKey: 'clients',
        createdAt: new Date().toISOString(),
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
        data: [
          { month: 'Jan', clients: 10 },
          { month: 'Feb', clients: 15 },
          { month: 'Mar', clients: 20 },
          { month: 'Apr', clients: 25 },
          { month: 'May', clients: 30 },
          { month: 'Jun', clients: 35 }
        ]
      }
    case 'create_clients_by_owner_pie_chart':
      const clients = await get_all_clients()
      const ownerCounts: { [key: string]: number } = {}
      clients.forEach((c: any) => {
        const owner = c.owner || 'Unknown'
        ownerCounts[owner] = (ownerCounts[owner] || 0) + 1
      })
      return {
        type: 'pie',
        title: 'Klienti podle ownera',
        description: 'Rozdělení klientů podle přiřazeného ownera.',
        createdAt: new Date().toISOString(),
        data: Object.entries(ownerCounts).map(([owner, count]) => ({ name: owner, value: count }))
      }
    case 'create_chart':
      const { chart_type, data_source, group_by, x_axis, y_axis } = parsedArgs
      const normalizeChartField = (source: string, field?: string) => {
        if (!field) return field

        const normalized = String(field)
          .trim()
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/\s+/g, '_')

        if (source === 'properties') {
          if (['typ', 'type', 'property_type', 'propertytype', 'druh', 'kategorie'].includes(normalized)) return 'property_type'
          if (['mesto', 'city'].includes(normalized)) return 'city'
          if (['lokalita', 'locality', 'cast_obce'].includes(normalized)) return 'locality'
          if (['stav', 'status'].includes(normalized)) return 'status'
          if (['kraj', 'region'].includes(normalized)) return 'region'
          if (['rekonstrukce', 'reconstruction', 'reconstruction_status'].includes(normalized)) return 'reconstruction_status'
          if (['cena', 'asking_price', 'price'].includes(normalized)) return 'asking_price'
        }

        if (source === 'clients') {
          if (['zdroj', 'source'].includes(normalized)) return 'source'
          if (['owner', 'vlastnik'].includes(normalized)) return 'owner'
          if (['mesto', 'city'].includes(normalized)) return 'city'
        }

        if (source === 'leads') {
          if (['zdroj', 'source', 'source_channel', 'kanal'].includes(normalized)) return 'source_channel'
          if (['stav', 'status'].includes(normalized)) return 'status'
          if (['created', 'created_at', 'month', 'mesic'].includes(normalized)) return 'created_at'
        }

        if (source === 'deals') {
          if (['faze', 'stage'].includes(normalized)) return 'stage'
          if (['castka', 'amount', 'cena', 'price'].includes(normalized)) return 'amount'
          if (['uzavreno', 'closed_at', 'month', 'mesic'].includes(normalized)) return 'closed_at'
        }

        return field
      }

      const resolvedGroupBy = normalizeChartField(data_source, group_by) || group_by || 'status'
      const resolvedXAxis = normalizeChartField(data_source, x_axis) || x_axis || 'created_at'
      const resolvedYAxis = normalizeChartField(data_source, y_axis) || y_axis || 'count'
      
      let data = []
      switch (data_source) {
        case 'clients':
          data = await get_all_clients()
          break
        case 'properties':
          data = await get_all_properties()
          break
        case 'leads':
          data = await get_all_leads()
          break
        case 'deals':
          data = await get_all_deals()
          break
        default:
          throw new Error(`Unknown data source: ${data_source}`)
      }

      if (chart_type === 'pie') {
        const counts: { [key: string]: number } = {}
        data.forEach((item: any) => {
          const key = item[resolvedGroupBy] || 'Unknown'
          counts[key] = (counts[key] || 0) + 1
        })
        return {
          type: 'pie',
          title: `${data_source} podle ${resolvedGroupBy}`,
          description: `Přehled ${data_source} seskupených podle ${resolvedGroupBy}.`,
          createdAt: new Date().toISOString(),
          data: Object.entries(counts).map(([name, value]) => ({ name, value }))
        }
      } else if (chart_type === 'bar' || chart_type === 'line') {
        if (!resolvedXAxis || !resolvedYAxis) {
          throw new Error('Bar and line charts require x_axis and y_axis parameters')
        }
        
        // For time-based charts, group by month
        if (resolvedXAxis === 'created_at' || resolvedXAxis === 'closed_at' || resolvedXAxis === 'month') {
          const monthlyData: { [key: string]: number } = {}
          data.forEach((item: any) => {
            const date = new Date(item.created_at || item.closed_at || Date.now())
            const monthKey = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
            monthlyData[monthKey] = (monthlyData[monthKey] || 0) + 1
          })
          
          const sortedMonths = Object.keys(monthlyData).sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
          return {
            type: chart_type,
            title: `${data_source} v čase`,
            description: `Vývoj ${data_source} po měsících.`,
            xKey: resolvedXAxis,
            yKey: resolvedYAxis,
            createdAt: new Date().toISOString(),
            data: sortedMonths.map(month => ({
              [resolvedXAxis]: month,
              [resolvedYAxis]: monthlyData[month]
            }))
          }
        } else {
          // Group by the specified x_axis column
          const groupedData: { [key: string]: any[] } = {}
          data.forEach((item: any) => {
            const key = item[resolvedXAxis] || 'Unknown'
            if (!groupedData[key]) groupedData[key] = []
            groupedData[key].push(item)
          })
          
          return {
            type: chart_type,
            title: `${data_source} podle ${resolvedXAxis}`,
            description: `Přehled ${data_source} seskupených podle ${resolvedXAxis}.`,
            xKey: resolvedXAxis,
            yKey: resolvedYAxis,
            createdAt: new Date().toISOString(),
            data: Object.entries(groupedData).map(([key, items]) => ({
              [resolvedXAxis]: key,
              [resolvedYAxis]: resolvedYAxis === 'count' ? items.length : items.reduce((sum, item) => sum + (item[resolvedYAxis] || 0), 0)
            }))
          }
        }
      }
      
      throw new Error(`Unsupported chart type: ${chart_type}`)
    case 'list_database_records':
      if (!isDataEntity(parsedArgs.entity)) {
        throw new Error('Unknown database entity.')
      }
      const listResult = await listDataRecords({
        entity: parsedArgs.entity,
        query: parsedArgs.query,
        limit: parsedArgs.limit,
      })
      return {
        summary: `Nalezeno ${listResult.count} záznamů v entitě ${getDataEntityDefinition(parsedArgs.entity).label}.`,
        records: listResult.records.slice(0, 12),
        dataAction: {
          entity: parsedArgs.entity,
          query: parsedArgs.query || '',
          selectedRecordId: listResult.records[0]?.id || null,
          refresh: true,
        },
      }
    case 'get_database_record':
      if (!isDataEntity(parsedArgs.entity)) {
        throw new Error('Unknown database entity.')
      }
      const recordResult = await getDataRecord(parsedArgs.entity, parsedArgs.id)
      return {
        record: recordResult,
        dataAction: {
          entity: parsedArgs.entity,
          selectedRecordId: parsedArgs.id,
          refresh: true,
        },
      }
    case 'create_database_record':
      if (!isDataEntity(parsedArgs.entity)) {
        throw new Error('Unknown database entity.')
      }
      const createdRecord = await createDataRecord(parsedArgs.entity, extractDatabasePayload(parsedArgs, 'create'))
      return {
        summary: `Záznam byl vytvořen v entitě ${getDataEntityDefinition(parsedArgs.entity).label}.`,
        record: createdRecord,
        dataAction: {
          entity: parsedArgs.entity,
          selectedRecordId: createdRecord.id,
          refresh: true,
        },
      }
    case 'create_client_record':
      const createdClient = await createDataRecord('clients', {
        name: parsedArgs.name,
        source: parsedArgs.source,
        owner: parsedArgs.owner,
      })
      return {
        summary: 'Klient byl vytvořen.',
        record: createdClient,
        dataAction: {
          entity: 'clients',
          selectedRecordId: createdClient.id,
          refresh: true,
        },
      }
    case 'create_property_record':
      const createdProperty = await createDataRecord('properties', {
        title: parsedArgs.title,
        address: parsedArgs.address || 'Adresa bude doplněna',
        locality: parsedArgs.locality,
        city: parsedArgs.city,
        region: parsedArgs.region,
        property_type: parsedArgs.property_type,
        status: parsedArgs.status,
        asking_price: parsedArgs.asking_price,
        reconstruction_status: parsedArgs.reconstruction_status,
        structural_modifications: parsedArgs.structural_modifications,
      })
      return {
        summary: 'Nemovitost byla vytvořena.',
        record: createdProperty,
        dataAction: {
          entity: 'properties',
          selectedRecordId: createdProperty.id,
          refresh: true,
        },
      }
    case 'create_lead_record':
      const resolvedLeadClientId =
        parsedArgs.client_id ||
        (parsedArgs.client_name ? (await findSingleRecordBySearch('clients', parsedArgs.client_name)).id : null)

      if (!resolvedLeadClientId) {
        throw new Error('Pro vytvoření leadu potřebuji klienta. Zadej prosím jméno klienta nebo jeho id.')
      }

      const createdLead = await createDataRecord('leads', {
        client_id: resolvedLeadClientId,
        source_channel: parsedArgs.source_channel,
        status: parsedArgs.status,
      })
      return {
        summary: 'Lead byl vytvořen.',
        record: createdLead,
        dataAction: {
          entity: 'leads',
          selectedRecordId: createdLead.id,
          refresh: true,
        },
      }
    case 'create_deal_record':
      const resolvedDealClientId =
        parsedArgs.client_id ||
        (parsedArgs.client_name ? (await findSingleRecordBySearch('clients', parsedArgs.client_name)).id : null)
      const resolvedPropertyId =
        parsedArgs.property_id ||
        (parsedArgs.property_title ? (await findSingleRecordBySearch('properties', parsedArgs.property_title)).id : null)

      if (!resolvedDealClientId) {
        throw new Error('Pro vytvoření dealu potřebuji klienta. Zadej prosím jméno klienta nebo jeho id.')
      }
      if (!resolvedPropertyId) {
        throw new Error('Pro vytvoření dealu potřebuji nemovitost. Zadej prosím název nemovitosti nebo její id.')
      }

      const createdDeal = await createDataRecord('deals', {
        client_id: resolvedDealClientId,
        property_id: resolvedPropertyId,
        stage: parsedArgs.stage,
        amount: parsedArgs.amount,
        closed_at: parsedArgs.closed_at,
      })
      return {
        summary: 'Deal byl vytvořen.',
        record: createdDeal,
        dataAction: {
          entity: 'deals',
          selectedRecordId: createdDeal.id,
          refresh: true,
        },
      }
    case 'update_client_record_by_name':
      const matchedClient = await findSingleRecordBySearch('clients', parsedArgs.currentName)
      const updatedClientByName = await updateDataRecord('clients', matchedClient.id, {
        ...(typeof parsedArgs.newName !== 'undefined' ? { name: parsedArgs.newName } : {}),
        ...(typeof parsedArgs.source !== 'undefined' ? { source: parsedArgs.source } : {}),
        ...(typeof parsedArgs.owner !== 'undefined' ? { owner: parsedArgs.owner } : {}),
      })
      return {
        summary: 'Klient byl upraven.',
        record: updatedClientByName,
        dataAction: {
          entity: 'clients',
          selectedRecordId: updatedClientByName.id,
          refresh: true,
        },
      }
    case 'update_property_record_by_title':
      const matchedProperty = await findSingleRecordBySearch('properties', parsedArgs.currentTitle)
      const updatedPropertyByTitle = await updateDataRecord('properties', matchedProperty.id, {
        ...(typeof parsedArgs.title !== 'undefined' ? { title: parsedArgs.title } : {}),
        ...(typeof parsedArgs.address !== 'undefined' ? { address: parsedArgs.address } : {}),
        ...(typeof parsedArgs.locality !== 'undefined' ? { locality: parsedArgs.locality } : {}),
        ...(typeof parsedArgs.city !== 'undefined' ? { city: parsedArgs.city } : {}),
        ...(typeof parsedArgs.region !== 'undefined' ? { region: parsedArgs.region } : {}),
        ...(typeof parsedArgs.property_type !== 'undefined' ? { property_type: parsedArgs.property_type } : {}),
        ...(typeof parsedArgs.status !== 'undefined' ? { status: parsedArgs.status } : {}),
        ...(typeof parsedArgs.asking_price !== 'undefined' ? { asking_price: parsedArgs.asking_price } : {}),
        ...(typeof parsedArgs.reconstruction_status !== 'undefined' ? { reconstruction_status: parsedArgs.reconstruction_status } : {}),
        ...(typeof parsedArgs.structural_modifications !== 'undefined' ? { structural_modifications: parsedArgs.structural_modifications } : {}),
      })
      return {
        summary: 'Nemovitost byla upravena.',
        record: updatedPropertyByTitle,
        dataAction: {
          entity: 'properties',
          selectedRecordId: updatedPropertyByTitle.id,
          refresh: true,
        },
      }
    case 'update_lead_record_by_match':
      const matchedLead = await findLeadByMatch({
        clientName: parsedArgs.clientName,
        source_channel: parsedArgs.source_channel,
        status: parsedArgs.status,
        created_at: parsedArgs.created_at,
      })
      const reassignedLeadClientId =
        parsedArgs.newClientName ? (await findSingleRecordBySearch('clients', parsedArgs.newClientName)).id : undefined
      const updatedLeadByMatch = await updateDataRecord('leads', matchedLead.id, {
        ...(typeof parsedArgs.newSourceChannel !== 'undefined' ? { source_channel: parsedArgs.newSourceChannel } : {}),
        ...(typeof parsedArgs.newStatus !== 'undefined' ? { status: parsedArgs.newStatus } : {}),
        ...(typeof reassignedLeadClientId !== 'undefined' ? { client_id: reassignedLeadClientId } : {}),
      })
      return {
        summary: 'Lead byl upraven.',
        record: updatedLeadByMatch,
        dataAction: {
          entity: 'leads',
          selectedRecordId: updatedLeadByMatch.id,
          refresh: true,
        },
      }
    case 'update_deal_record_by_match':
      const matchedDeal = await findDealByMatch({
        clientName: parsedArgs.clientName,
        propertyTitle: parsedArgs.propertyTitle,
        stage: parsedArgs.stage,
        amount: parsedArgs.amount,
      })
      const updatedDealByMatch = await updateDataRecord('deals', matchedDeal.id, {
        ...(typeof parsedArgs.newStage !== 'undefined' ? { stage: parsedArgs.newStage } : {}),
        ...(typeof parsedArgs.newAmount !== 'undefined' ? { amount: parsedArgs.newAmount } : {}),
        ...(typeof parsedArgs.newClosedAt !== 'undefined' ? { closed_at: parsedArgs.newClosedAt } : {}),
      })
      return {
        summary: 'Deal byl upraven.',
        record: updatedDealByMatch,
        dataAction: {
          entity: 'deals',
          selectedRecordId: updatedDealByMatch.id,
          refresh: true,
        },
      }
    case 'delete_client_record_by_name':
      const matchedClientForDelete = await findSingleRecordBySearch('clients', parsedArgs.name)
      const deletedClientByName = await deleteDataRecord('clients', matchedClientForDelete.id)
      return {
        summary: 'Klient byl smazán.',
        record: deletedClientByName,
        dataAction: {
          entity: 'clients',
          selectedRecordId: null,
          refresh: true,
        },
      }
    case 'delete_property_record_by_title':
      const matchedPropertyForDelete = await findSingleRecordBySearch('properties', parsedArgs.title)
      const deletedPropertyByTitle = await deleteDataRecord('properties', matchedPropertyForDelete.id)
      return {
        summary: 'Nemovitost byla smazána.',
        record: deletedPropertyByTitle,
        dataAction: {
          entity: 'properties',
          selectedRecordId: null,
          refresh: true,
        },
      }
    case 'delete_lead_record_by_match':
      const matchedLeadForDelete = await findLeadByMatch({
        clientName: parsedArgs.clientName,
        source_channel: parsedArgs.source_channel,
        status: parsedArgs.status,
        created_at: parsedArgs.created_at,
      })
      const deletedLeadByMatch = await deleteDataRecord('leads', matchedLeadForDelete.id)
      return {
        summary: 'Lead byl smazán.',
        record: deletedLeadByMatch,
        dataAction: {
          entity: 'leads',
          selectedRecordId: null,
          refresh: true,
        },
      }
    case 'delete_deal_record_by_match':
      const matchedDealForDelete = await findDealByMatch({
        clientName: parsedArgs.clientName,
        propertyTitle: parsedArgs.propertyTitle,
        stage: parsedArgs.stage,
        amount: parsedArgs.amount,
      })
      const deletedDealByMatch = await deleteDataRecord('deals', matchedDealForDelete.id)
      return {
        summary: 'Deal byl smazán.',
        record: deletedDealByMatch,
        dataAction: {
          entity: 'deals',
          selectedRecordId: null,
          refresh: true,
        },
      }
    case 'create_scheduled_email_workflow':
      if (!cron.validate(parsedArgs.schedule)) {
        throw new Error('Neplatný cron výraz pro workflow.')
      }
      const generatedWorkflowName = parsedArgs.name?.trim() || `Email ${parsedArgs.to} · ${String(parsedArgs.subject).slice(0, 40)}`
      const generatedWorkflowDescription =
        parsedArgs.description?.trim() || `Naplánované odesílání e-mailu na ${parsedArgs.to} podle plánu ${parsedArgs.schedule}.`

      const { data: createdWorkflow, error: createdWorkflowError } = await supabase
        .from('workflows')
        .insert({
          name: generatedWorkflowName,
          type: 'scheduled_email',
          schedule: parsedArgs.schedule,
          status: 'active',
          config_json: {
            actionType: 'send_email',
            description: generatedWorkflowDescription,
            task: {
              to: parsedArgs.to,
              subject: parsedArgs.subject,
              body: parsedArgs.body,
            },
          },
        })
        .select()
        .single()

      if (createdWorkflowError) {
        throw new Error(createdWorkflowError.message)
      }

      workflowEngine.scheduleWorkflow(createdWorkflow.id, parsedArgs.schedule)

      return {
        summary: `Workflow "${generatedWorkflowName}" byl vytvořen.`,
        workflow: createdWorkflow,
      }
    case 'create_market_watch_workflow':
      if (!cron.validate(parsedArgs.schedule)) {
        throw new Error('Neplatný cron výraz pro workflow.')
      }

      const generatedMarketName = parsedArgs.name?.trim() || `Market watch ${parsedArgs.locationLabel}`
      const generatedMarketDescription =
        parsedArgs.description?.trim() ||
        `Denní sledování nových nabídek pro ${parsedArgs.locationLabel} ze zdrojů ${(parsedArgs.sources || ['sreality', 'bezrealitky']).join(', ')}.`

      const { data: createdMarketWorkflow, error: createdMarketWorkflowError } = await supabase
        .from('workflows')
        .insert({
          name: generatedMarketName,
          type: 'market_watch',
          schedule: parsedArgs.schedule,
          status: 'active',
          config_json: {
            actionType: 'market_watch',
            description: generatedMarketDescription,
            task: {
              to: parsedArgs.to,
              subject: parsedArgs.subject,
              locationLabel: parsedArgs.locationLabel,
              sources: parsedArgs.sources?.length ? parsedArgs.sources : ['sreality', 'bezrealitky'],
              category: parsedArgs.category || 'byty',
              mode: parsedArgs.mode === 'latest' ? 'latest' : 'new',
              limit: parsedArgs.limit || 10,
              persistToDatabase: true,
              searchUrls: {},
              seenListingIds: [],
            },
          },
        })
        .select()
        .single()

      if (createdMarketWorkflowError) {
        throw new Error(createdMarketWorkflowError.message)
      }

      workflowEngine.scheduleWorkflow(createdMarketWorkflow.id, parsedArgs.schedule)

      return {
        summary: `Workflow "${generatedMarketName}" byl vytvořen pro sledování trhu.`,
        workflow: createdMarketWorkflow,
      }
    case 'get_market_listings':
      const marketListArgs = resolveMarketArgs(userId, parsedArgs)
      const marketResult = await runMarketWatch({
        locationLabel: marketListArgs.locationLabel,
        sources: marketListArgs.sources,
        category: marketListArgs.category,
        mode: 'latest',
        limit: marketListArgs.limit || 5,
      })
      pendingMarketContextByUser[userId] = {
        sources: marketListArgs.sources,
        category: marketListArgs.category,
        locationLabel: marketListArgs.locationLabel,
        limit: marketListArgs.limit || 5,
        listings: marketResult.selectedListings.map((listing) => ({
          source: listing.source,
          listingId: listing.listingId,
          title: listing.title,
          price: listing.price,
          location: listing.location,
          url: listing.url,
        })),
      }
      return {
        summary: `Našel jsem ${marketResult.selectedListings.length} aktuálních nabídek.`,
        listings: marketResult.selectedListings.map((listing) => ({
          source: listing.source,
          title: listing.title,
          price: listing.price,
          location: listing.location,
          url: listing.url,
        })),
      }
    case 'get_market_listing_count':
      const marketCountArgs = resolveMarketArgs(userId, parsedArgs)
      pendingMarketContextByUser[userId] = {
        sources: marketCountArgs.sources,
        category: marketCountArgs.category,
        locationLabel: marketCountArgs.locationLabel,
      }
      const marketSnapshot = await fetchMarketWatchSnapshot({
        locationLabel: marketCountArgs.locationLabel,
        sources: marketCountArgs.sources,
        category: marketCountArgs.category,
      })
      return {
        counts: marketSnapshot.map((sourceResult) => ({
          source: sourceResult.source,
          totalCount: sourceResult.totalCount,
        })),
      }
    case 'sync_sreality_listings_to_database':
      const syncResult = await syncSrealityListings({
        locationLabel: parsedArgs.locationLabel,
        categories: parsedArgs.categories,
        maxPrice: parsedArgs.maxPrice,
        maxPages: parsedArgs.maxPages,
        limit: parsedArgs.limit,
      })
      pendingMarketContextByUser[userId] = {
        sources: ['sreality'],
        category: parsedArgs.categories?.length === 1 ? parsedArgs.categories[0] : undefined,
        locationLabel: parsedArgs.locationLabel,
        limit: parsedArgs.limit,
      }
      return {
        summary: `Do databáze jsem uložil ${syncResult.synced} listingů ze Sreality.`,
        synced: syncResult.synced,
        fetched: syncResult.fetched,
        listings: syncResult.listings.slice(0, 5).map((listing) => ({
          title: listing.title,
          location: listing.location,
          price_text: listing.price_text,
          url: listing.url,
        })),
      }
    case 'save_recent_market_listings_to_database':
      const recentMarketContext = pendingMarketContextByUser[userId]
      if (!recentMarketContext?.listings?.length) {
        throw new Error('Nemám žádné nedávno vypsané nabídky k uložení. Nejdřív je prosím nechte vypsat.')
      }

      const recentLimit =
        typeof parsedArgs.limit === 'number' && parsedArgs.limit > 0
          ? Math.max(1, Math.min(parsedArgs.limit, recentMarketContext.listings.length))
          : recentMarketContext.listings.length
      const listingsToSave = recentMarketContext.listings.slice(0, recentLimit)
      const saveRecentResult = await storeMarketListings({
        listings: listingsToSave,
        category: recentMarketContext.category,
      })

      pendingMarketContextByUser[userId] = {
        ...recentMarketContext,
        listings: listingsToSave,
        limit: recentLimit,
      }

      return {
        summary: `Do databáze jsem uložil přesně ${saveRecentResult.synced} naposledy vypsaných listingů.`,
        synced: saveRecentResult.synced,
        listings: saveRecentResult.listings.map((listing) => ({
          title: listing.title,
          location: listing.location,
          price_text: listing.price_text,
          url: listing.url,
        })),
      }
    case 'query_market_listings_database':
      const storedListings = await queryMarketListings({
        source: parsedArgs.source || 'sreality',
        locationLabel: parsedArgs.locationLabel,
        city: parsedArgs.city,
        district: parsedArgs.district,
        category: parsedArgs.category,
        maxPrice: parsedArgs.maxPrice,
        minPrice: parsedArgs.minPrice,
        limit: parsedArgs.limit,
        query: parsedArgs.query,
      })
      return {
        summary: `Našel jsem ${storedListings.length} uložených listingů v databázi.`,
        listings: storedListings.map((listing: any) => ({
          title: listing.title,
          location: listing.location,
          price_text: listing.price_text,
          property_category: listing.property_category,
          url: listing.url,
          last_seen_at: listing.last_seen_at,
        })),
      }
    case 'count_market_listings_database':
      const storedCount = await countMarketListings({
        source: parsedArgs.source || 'sreality',
        locationLabel: parsedArgs.locationLabel,
        city: parsedArgs.city,
        district: parsedArgs.district,
        category: parsedArgs.category,
        maxPrice: parsedArgs.maxPrice,
        minPrice: parsedArgs.minPrice,
        query: parsedArgs.query,
      })
      return {
        count: storedCount,
      }
    case 'list_workflows':
      await workflowEngine.initializeScheduledWorkflows()
      const { data: workflowList, error: workflowListError } = await supabase
        .from('workflows')
        .select('*')
        .order('name', { ascending: true })
      if (workflowListError) {
        throw new Error(workflowListError.message)
      }
      return {
        workflows: (workflowList || []).map((workflow: any) => ({
          id: workflow.id,
          name: workflow.name,
          type: workflow.type,
          status: workflow.status,
          schedule: workflow.schedule,
          description: workflow.config_json?.description || '',
          last_run: workflow.config_json?.last_run || null,
        })),
      }
    case 'run_workflow_by_name':
      const workflowForRun = await findWorkflowByName(parsedArgs.name)
      const workflowRunResult = await workflowEngine.executeWorkflow(workflowForRun.id)
      return {
        summary: `Workflow "${workflowForRun.name}" byl spuštěn.`,
        result: workflowRunResult,
      }
    case 'delete_workflow_by_name':
      const workflowForDelete = await findWorkflowByName(parsedArgs.name)
      workflowEngine.stopWorkflow(workflowForDelete.id)
      const { error: workflowDeleteError } = await supabase.from('workflows').delete().eq('id', workflowForDelete.id)
      if (workflowDeleteError) {
        throw new Error(workflowDeleteError.message)
      }
      return {
        summary: `Workflow "${workflowForDelete.name}" byl smazán.`,
      }
    case 'update_workflow_schedule_by_name':
      if (!cron.validate(parsedArgs.schedule)) {
        throw new Error('Neplatný cron výraz pro workflow.')
      }
      const workflowForSchedule = await findWorkflowByName(parsedArgs.name)
      const { data: updatedWorkflowSchedule, error: updatedWorkflowScheduleError } = await supabase
        .from('workflows')
        .update({
          schedule: parsedArgs.schedule,
          status: 'active',
        })
        .eq('id', workflowForSchedule.id)
        .select()
        .single()
      if (updatedWorkflowScheduleError) {
        throw new Error(updatedWorkflowScheduleError.message)
      }
      workflowEngine.scheduleWorkflow(workflowForSchedule.id, parsedArgs.schedule)
      return {
        summary: `Workflow "${workflowForSchedule.name}" má nový plán ${parsedArgs.schedule}.`,
        workflow: updatedWorkflowSchedule,
      }
    case 'update_database_record':
      if (!isDataEntity(parsedArgs.entity)) {
        throw new Error('Unknown database entity.')
      }
      const updatedRecord = await updateDataRecord(parsedArgs.entity, parsedArgs.id, extractDatabasePayload(parsedArgs, 'update'))
      return {
        summary: `Záznam byl upraven v entitě ${getDataEntityDefinition(parsedArgs.entity).label}.`,
        record: updatedRecord,
        dataAction: {
          entity: parsedArgs.entity,
          selectedRecordId: updatedRecord.id,
          refresh: true,
        },
      }
    case 'delete_database_record':
      if (!isDataEntity(parsedArgs.entity)) {
        throw new Error('Unknown database entity.')
      }
      const deletedRecord = await deleteDataRecord(parsedArgs.entity, parsedArgs.id)
      return {
        summary: `Záznam byl smazán z entity ${getDataEntityDefinition(parsedArgs.entity).label}.`,
        record: deletedRecord,
        dataAction: {
          entity: parsedArgs.entity,
          selectedRecordId: null,
          refresh: true,
        },
      }
    case 'filter_properties_on_map':
      const mapResult = await getPropertiesForMap({
        city: parsedArgs.city,
        locality: parsedArgs.locality,
        propertyType: parsedArgs.propertyType,
        status: parsedArgs.status,
        missingReconstruction: parsedArgs.missingReconstruction,
        maxPrice: parsedArgs.maxPrice,
        sortBy: parsedArgs.sortBy || (parsedArgs.focusTopResult ? 'price_desc' : 'newest'),
        limit: 250,
      })

      return {
        summary: `Nalezeno ${mapResult.totalMatching} nemovitostí pro mapu.`,
        properties: mapResult.properties.slice(0, 12).map((property) => ({
          id: property.id,
          title: property.title,
          city: property.city,
          locality: property.locality,
          property_type: property.property_type,
          status: property.status,
          asking_price: property.asking_price,
        })),
        mapAction: {
          filters: {
            city: parsedArgs.city,
            locality: parsedArgs.locality,
            propertyType: parsedArgs.propertyType,
            status: parsedArgs.status,
            missingReconstruction: parsedArgs.missingReconstruction,
            maxPrice: parsedArgs.maxPrice,
          },
          selectedPropertyId: parsedArgs.focusTopResult ? mapResult.properties[0]?.id || null : null,
        },
      }
    case 'get_calendar_availability':
      return await get_calendar_availability(parsedArgs.start, parsedArgs.end, parsedArgs.durationMinutes)
    case 'get_calendar_events_in_range':
      return await get_calendar_events_in_range(parsedArgs.start, parsedArgs.end)
    case 'suggest_meeting_slots':
      return await suggest_meeting_slots(parsedArgs.start, parsedArgs.end, parsedArgs.durationMinutes, parsedArgs.maxSuggestions)
    case 'draft_email':
      const draftResult = await draft_email(parsedArgs.to, parsedArgs.subject, parsedArgs.body)
      // Store as pending for potential confirmation
      pendingEmailByUser[userId] = { to: parsedArgs.to, subject: parsedArgs.subject, body: parsedArgs.body }
      return draftResult
    case 'list_recent_emails':
      return await list_recent_emails(parsedArgs.maxResults || 20)
    case 'get_email_thread':
      return await get_email_thread(parsedArgs.threadId)
    case 'reply_to_email_thread':
      return await reply_to_email_thread(parsedArgs.threadId, parsedArgs.to, parsedArgs.subject, parsedArgs.body)
    case 'send_email':
      return await send_email(parsedArgs.to, parsedArgs.subject, parsedArgs.body)
    case 'send_pending_email':
      const pending = pendingEmailByUser[userId]
      if (!pending) {
        throw new Error('Žádný připravený email k odeslání nemám. Nejdříve vytvoř návrh emailu.')
      }
      const result = await send_email(pending.to, pending.subject, pending.body)
      delete pendingEmailByUser[userId]
      return result
    case 'send_chart_email':
      const chart = pendingChartByUser[userId]
      if (!chart) {
        throw new Error('Žádný připravený graf k odeslání nemám. Nejdříve vytvoř graf.')
      }
      chart.reportSpec = chart.reportSpec || (await createChartNarrativeSpec(chart)) || undefined
      return await sendPreparedChartEmail(userId, chart, parsedArgs)
    case 'create_and_send_chart_email':
      const preferredChartType =
        parsedArgs.chart_type ||
        (parsedArgs.group_by === 'city' || parsedArgs.group_by === 'locality' || parsedArgs.includePptx || parsedArgs.includeJpeg ? 'bar' : 'pie')

      const builtChart = await buildDatabaseChart({
        dataSource: parsedArgs.data_source,
        groupBy: parsedArgs.group_by,
        chartType: preferredChartType,
        title: parsedArgs.title,
        description: parsedArgs.description,
      })
      builtChart.reportSpec = (await createChartNarrativeSpec(builtChart)) || undefined
      return await sendPreparedChartEmail(userId, builtChart, parsedArgs)
    case 'create_calendar_event':
      return await create_calendar_event(parsedArgs.summary, parsedArgs.start, parsedArgs.end, parsedArgs.description, parsedArgs.attendeeEmails)
    case 'update_calendar_event':
      if (!isValidCalendarEventId(parsedArgs.eventId)) {
        throw new Error('Pro update_calendar_event je potřeba skutečné eventId z kalendáře, ne placeholder. Použij nejdřív get_calendar_events_in_range nebo rename_calendar_event_by_match.')
      }
      return await update_calendar_event(parsedArgs.eventId, {
        summary: parsedArgs.summary,
        description: parsedArgs.description,
        start: parsedArgs.start,
        end: parsedArgs.end,
        attendeeEmails: parsedArgs.attendeeEmails,
      })
    case 'rename_calendar_event_by_match':
      const matchedForRename = await findBestCalendarEventMatch({
        start: parsedArgs.start,
        end: parsedArgs.end,
        summary: parsedArgs.currentSummary,
        expectedStart: parsedArgs.expectedStart,
      })
      return await update_calendar_event(matchedForRename.id!, {
        summary: parsedArgs.newSummary,
      })
    case 'delete_calendar_event':
      if (!isValidCalendarEventId(parsedArgs.eventId)) {
        throw new Error('Pro delete_calendar_event je potřeba skutečné eventId z kalendáře, ne placeholder. Použij nejdřív get_calendar_events_in_range nebo delete_calendar_event_by_match.')
      }
      return await delete_calendar_event(parsedArgs.eventId)
    case 'delete_calendar_event_by_match':
      const matchedForDelete = await findBestCalendarEventMatch({
        start: parsedArgs.start,
        end: parsedArgs.end,
        summary: parsedArgs.summary,
        expectedStart: parsedArgs.expectedStart,
      })
      return await delete_calendar_event(matchedForDelete.id!)
    case 'draft_viewing_email_from_availability':
      return await draft_viewing_email_from_availability(parsedArgs.recipientName, parsedArgs.recipientEmail, parsedArgs.start, parsedArgs.end, parsedArgs.durationMinutes, parsedArgs.context)
  }
}



export async function POST(request: NextRequest) {
  try {
    const { message, context, messages: conversationHistory } = await request.json()
    const normalizedHistory: ChatMessage[] = Array.isArray(conversationHistory)
      ? conversationHistory.filter((entry: ChatMessage) => entry && (entry.role === 'user' || entry.role === 'assistant'))
      : []

    // Log (don't fail if this fails)
    try {
      await supabase.from('agent_logs').insert({
        user_prompt: message,
        detected_intent: 'general',
        details: context ? JSON.stringify(context) : null,
      })
    } catch (logError) {
      console.log('Failed to log:', logError)
    }

    const directDeliveryRequest = detectDirectDeliveryRequest(message, normalizedHistory)
    if (directDeliveryRequest) {
      const userId = process.env.SESSION_USER_ID || 'default-user'

      if (directDeliveryRequest.kind === 'properties-by-city-chart') {
        const chart = await buildDatabaseChart({
          dataSource: 'properties',
          groupBy: 'city',
          chartType: 'bar',
          title: 'Nemovitosti podle města',
          description: 'Rozdělení nemovitostí podle města.',
        })
        chart.reportSpec = (await createChartNarrativeSpec(chart)) || undefined

        const emailResult = await sendPreparedChartEmail(userId, chart, {
          to: directDeliveryRequest.email,
          includeJpeg: true,
          includeSvg: false,
          includeHtmlReport: false,
          includePresentation: false,
          includePptx: false,
          includePdf: false,
          includeCsv: false,
          subject: 'Graf nemovitostí podle města',
        })

        return NextResponse.json({
          response: `Graf nemovitostí podle města jsem rovnou odeslal na ${directDeliveryRequest.email} jako JPEG přílohu.`,
          chart,
          mapAction: null,
          dataAction: null,
          emailResult,
        })
      }

      if (directDeliveryRequest.kind === 'clients-presentation') {
        const chart = await buildDatabaseChart({
          dataSource: 'clients',
          groupBy: 'source',
          chartType: 'bar',
          title: 'Klienti podle zdroje',
          description: 'Přehled klientů podle zdroje akvizice.',
        })
        chart.reportSpec = (await createChartNarrativeSpec(chart)) || undefined

        const emailResult = await sendPreparedChartEmail(userId, chart, {
          to: directDeliveryRequest.email,
          includeJpeg: false,
          includeSvg: false,
          includeHtmlReport: false,
          includePresentation: false,
          includePptx: true,
          includePdf: false,
          includeCsv: false,
          subject: 'Třístránková prezentace o klientech',
        })

        return NextResponse.json({
          response: `Třístránkovou prezentaci s daty o klientech jsem rovnou odeslal na ${directDeliveryRequest.email} jako PPTX přílohu.`,
          chart,
          mapAction: null,
          dataAction: null,
          emailResult,
        })
      }
    }

    let response = ''
    let toolsUsed: string[] = []
    let chartData: any = null
    let mapAction: MapAction | null = null
    let dataAction: DataAction | null = null

    if (!openai) {
      response = 'OpenAI key not configured. Please configure OPENAI_API_KEY in .env.local.'
    } else {
      const todayIsoLocal = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Prague',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date())

      const currentDate = new Date().toLocaleDateString('cs-CZ', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      })
      
      const contextString = context ? JSON.stringify(context) : 'none'
      const userId = process.env.SESSION_USER_ID || 'default-user'
      const pendingEmail = pendingEmailByUser[userId]
      const pendingChart = pendingChartByUser[userId]
      const pendingMarketContext = pendingMarketContextByUser[userId]
      const pendingInfo = pendingEmail ? `\n\nPENDING EMAIL DRAFT:\nTo: ${pendingEmail.to}\nSubject: ${pendingEmail.subject}\nBody: ${pendingEmail.body}\n\nIf user wants to send this email, use send_pending_email tool.` : ''
      const chartInfo = pendingChart
        ? `\n\nPENDING CHART:\nTitle: ${pendingChart.title || 'Graf'}\nType: ${pendingChart.type}\nDescription: ${pendingChart.description || 'N/A'}\nCreatedAt: ${pendingChart.createdAt || 'unknown'}\nData: ${JSON.stringify(pendingChart.data)}\n\nIf user wants to send this chart as email attachment, use send_chart_email tool. If the user wants a simple HTML presentation too, set includePresentation=true. If the user wants a real PowerPoint file, set includePptx=true. If the user wants a PDF report, set includePdf=true. If the user wants data in CSV, set includeCsv=true. If the user wants an image attachment in JPEG, set includeJpeg=true. If the user explicitly asks for only one format, do not add other attachments unless asked.`
        : ''
      const marketInfo = pendingMarketContext
        ? `\n\nMOST RECENT MARKET CONTEXT:\nSources: ${JSON.stringify(pendingMarketContext.sources || [])}\nCategory: ${pendingMarketContext.category || 'unknown'}\nLocation: ${pendingMarketContext.locationLabel || 'anywhere'}\nShown listings count: ${pendingMarketContext.listings?.length || 0}\n\nUse this when the user follows up with phrases like "na tom webu", "ty nabídky", "libovolnou nabídku", or does not repeat the website/category/location. If the user asks to save the already shown listings, use save_recent_market_listings_to_database so you store exactly those shown results.`
        : ''

      const historyMessages = Array.isArray(conversationHistory)
        ? conversationHistory
            .filter((entry: ChatMessage) => entry && (entry.role === 'user' || entry.role === 'assistant'))
            .slice(-12)
            .map((entry: ChatMessage) => ({
              role: entry.role,
              content: entry.content,
            }))
        : []

      const messages: any[] = [
        {
          role: 'system',
          content: `You are a helpful real estate back office assistant with access to Google Calendar and Gmail integration. 
          
CURRENT DATE & TIME: Today is ${currentDate} (${todayIsoLocal}) in Europe/Prague timezone.

CURRENT PAGE CONTEXT: ${contextString}${pendingInfo}${chartInfo}${marketInfo}

You can: 
1) Query real estate data from the database (clients, properties, deals, leads)
2) Create charts and visualizations
3) Check calendar availability and suggest meeting times
4) Draft and send emails through Gmail
5) Create calendar events
6) Create scheduled workflows for recurring email tasks

IMPORTANT GUIDELINES:
- Always reference today's date correctly as ${todayIsoLocal} in Europe/Prague timezone
- When checking calendar, always search from TODAY onwards, not from past dates
- When suggesting meeting times, calculate based on TODAY's date (${todayIsoLocal})
- When suggesting to draft an email with meeting slots, use draft_viewing_email_from_availability tool - it automatically finds your availability and proposes times
- When user asks to check calendar, use get_calendar_availability or suggest_meeting_slots
- For calendar events and meeting times, interpret unspecified times in Europe/Prague local time.
- When calling create_calendar_event, pass local Czech wall-clock time with explicit Prague offset (+01:00 or +02:00). Do not convert user-stated local times to UTC and do not use Z.
- When user asks to delete or change an existing event, first use get_calendar_events_in_range to identify the exact event, then use delete_calendar_event or update_calendar_event with the returned eventId.
- If the user refers to an event by title and time (for example "Divadlo v pátek 27.3. 18:30"), do not say you lack access. Search the relevant time range, find the matching event, and act on it.
- If the user asks to rename, retitle, move, reschedule, or otherwise edit an existing calendar event, you must call update_calendar_event. Do not just say that you are changing it; actually perform the tool call.
- Prefer rename_calendar_event_by_match and delete_calendar_event_by_match when the user refers to an event naturally by title/date/time instead of a raw eventId.
- Never pass the literal string "eventId" into a tool. If you do not have a real eventId, search or use the by_match tools.
- After updating or deleting a calendar event, clearly confirm the completed action and include the final event title/time when helpful.
- When user asks to draft an email, use draft_email (creates a draft without sending)
- When user asks to read or summarize inbox emails, use list_recent_emails and get_email_thread.
- When the user explicitly wants to send a reply in an existing email thread, use reply_to_email_thread.
- Only use send_email if user explicitly says "send", "odesli", "pošli", or similar
- Default behavior is to create drafts for review
- When the user asks to schedule or automate recurring email sending, create a workflow with create_scheduled_email_workflow instead of sending the email immediately.
- When the user wants to send a generated chart by email, use send_chart_email. If they ask for a simple HTML presentation, set includePresentation=true. If they ask for a real PowerPoint, set includePptx=true. If they ask for a PDF report, set includePdf=true.
- If the user asks to create and send a chart or presentation in one request, prefer create_and_send_chart_email instead of promising that you will do it later.
- If the user asks for chart data as a table or attachment, set includeCsv=true so the email also contains a CSV export of the chart data.
- If the user asks for exactly three presentation slides, the PPTX export should be the preferred choice when they ask for PowerPoint, otherwise the HTML presentation already uses a 3-slide layout.
- If the user asks for the chart as an image or JPEG attachment, set includeJpeg=true.
- If the user explicitly asks for only one attachment format, send only that format and do not add extra chart attachments unless requested.
- If the user asks in one message to create a chart and send it by email, do both in the same turn. Do not ask a follow-up question about formats unless the request is ambiguous.
- If the user asks to create and send a chart but does not specify a format, default to includeJpeg=true and send it immediately.
- If the user asks for a three-slide presentation about clients and does not specify grouping, default to data_source=clients, group_by=source, chart_type=bar, includePptx=true and send it in the same turn.
- If the user asks for properties by city, use group_by=city and never use created_at or month as the grouping field.
- If the user asks for a graph of properties by city for email export, prefer a bar chart over a pie chart because it is more readable.
- If the user says "na stejný mail", reuse the most recently mentioned email address from the conversation and send the requested attachment in the same turn.
- Never say that you are about to send a chart or presentation later. Either execute the send tool in this turn or explain the exact concrete failure.
- When the user asks for recurring monitoring of real-estate portals or "nové nabídky z webů", create a market watch workflow with create_market_watch_workflow instead of pretending that a generic email workflow can fetch those sites.
- If the user asks for "poslední", "nejnovější", or a direct one-time question about current listings on Sreality or Bezrealitky, use get_market_listings instead of creating a workflow.
- If the user asks "kolik je momentálně ..." for listings on Sreality or Bezrealitky, use get_market_listing_count.
- If the user follows up about the same market data with phrases like "na tom webu", "ty nabídky", or "libovolnou nabídku", reuse the most recent market context instead of resetting category/location.
- If the user asks to save, import, sync, or store Sreality listings into our database, use sync_sreality_listings_to_database.
- If the user first asked to list a specific number of current listings and then asks to save "je", "ty nabídky", or "těch 5", use save_recent_market_listings_to_database so you save exactly the already shown listings, not a broader sync.
- If the user asks questions about Sreality data that we already imported to our database, prefer query_market_listings_database and count_market_listings_database over live scraping.
- Current market-watch sources are Sreality and Bezrealitky. Be explicit about that if relevant.
- For scheduled workflow requests, generate a concise, meaningful workflow name and description if the user did not specify them.
- If the current page context says pageType is "workflows" and the user asks to list, run, reschedule, pause, or delete workflows, use the workflow tools.
- Always provide accurate information based on available data
- Respond in the same language as the user
- NEVER make up dates or use dates from your training data
- If the current page context says pageType is "map" and the user asks to show, filter, highlight, or find properties on the map, use the filter_properties_on_map tool.
- If the current page context says pageType is "data", prefer the database tools to list, inspect, create, update, and delete real database records.
- For Data page requests, when the user refers to a record naturally, first use list_database_records to find the right record and id, then use get_database_record, update_database_record, or delete_database_record.
- If the user already provided enough fields to create a record, create it immediately. Do not ask for confirmation unless some required field is missing or the target record is ambiguous.
- For simple create requests like a new client with name/source/owner, call create_database_record directly in the same turn.
- For Czech requests like "Vytvoř mi nového klienta se jménem Suotam, zdroj social a owner agent1", the client name is already provided. Do not ask whether "Suotam" can be used as the name. Create the client immediately with name="Suotam".
- Prefer create_client_record for simple client creation requests because it is less error-prone than the generic database tool.
- For Czech property creation requests like "Vytvoř mi novou nemovitost. Název Barák, Typ house, stav sold, nabídková cena 550000 Kč", the title is already provided as "Barák". Do not claim the title is missing.
- Prefer create_property_record for simple property creation requests because it is less error-prone than the generic database tool.
- If the user gives a property title but does not give an address yet, you may still create the property with a temporary placeholder address "Adresa bude doplněna" and clearly mention that the address should be filled in later.
- For Czech lead creation requests like "Vytvoř nový lead pro klienta Jan Novák, zdroj facebook, status new", the client reference, source, and status are already valid inputs. Prefer create_lead_record and resolve the client by name when needed.
- For Czech deal creation requests like "Vytvoř deal pro klienta Jan Novák a nemovitost Barák, stage negotiation, amount 550000", prefer create_deal_record and resolve both client and property by name when needed.
- If the user gave enough information for a lead or deal, do not ask again for the same fields. Perform the tool call or explain only the truly missing dependency.
- For market watch requests, distinguish between two modes:
- new: only listings not seen in previous runs.
- latest: always send the most recent N listings, even if they were already seen before.
- If the user asks for "posledních deset nabídek" or "poslední dvě nabídky", that is latest, not new.
- If the user asks for houses or homes, use category domy. If the user asks for apartments or flats, use category byty.
- If the user does not specify a location and says "kdekoliv" or "v libovolném městě", do not keep using Praha Holešovice. Query all locations.
- Requests like "ulož mi do db všechno z Holešovic do 12 milionů" mean: sync Sreality listings to the internal database with the given location and max price, then confirm how many were stored.
- Requests that combine "najdi/vypiš posledních N nabídek" and "ulož mi je do databáze" mean: first get the latest N listings, then save exactly those same N listings to the database.
- For client rename requests like "Uprav mi klienta Suotam na Šuotam", prefer update_client_record_by_name and perform the rename in the same turn.
- For lead edits described by visible row values like "Změň u tohoto leadu Client 25 FB new ... zdroj na email", prefer update_lead_record_by_match and use the provided row values to identify the exact lead.
- For property edits by title, prefer update_property_record_by_title.
- For deal edits by client + property description, prefer update_deal_record_by_match.
- For delete requests, prefer the natural-language delete tools and perform the deletion in the same turn:
- "Smaž klienta Jan Novák" -> delete_client_record_by_name
- "Smaž nemovitost Barák" -> delete_property_record_by_title
- "Smaž lead klienta Jan Novák ..." -> delete_lead_record_by_match
- "Smaž deal klienta Jan Novák a nemovitosti Barák" -> delete_deal_record_by_match
- For calendar delete requests like "Smaž zítřejší tenis od 12", prefer delete_calendar_event_by_match and actually perform the delete tool call in the same turn.
- For chart requests, map Czech wording exactly:
- "podle typu" => property_type
- "podle města" => city
- "podle lokality" => locality
- "podle stavu" => status
- Never swap "typ" and "město". If the user asks for properties by type, prefer the type grouping, not city.
- When the user asks "Provedl jsi?" after an edit request, do not repeat that you are about to do it. The prior turn should already have executed the update tool. Confirm success or explain the concrete failure.
- For updates and deletes, if the user identified the record naturally by name or other searchable fields, first search it, then perform the update/delete in the same turn.
- Do not say "provádím to nyní" or promise an action without the tool call. Either perform the database tool call or explain exactly what information is still missing.
- Never claim a data record was created, updated, or deleted unless the corresponding database tool call succeeded.
- Treat earlier assistant messages in the conversation as real prior context. If a chart or email was already created earlier in this chat, continue from that state instead of asking the user to repeat it.`
        },
        ...historyMessages
      ]

      let finalResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        tools,
        tool_choice: 'auto',
        max_tokens: 1000
      })

      let responseMessage = finalResponse.choices[0].message

      // Handle tool calls
      if (responseMessage.tool_calls) {
        const toolCalls = responseMessage.tool_calls
        const toolResults = []
        const userId = process.env.SESSION_USER_ID || 'default-user'

        for (const toolCall of toolCalls) {
          try {
            const result = await executeTool(toolCall)
            
            if (isChartResult(result)) {
              chartData = result
              pendingChartByUser[userId] = result
            }

            if (isMapToolResult(result)) {
              mapAction = result.mapAction
            }

            if (isDataToolResult(result)) {
              dataAction = result.dataAction
            }
            
            toolResults.push({
              tool_call_id: toolCall.id,
              role: 'tool',
              content: JSON.stringify(result)
            })
            toolsUsed.push(toolCall.function.name)
          } catch (error) {
            toolResults.push({
              tool_call_id: toolCall.id,
              role: 'tool',
              content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
            })
          }
        }
        // Send results back to OpenAI
        const finalMessages = [
          ...messages,
          responseMessage,
          ...toolResults
        ]

        const finalCompletion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: finalMessages,
          max_tokens: 1000
        })

        response = finalCompletion.choices[0].message.content || 'I could not generate a response.'
      } else {
        response = responseMessage.content || 'I could not generate a response.'
      }
    }

    if (toolsUsed.length > 0) {
      try {
        await supabase.from('agent_logs').update({ tools_used: toolsUsed }).eq('user_prompt', message)
      } catch (updateError) {
        console.log('Failed to update log:', updateError)
      }
    }

    return NextResponse.json({ response, chart: chartData, mapAction, dataAction })
  } catch (error) {
    console.error('Agent error:', error)
    return NextResponse.json({ response: 'An error occurred: ' + (error as any).message, chart: null, mapAction: null, dataAction: null }, { status: 500 })
  }
}
