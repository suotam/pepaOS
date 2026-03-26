import nextDynamic from 'next/dynamic'

export const dynamic = 'force-dynamic'

const PropertyMapClient = nextDynamic(() => import('./property-map-client'), { ssr: false })

export default function PropertiesMapPage() {
  return <PropertyMapClient />
}
