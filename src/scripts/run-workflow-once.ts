import { config } from 'dotenv'
import 'dotenv/config'
import 'dotenv-flow/config'
config({ path: '../../.env.local' })

import { workflowEngine } from '../lib/workflow-engine'

async function main() {
  const workflowId = process.argv[2]

  if (!workflowId) {
    throw new Error('Workflow id is required.')
  }

  await workflowEngine.executeWorkflow(workflowId)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
