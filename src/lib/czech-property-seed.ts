type StreetSeed = {
  name: string
  latitude: number
  longitude: number
}

type LocalitySeed = {
  locality: string
  streets: StreetSeed[]
}

type CitySeed = {
  city: string
  region: string
  localities: LocalitySeed[]
}

export interface SeedPropertyRecord {
  title: string
  address: string
  locality: string
  city: string
  region: string
  latitude: number
  longitude: number
  property_type: string
  status: string
  asking_price: number
  reconstruction_status: string | null
  renovation_notes: string | null
  structural_modifications: string | null
  created_at: string
}

export type AddressLikeProperty = {
  address: string
  city: string | null
  locality: string | null
  latitude?: number | null
  longitude?: number | null
}

const CITY_SEEDS: CitySeed[] = [
  {
    city: 'Praha',
    region: 'Hlavni mesto Praha',
    localities: [
      {
        locality: 'Vinohrady',
        streets: [
          { name: 'Korunni', latitude: 50.0774, longitude: 14.4462 },
          { name: 'Belgicka', latitude: 50.0747, longitude: 14.4388 },
          { name: 'Slezska', latitude: 50.0779, longitude: 14.4525 },
          { name: 'Manesova', latitude: 50.0796, longitude: 14.4372 },
        ],
      },
      {
        locality: 'Karlin',
        streets: [
          { name: 'Krizikova', latitude: 50.0924, longitude: 14.4538 },
          { name: 'Sokolovska', latitude: 50.0934, longitude: 14.4608 },
          { name: 'Pernerova', latitude: 50.0912, longitude: 14.4501 },
          { name: 'Prvniho pluku', latitude: 50.0914, longitude: 14.4424 },
        ],
      },
      {
        locality: 'Smichov',
        streets: [
          { name: 'Nadrazni', latitude: 50.0626, longitude: 14.4097 },
          { name: 'Plzenska', latitude: 50.0691, longitude: 14.3898 },
          { name: 'Kobrova', latitude: 50.0708, longitude: 14.4017 },
          { name: 'Zborovska', latitude: 50.0725, longitude: 14.4094 },
        ],
      },
      {
        locality: 'Holesovice',
        streets: [
          { name: 'Dukelskych hrdinu', latitude: 50.0987, longitude: 14.4373 },
          { name: 'Jankovcova', latitude: 50.1048, longitude: 14.4519 },
          { name: 'Jatecni', latitude: 50.1056, longitude: 14.4402 },
          { name: 'Komunardu', latitude: 50.1088, longitude: 14.4472 },
          { name: 'Ortenovo namesti', latitude: 50.1101, longitude: 14.4457 },
          { name: 'U papirny', latitude: 50.1086, longitude: 14.4449 },
          { name: 'Argentinska', latitude: 50.1033, longitude: 14.4408 },
          { name: 'Tusarova', latitude: 50.1043, longitude: 14.4487 },
          { name: 'Pristavni', latitude: 50.1072, longitude: 14.4406 },
        ],
      },
    ],
  },
  {
    city: 'Brno',
    region: 'Jihomoravsky kraj',
    localities: [
      {
        locality: 'Stred',
        streets: [
          { name: 'Lidicka', latitude: 49.2037, longitude: 16.6086 },
          { name: 'Kotlarska', latitude: 49.2057, longitude: 16.5997 },
          { name: 'Kounicova', latitude: 49.2018, longitude: 16.5938 },
          { name: 'Husova', latitude: 49.1941, longitude: 16.6071 },
        ],
      },
      {
        locality: 'Kralovo Pole',
        streets: [
          { name: 'Purkynova', latitude: 49.2258, longitude: 16.5942 },
          { name: 'Palackeho trida', latitude: 49.2234, longitude: 16.5951 },
          { name: 'Charvatska', latitude: 49.2189, longitude: 16.5907 },
          { name: 'Tycova', latitude: 49.2201, longitude: 16.5838 },
        ],
      },
      {
        locality: 'Zabrdovice',
        streets: [
          { name: 'Bratislavska', latitude: 49.2013, longitude: 16.6265 },
          { name: 'Cernovicka', latitude: 49.1857, longitude: 16.6488 },
          { name: 'Francouzska', latitude: 49.2016, longitude: 16.6206 },
          { name: 'Cejl', latitude: 49.1987, longitude: 16.6213 },
          { name: 'Spolkova', latitude: 49.2004, longitude: 16.6311 },
        ],
      },
      {
        locality: 'Slatina',
        streets: [
          { name: 'Cernovicka', latitude: 49.1718, longitude: 16.6849 },
          { name: 'Tuzanka', latitude: 49.1764, longitude: 16.6802 },
          { name: 'Hviezdoslavova', latitude: 49.1692, longitude: 16.6904 },
          { name: 'Tilhonova', latitude: 49.1704, longitude: 16.6831 },
        ],
      },
      {
        locality: 'Cernovice',
        streets: [
          { name: 'Cernovicka', latitude: 49.1846, longitude: 16.6448 },
          { name: 'Olomoucka', latitude: 49.1905, longitude: 16.6359 },
          { name: 'Turgenovova', latitude: 49.1869, longitude: 16.6467 },
          { name: 'Budejovicka', latitude: 49.1829, longitude: 16.6523 },
        ],
      },
    ],
  },
  {
    city: 'Ostrava',
    region: 'Moravskoslezsky kraj',
    localities: [
      {
        locality: 'Moravska Ostrava',
        streets: [
          { name: 'Nadrazni', latitude: 49.8358, longitude: 18.2881 },
          { name: 'Stodolni', latitude: 49.8343, longitude: 18.2861 },
          { name: '28. rijna', latitude: 49.8354, longitude: 18.2821 },
          { name: 'Ceskobratrska', latitude: 49.8321, longitude: 18.2887 },
        ],
      },
      {
        locality: 'Poruba',
        streets: [
          { name: 'Hlavni trida', latitude: 49.8251, longitude: 18.1598 },
          { name: 'Opavska', latitude: 49.8258, longitude: 18.1709 },
          { name: '17. listopadu', latitude: 49.8304, longitude: 18.1591 },
          { name: 'Mongolska', latitude: 49.8189, longitude: 18.1634 },
        ],
      },
      {
        locality: 'Vitkovice',
        streets: [
          { name: 'Ruska', latitude: 49.8072, longitude: 18.2588 },
          { name: 'Halasova', latitude: 49.8074, longitude: 18.2484 },
          { name: 'Jeremenkova', latitude: 49.8169, longitude: 18.2708 },
          { name: 'Zelezarenska', latitude: 49.8116, longitude: 18.2725 },
        ],
      },
    ],
  },
  {
    city: 'Plzen',
    region: 'Plzensky kraj',
    localities: [
      {
        locality: 'Stred',
        streets: [
          { name: 'Klatovska trida', latitude: 49.7428, longitude: 13.3731 },
          { name: 'Americka', latitude: 49.7448, longitude: 13.3774 },
          { name: 'Pallova', latitude: 49.7472, longitude: 13.3853 },
          { name: 'Sady Petiatricatniku', latitude: 49.7481, longitude: 13.3777 },
        ],
      },
      {
        locality: 'Slovany',
        streets: [
          { name: 'Nepomucka', latitude: 49.7262, longitude: 13.3904 },
          { name: 'Radyne', latitude: 49.7245, longitude: 13.4051 },
          { name: 'Rokycanska', latitude: 49.7422, longitude: 13.4103 },
          { name: 'Koterovska', latitude: 49.7347, longitude: 13.3955 },
        ],
      },
      {
        locality: 'Bory',
        streets: [
          { name: 'Edvarda Benese', latitude: 49.7203, longitude: 13.3649 },
          { name: 'Skupova', latitude: 49.7226, longitude: 13.3591 },
          { name: 'Tylova', latitude: 49.7356, longitude: 13.3598 },
          { name: 'Majerova', latitude: 49.7247, longitude: 13.3502 },
        ],
      },
    ],
  },
  {
    city: 'Olomouc',
    region: 'Olomoucky kraj',
    localities: [
      {
        locality: 'Nova Ulice',
        streets: [
          { name: 'Brnenska', latitude: 49.5877, longitude: 17.2322 },
          { name: 'Hrncirska', latitude: 49.5947, longitude: 17.2516 },
          { name: 'Wellnerova', latitude: 49.5942, longitude: 17.2454 },
          { name: 'Wolkerova', latitude: 49.5923, longitude: 17.2418 },
        ],
      },
      {
        locality: 'Povel',
        streets: [
          { name: 'Jeremenkova', latitude: 49.5837, longitude: 17.2529 },
          { name: 'Schweitzerova', latitude: 49.5802, longitude: 17.2408 },
          { name: 'Janskeho', latitude: 49.5817, longitude: 17.2452 },
          { name: 'Rooseveltova', latitude: 49.5881, longitude: 17.2499 },
        ],
      },
      {
        locality: 'Holice',
        streets: [
          { name: 'Prerovska', latitude: 49.5849, longitude: 17.2945 },
          { name: 'Sladkovskeho', latitude: 49.5865, longitude: 17.2896 },
          { name: 'Na strelnici', latitude: 49.5854, longitude: 17.2797 },
          { name: 'Hamerska', latitude: 49.5809, longitude: 17.3017 },
        ],
      },
    ],
  },
  {
    city: 'Kladno',
    region: 'Stredocesky kraj',
    localities: [
      {
        locality: 'Kladno',
        streets: [
          { name: 'Ke Stadionu', latitude: 50.1424, longitude: 14.1089 },
          { name: 'Americka', latitude: 50.1448, longitude: 14.1026 },
          { name: 'Petra Bezruce', latitude: 50.1407, longitude: 14.0998 },
          { name: 'Ctiborova', latitude: 50.1471, longitude: 14.1041 },
        ],
      },
      {
        locality: 'Rozdelov',
        streets: [
          { name: 'Vitezna', latitude: 50.1526, longitude: 14.0964 },
          { name: 'Sportovcu', latitude: 50.1509, longitude: 14.0901 },
          { name: 'Finskych domku', latitude: 50.1541, longitude: 14.0995 },
          { name: 'Moskevska', latitude: 50.1497, longitude: 14.0957 },
        ],
      },
    ],
  },
  {
    city: 'Liberec',
    region: 'Liberecky kraj',
    localities: [
      {
        locality: 'Mesto',
        streets: [
          { name: 'Prazska', latitude: 50.7714, longitude: 15.0552 },
          { name: 'Moskevska', latitude: 50.7677, longitude: 15.0528 },
          { name: 'Ruprechticka', latitude: 50.7766, longitude: 15.0537 },
          { name: 'Saldovo namesti', latitude: 50.7708, longitude: 15.0541 },
        ],
      },
      {
        locality: 'Rochlice',
        streets: [
          { name: 'Ceske mladeze', latitude: 50.7557, longitude: 15.0618 },
          { name: 'Jablonecka', latitude: 50.7549, longitude: 15.0714 },
          { name: 'Dobiasska', latitude: 50.7455, longitude: 15.0685 },
          { name: 'Aloisina vysina', latitude: 50.7552, longitude: 15.0805 },
        ],
      },
    ],
  },
  {
    city: 'Ceske Budejovice',
    region: 'Jihocesky kraj',
    localities: [
      {
        locality: 'Mesto',
        streets: [
          { name: 'Lannova trida', latitude: 48.9751, longitude: 14.4797 },
          { name: 'Nova', latitude: 48.9764, longitude: 14.4744 },
          { name: 'Manesova', latitude: 48.9716, longitude: 14.4826 },
          { name: 'Riegrova', latitude: 48.9767, longitude: 14.4707 },
        ],
      },
      {
        locality: 'Vltava',
        streets: [
          { name: 'Otavska', latitude: 48.9863, longitude: 14.4529 },
          { name: 'Prazska trida', latitude: 48.9838, longitude: 14.4672 },
          { name: 'Krcinova', latitude: 48.9861, longitude: 14.4601 },
          { name: 'Nadrazni', latitude: 48.9711, longitude: 14.4897 },
        ],
      },
    ],
  },
  {
    city: 'Hradec Kralove',
    region: 'Kralovehradecky kraj',
    localities: [
      {
        locality: 'Mesto',
        streets: [
          { name: 'Gocarova trida', latitude: 50.2093, longitude: 15.8334 },
          { name: 'Strelecka', latitude: 50.2084, longitude: 15.8258 },
          { name: 'Malsovicka', latitude: 50.2047, longitude: 15.8452 },
          { name: 'Komenskeho', latitude: 50.2112, longitude: 15.8311 },
        ],
      },
      {
        locality: 'Moravske Predmesti',
        streets: [
          { name: 'Milady Horakove', latitude: 50.2006, longitude: 15.8157 },
          { name: 'Na Okrouhliku', latitude: 50.1962, longitude: 15.8144 },
          { name: 'Tr. E. Benese', latitude: 50.1988, longitude: 15.8201 },
          { name: 'Alexeje Sevcenka', latitude: 50.1947, longitude: 15.8216 },
        ],
      },
    ],
  },
]

function stableHash(value: string) {
  const normalized = normalizeText(value)
  let hash = 0
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) % 100000
  }
  return hash
}

const CITY_WEIGHTS = new Map([
  ['Praha', 60],
  ['Brno', 35],
  ['Ostrava', 25],
  ['Plzen', 18],
  ['Olomouc', 14],
  ['Liberec', 10],
  ['Ceske Budejovice', 10],
  ['Hradec Kralove', 8],
])

const PROPERTY_TYPES = ['apartment', 'house', 'condo']
const STATUS_WEIGHTS = ['active', 'active', 'active', 'reserved', 'pending', 'sold']
const APARTMENT_LAYOUTS = ['1+kk', '2+kk', '2+1', '3+kk', '3+1', '4+kk']
const HOUSE_LAYOUTS = ['4+kk', '5+kk', '5+1', '6+kk']

function pickOne<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)]
}

function pickCity() {
  const weighted: CitySeed[] = []
  CITY_SEEDS.forEach((city) => {
    const weight = CITY_WEIGHTS.get(city.city) || 1
    for (let i = 0; i < weight; i++) weighted.push(city)
  })
  return pickOne(weighted)
}

function normalizeText(value: string | null | undefined) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function parseAddressNumbers(address: string) {
  const match = address.match(/(\d+)(?:\/(\d+))?/)
  return {
    hasNumber: Boolean(match),
    primary: match ? Number(match[1]) : 1,
    secondary: match?.[2] ? Number(match[2]) : 0,
  }
}

export function sanitizePropertyAddress(address: string | null | undefined) {
  let value = (address || '').trim()
  if (!value) return value

  value = value.replace(/^(?:Byt|Dům|Dum|Rodinný dům|Rodinny dum)\s+/i, '')

  let previous = ''
  while (value !== previous) {
    previous = value
    value = value
      .replace(/^\d+\+\w+\s+/i, '')
      .replace(/^\d+\s*m²\s*/i, '')
      .replace(/^,\s*/i, '')
      .replace(/^pozemek\s+\d+\s*m²\s*/i, '')
      .replace(/^,\s*/i, '')
      .trim()
  }

  return value
}

function looksLikeSpecificAddress(address: string | null | undefined) {
  const normalized = sanitizePropertyAddress(address)
  if (!normalized) return false
  return /\d+/.test(normalized) && normalized.length >= 6
}

function needsAddressBackfill(address: string | null | undefined) {
  const normalized = normalizeText(sanitizePropertyAddress(address))
  if (!normalized) return true
  if (/(^|\s)(main|elm|oak|maple|pine|cedar)\s+(st|street|ave|avenue|road|rd)\b/.test(normalized)) return true
  return [
    'adresa bude doplnena',
    'neznama lokalita',
    'neznama lokalita',
    'lokalita bude doplnena',
  ].includes(normalized)
}

function computeAddressCoordinate(street: StreetSeed, address: string) {
  const { hasNumber, primary, secondary } = parseAddressNumbers(address)
  if (!hasNumber) {
    return {
      latitude: Number(street.latitude.toFixed(6)),
      longitude: Number(street.longitude.toFixed(6)),
    }
  }

  const baseOffset = ((primary % 24) - 12) * 0.00012
  const secondaryOffset = ((secondary % 20) - 10) * 0.00007

  return {
    latitude: Number((street.latitude + baseOffset).toFixed(6)),
    longitude: Number((street.longitude + secondaryOffset).toFixed(6)),
  }
}

function getStreetReference(city: string | null, locality: string | null, address: string) {
  const normalizedCity = normalizeText(city)
  const normalizedLocality = normalizeText(locality)
  const normalizedAddress = normalizeText(address)

  const citySeed = CITY_SEEDS.find((entry) => normalizeText(entry.city) === normalizedCity)
  if (!citySeed) return null

  const localitySeeds = normalizedLocality
    ? citySeed.localities.filter((entry) => normalizeText(entry.locality) === normalizedLocality)
    : citySeed.localities

  for (const localitySeed of localitySeeds) {
    const street = localitySeed.streets.find((entry) => normalizedAddress.startsWith(normalizeText(entry.name)))
    if (street) {
      return { street, locality: localitySeed.locality, region: citySeed.region, city: citySeed.city }
    }
  }

  return null
}

function getLocalityReference(city: string | null, locality: string | null) {
  const normalizedCity = normalizeText(city)
  const normalizedLocality = normalizeText(locality)
  const citySeed = CITY_SEEDS.find((entry) => normalizeText(entry.city) === normalizedCity)
  if (!citySeed) return null

  const localitySeed = citySeed.localities.find((entry) => normalizeText(entry.locality) === normalizedLocality)
  if (!localitySeed) return null

  const anchorStreet = localitySeed.streets[0]
  if (!anchorStreet) return null

  return {
    street: anchorStreet,
    locality: localitySeed.locality,
    region: citySeed.region,
    city: citySeed.city,
  }
}

function getCityReference(city: string | null, seedText?: string) {
  const normalizedCity = normalizeText(city)
  const citySeed = CITY_SEEDS.find((entry) => normalizeText(entry.city) === normalizedCity)
  if (!citySeed || !citySeed.localities.length) return null

  const seed = stableHash(`${city || ''} ${seedText || ''}`)
  const localitySeed = citySeed.localities[seed % citySeed.localities.length]
  const street = localitySeed.streets[seed % localitySeed.streets.length]

  return {
    street,
    locality: localitySeed.locality,
    region: citySeed.region,
    city: citySeed.city,
  }
}

function getAnyReference(seedText?: string) {
  if (!CITY_SEEDS.length) return null
  const seed = stableHash(seedText || 'pepaos')
  const citySeed = CITY_SEEDS[seed % CITY_SEEDS.length]
  const localitySeed = citySeed.localities[seed % citySeed.localities.length]
  const street = localitySeed.streets[seed % localitySeed.streets.length]

  return {
    street,
    locality: localitySeed.locality,
    region: citySeed.region,
    city: citySeed.city,
  }
}

function findCitySeedByLocalityText(text: string | null | undefined) {
  const normalized = normalizeText(text)
  if (!normalized) return null

  for (const citySeed of CITY_SEEDS) {
    const localitySeed = citySeed.localities.find((entry) => normalized.includes(normalizeText(entry.locality)))
    if (localitySeed) {
      return { citySeed, localitySeed }
    }
  }

  return null
}

function parseCityAndLocalityFromAddress(address: string | null | undefined) {
  const cleaned = (address || '').trim()
  if (!cleaned) return { city: null as string | null, locality: null as string | null }

  const parts = cleaned.split(',').map((part) => part.trim()).filter(Boolean)
  const trailing = parts.length >= 2 ? parts[parts.length - 1] : cleaned
  const trailingNormalized = normalizeText(trailing)

  for (const citySeed of CITY_SEEDS) {
    const normalizedCity = normalizeText(citySeed.city)
    if (trailingNormalized === normalizedCity) {
      return { city: citySeed.city, locality: null }
    }

    const localitySeed = citySeed.localities.find(
      (entry) =>
        trailingNormalized === `${normalizedCity} ${normalizeText(entry.locality)}` ||
        trailingNormalized === `${normalizedCity} ${normalizeText(entry.locality)}`.replace(/\s+/g, ' ') ||
        trailingNormalized === `${normalizedCity} ${normalizeText(entry.locality)}`.replace(' ', ' - ')
    )

    if (localitySeed) {
      return { city: citySeed.city, locality: localitySeed.locality }
    }

    const dashParts = trailing.split('-').map((part) => part.trim()).filter(Boolean)
    if (dashParts.length >= 2 && normalizeText(dashParts[0]) === normalizedCity) {
      const normalizedLocality = normalizeText(dashParts.slice(1).join(' '))
      const matchedLocality = citySeed.localities.find((entry) => normalizeText(entry.locality) === normalizedLocality)
      return {
        city: citySeed.city,
        locality: matchedLocality?.locality || dashParts.slice(1).join(' - '),
      }
    }
  }

  return { city: null, locality: null }
}

function buildDeterministicAddress(street: StreetSeed, seedText: string) {
  const hash = stableHash(seedText)
  const primary = (hash % 180) + 1
  const secondary = ((Math.floor(hash / 180)) % 90) + 1
  return `${street.name} ${primary}/${secondary}`
}

function computeFallbackCoordinate(seedLatitude: number, seedLongitude: number, seedText: string) {
  const normalized = normalizeText(seedText)
  let hash = 0
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) % 100000
  }

  const latOffset = ((hash % 21) - 10) * 0.00045
  const lngOffset = (((Math.floor(hash / 21)) % 21) - 10) * 0.00055

  return {
    latitude: Number((seedLatitude + latOffset).toFixed(6)),
    longitude: Number((seedLongitude + lngOffset).toFixed(6)),
  }
}

export function alignPropertyCoordinates<T extends AddressLikeProperty>(property: T): T & { latitude: number; longitude: number } {
  const sanitizedAddress = sanitizePropertyAddress(property.address)
  const existingLatitude = typeof property.latitude === 'number' ? Number(property.latitude.toFixed(6)) : null
  const existingLongitude = typeof property.longitude === 'number' ? Number(property.longitude.toFixed(6)) : null
  const exactGeocodeSource = typeof (property as any).geocode_source === 'string' ? String((property as any).geocode_source) : ''
  const hasOfficialOrExactCoordinates =
    (property as any).ruian_address_code != null ||
    [
      'ruian_official_csv',
      'ruian_street_centroid',
      'ruian_locality_centroid',
      'ruian_city_centroid',
      'manual_exact',
      'sreality_detail_coordinates',
    ].includes(exactGeocodeSource)

  if (existingLatitude != null && existingLongitude != null && hasOfficialOrExactCoordinates) {
    return {
      ...property,
      latitude: existingLatitude,
      longitude: existingLongitude,
    }
  }

  const reference = getStreetReference(property.city, property.locality, sanitizedAddress)

  if (!reference) {
    const localityReference = getLocalityReference(property.city, property.locality)
    if (localityReference) {
      const coords = computeFallbackCoordinate(
        localityReference.street.latitude,
        localityReference.street.longitude,
        `${property.city || ''} ${property.locality || ''} ${sanitizedAddress || ''}`
      )

      return {
        ...property,
        latitude: coords.latitude,
        longitude: coords.longitude,
      }
    }

    const cityReference = getCityReference(property.city, `${property.address || ''} ${property.locality || ''}`)
    if (cityReference) {
      const coords = computeFallbackCoordinate(
        cityReference.street.latitude,
        cityReference.street.longitude,
        `${property.city || ''} ${property.locality || ''} ${sanitizedAddress || ''}`
      )

      return {
        ...property,
        latitude: coords.latitude,
        longitude: coords.longitude,
      }
    }

    return {
      ...property,
      latitude: Number((property.latitude || 49.8175).toFixed(6)),
      longitude: Number((property.longitude || 15.473).toFixed(6)),
    }
  }

  const coords = computeAddressCoordinate(reference.street, sanitizedAddress)
  return {
    ...property,
    latitude: coords.latitude,
    longitude: coords.longitude,
  }
}

export function backfillPropertyLocation<T extends AddressLikeProperty & { title?: string | null; id?: string | null; region?: string | null }>(
  property: T
): T & { address: string; city: string | null; locality: string | null; region?: string | null } {
  const sanitizedAddress = sanitizePropertyAddress(property.address)
  const addressNeedsBackfill = needsAddressBackfill(sanitizedAddress)
  const parsedFromAddress = parseCityAndLocalityFromAddress(sanitizedAddress)
  const nextCity = parsedFromAddress.city || property.city
  const nextLocality = parsedFromAddress.locality || property.locality
  const hasBasicLocation = Boolean(nextCity || nextLocality)
  const mockTitle = /^property\s+\d+$/i.test((property.title || '').trim())

  if (!addressNeedsBackfill && hasBasicLocation && !mockTitle) {
    return {
      ...property,
      address: sanitizedAddress,
      city: nextCity,
      locality: nextLocality,
      region: property.region || getCityReference(nextCity, sanitizedAddress || '')?.region || null,
    }
  }

  const seedText = `${property.title || ''} ${sanitizedAddress || ''} ${nextLocality || ''} ${nextCity || ''} ${property.id || ''}`
  const inferred = findCitySeedByLocalityText(seedText)
  const cityReference = getCityReference(nextCity, seedText)
  const anyReference = getAnyReference(seedText)

  if (!inferred && !cityReference && !anyReference) {
    return {
      ...property,
      address: sanitizedAddress,
      city: nextCity,
      locality: nextLocality,
      region: property.region,
    }
  }

  const street = inferred
    ? inferred.localitySeed.streets[stableHash(seedText) % inferred.localitySeed.streets.length]
    : cityReference?.street || anyReference!.street
  const generatedAddress = buildDeterministicAddress(street, seedText)

  return {
    ...property,
    address: addressNeedsBackfill ? generatedAddress : property.address,
    city: nextCity || inferred?.citySeed.city || cityReference?.city || anyReference!.city,
    locality: nextLocality || inferred?.localitySeed.locality || cityReference?.locality || anyReference!.locality,
    region: property.region || inferred?.citySeed.region || cityReference?.region || anyReference!.region,
  }
}

function priceFor(city: string, propertyType: string) {
  const baseByCity: Record<string, number> = {
    Praha: 9200000,
    Brno: 6900000,
    Ostrava: 4300000,
    Plzen: 5600000,
    Olomouc: 5200000,
    Liberec: 4900000,
    'Ceske Budejovice': 5000000,
    'Hradec Kralove': 5400000,
  }

  const typeMultiplier: Record<string, number> = {
    apartment: 1,
    condo: 1.08,
    house: 1.45,
  }

  const base = baseByCity[city] || 5000000
  const fluctuation = 0.72 + Math.random() * 0.75
  return Math.round((base * (typeMultiplier[propertyType] || 1) * fluctuation) / 10000) * 10000
}

function randomCreatedAt() {
  const daysAgo = Math.floor(Math.random() * 360)
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString()
}

function buildTitle(propertyType: string, locality: string) {
  if (propertyType === 'house') {
    return `Rodinny dum ${pickOne(HOUSE_LAYOUTS)} ${locality}`
  }

  return `Byt ${pickOne(APARTMENT_LAYOUTS)} ${locality}`
}

export function generateCzechPropertySeed(count: number = 180): SeedPropertyRecord[] {
  const properties: SeedPropertyRecord[] = []

  for (let i = 0; i < count; i++) {
    const city = pickCity()
    const localitySeed = pickOne(city.localities)
    const street = pickOne(localitySeed.streets)
    const propertyType = pickOne(PROPERTY_TYPES)
    const status = pickOne(STATUS_WEIGHTS)
    const houseNumber = Math.floor(Math.random() * 220) + 1
    const orientation = Math.random() > 0.5 ? `${Math.floor(Math.random() * 90) + 1}` : `${Math.floor(Math.random() * 2200) + 100}`
    const address = `${street.name} ${houseNumber}/${orientation}`
    const reconstructionStateRoll = Math.random()
    const reconstructionStatus = reconstructionStateRoll < 0.16 ? null : pickOne(['original', 'partial', 'complete', 'planned'])
    const structuralModifications = reconstructionStateRoll < 0.22 ? null : pickOne(['none', 'attic conversion', 'new utility core', 'layout change', 'extension approved'])
    const coords = computeAddressCoordinate(street, address)

    properties.push({
      title: buildTitle(propertyType, localitySeed.locality),
      address,
      locality: localitySeed.locality,
      city: city.city,
      region: city.region,
      latitude: coords.latitude,
      longitude: coords.longitude,
      property_type: propertyType,
      status,
      asking_price: priceFor(city.city, propertyType),
      reconstruction_status: reconstructionStatus,
      renovation_notes: reconstructionStatus ? `Stav rekonstrukce: ${reconstructionStatus}` : null,
      structural_modifications: structuralModifications,
      created_at: randomCreatedAt(),
    })
  }

  return properties
}
