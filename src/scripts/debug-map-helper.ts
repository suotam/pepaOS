import { config } from 'dotenv'
import 'dotenv/config'
import 'dotenv-flow/config'
config({ path: '../../.env.local' })

import { getPropertiesForMap } from '../lib/property-map'

async function main() {
  const result = await getPropertiesForMap({ limit: 500 })
  console.log(JSON.stringify({
    totalMatching: result.totalMatching,
    visibleCount: result.visibleCount,
    propertiesLength: result.properties.length,
    firstFive: result.properties.slice(0, 5).map((property) => ({
      title: property.title,
      address: property.address,
      city: property.city,
      latitude: property.latitude,
      longitude: property.longitude,
    })),
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
