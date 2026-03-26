import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase'

export async function POST(request: NextRequest) {
  try {
    // Create connected_accounts table
    const { error: connectedAccountsError } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE TABLE IF NOT EXISTS connected_accounts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          provider_user_id TEXT,
          provider_email TEXT,
          access_token TEXT NOT NULL,
          refresh_token TEXT,
          token_expiry TIMESTAMP WITH TIME ZONE,
          scopes TEXT[],
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(user_id, provider)
        );
      `
    })

    if (connectedAccountsError) {
      console.error('Error creating connected_accounts table:', connectedAccountsError)
    }

    // Create audit_logs table
    const { error: auditLogsError } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE TABLE IF NOT EXISTS audit_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id TEXT NOT NULL,
          action TEXT NOT NULL,
          resource_type TEXT,
          resource_id TEXT,
          details JSONB,
          error_message TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `
    })

    if (auditLogsError) {
      console.error('Error creating audit_logs table:', auditLogsError)
    }

    // Create index
    const { error: indexError } = await supabase.rpc('exec_sql', {
      sql: 'CREATE INDEX IF NOT EXISTS idx_connected_accounts_user_id ON connected_accounts(user_id);'
    })

    if (indexError) {
      console.error('Error creating index:', indexError)
    }

    return NextResponse.json({
      success: true,
      message: 'Migration completed',
      errors: {
        connectedAccounts: connectedAccountsError?.message,
        auditLogs: auditLogsError?.message,
        index: indexError?.message
      }
    })
  } catch (error) {
    console.error('Migration error:', error)
    return NextResponse.json(
      { error: 'Migration failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}