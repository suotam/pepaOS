import { config } from 'dotenv'
import 'dotenv/config'
import 'dotenv-flow/config'
config({ path: '.env.local' })

import { list_recent_emails } from '../src/lib/google-tools'

async function main() {
  const result = await list_recent_emails(5)
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
