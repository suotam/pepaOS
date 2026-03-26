import dynamic from 'next/dynamic'

const PropertyMapClient = dynamic(() => import('./property-map-client'), { ssr: false })

export default function PropertiesMapPage() {
  return <PropertyMapClient />
}
