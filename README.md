# pepaOS - AI-Powered Back Office Operations Agent

A production-ready MVP for real estate back office operations with a unified dashboard interface.

## Features

- **Unified Dashboard**: All features accessible through tabs
- **Real-time KPIs**: Weekly performance metrics with icons
- **AI Agent Chat**: Natural language queries for analytics, reports, data quality, and workflows
- **Interactive Charts**: Line charts for leads vs sales reports
- **Outputs Management**: View generated reports and outputs
- **Workflow Creation**: Create and manage automated workflows
- **Responsive Design**: Works on desktop and mobile devices

## Tech Stack

- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- Supabase (PostgreSQL)
- OpenAI API
- Recharts for data visualization
- Lucide React for icons

## Setup

1. Create a Supabase project at https://supabase.com
2. Run the SQL in `supabase/schema.sql` to create tables
3. Copy `.env.local.example` to `.env.local` and fill in your Supabase URL, anon key, and OpenAI API key
4. Install dependencies: `npm install`
5. Seed the database: `npm run seed`
6. Run the app: `npm run dev`

## Usage

Navigate to `/dashboard` to access all features:

- **Dashboard Tab**: View weekly KPIs and performance metrics
- **Agent Tab**: Chat with the AI agent for insights and automation
- **Outputs Tab**: Browse generated reports and charts
- **Workflows Tab**: Create and manage business workflows

## Property Map

- Open `/properties/map` for the operational property map
- The map supports filters, list-to-map selection, clustering, and AI sidebar context sync

### Exact Czech address coordinates with RUIAN

For exact coordinates from the official Czech address registry, import a CSV export from CUZK / RUIAN and enrich the `properties` table:

1. Run the DB migration in `supabase/migrations/003_add_property_geocoding_metadata.sql`
2. Obtain an official RUIAN address CSV export from CUZK
3. Set `RUIAN_CSV_PATH` either to:

- one official CSV file
- or a folder containing many official CSV files (for example the "po obcích" download)

4. Run:

```bash
npm run geocode:ruian -- path/to/official-ruian-addresses.csv
```

This updates matching properties with exact latitude/longitude and stores the official address code when available.

If you also set `RUIAN_CSV_PATH` in `.env.local`, the app will automatically use the same official dataset for:

- newly created properties
- edited properties
- imported market listings (for example from Sreality)

That keeps the map coordinates exact for both old and newly added records instead of relying only on heuristic fallback coordinates.

## Workflow scheduling on Vercel

Production workflow execution uses the runner endpoint:

- endpoint: `/api/workflows/runner`

For Vercel deployment, the repository includes [vercel.json](./vercel.json) with a daily cron schedule at `8:30`:

```json
{
  "crons": [
    {
      "path": "/api/workflows/runner",
      "schedule": "30 8 * * *"
    }
  ]
}
```

That is compatible with Vercel Hobby daily cron limits.

## Agent Commands

Try these queries in the agent chat:
- "Show me analytics" - Get weekly KPIs
- "Generate a report" - Create leads vs sales chart
- "Check data quality" - Find properties with missing data
- "Create a workflow" - Set up automated processes
