# pepaOS - AI-Powered Back Office Operations Agent

A production-ready MVP for real estate back office operations.

## Setup

1. Create a Supabase project at https://supabase.com
2. Run the SQL in `supabase/schema.sql` to create tables
3. Copy `.env.local.example` to `.env.local` and fill in your Supabase URL, anon key, and OpenAI API key
4. Install dependencies: `npm install`
5. Seed the database: `npm run seed`
6. Run the app: `npm run dev`

## Features

- Dashboard with KPIs
- Agent chat with AI assistance
- Outputs list
- Workflows management

## Tech Stack

- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- Supabase
- OpenAI API
- Recharts for charts