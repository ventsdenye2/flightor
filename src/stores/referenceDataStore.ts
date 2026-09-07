import { makeAutoObservable, runInAction } from 'mobx'
import { request } from '../utils/request'

export interface AirportReference {
  iata: string
  nameZh: string
  nameEn: string
  cityNameZh: string
  cityNameEn: string
  countryCode: string
  countryNameZh: string
  countryNameEn: string
  latitude?: number
  longitude?: number
}

export interface CountryReference {
  code: string
  nameZh: string
  nameEn: string
  region: string
  popular: boolean
}

interface AirportApiRecord {
  iata: string
  name_zh: string
  name_en: string
  city_name_zh: string | null
  city_name_en: string | null
  country_code: string
  country_name_zh: string
  country_name_en: string
  latitude: number | string | null
  longitude: number | string | null
}

interface CountryApiRecord {
  code: string
  name_zh: string
  name_en: string
  region: string
  is_popular: boolean
}

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(number) ? number : undefined
}

function distanceKm(left: AirportReference, right: AirportReference): number | undefined {
  if (left.latitude === undefined || left.longitude === undefined || right.latitude === undefined || right.longitude === undefined) return undefined
  const toRadians = (degrees: number) => degrees * Math.PI / 180
  const latitude = toRadians(right.latitude - left.latitude)
  const longitude = toRadians(right.longitude - left.longitude)
  const value = Math.sin(latitude / 2) ** 2
    + Math.cos(toRadians(left.latitude)) * Math.cos(toRadians(right.latitude)) * Math.sin(longitude / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(value))
}

export class ReferenceDataStore {
  airports: AirportReference[] = []
  countries: CountryReference[] = []
  loading = false
  error = ''
  private loaded = false

  constructor() { makeAutoObservable(this) }

  async ensureLoaded() {
    if (this.loaded || this.loading) return
    this.loading = true
    this.error = ''
    try {
      const [airportResponse, countryResponse] = await Promise.all([
        request<{ airports: AirportApiRecord[] }>({ url: '/v1/airports?limit=100', retry: 1 }),
        request<{ countries: CountryApiRecord[] }>({ url: '/v1/countries?limit=100', retry: 1 })
      ])
      const airports = airportResponse.airports
        .filter(item => /^[A-Z]{3}$/.test(item.iata))
        .map(item => ({
          iata: item.iata,
          nameZh: item.name_zh,
          nameEn: item.name_en,
          cityNameZh: item.city_name_zh ?? item.name_zh,
          cityNameEn: item.city_name_en ?? item.name_en,
          countryCode: item.country_code,
          countryNameZh: item.country_name_zh,
          countryNameEn: item.country_name_en,
          ...(finiteNumber(item.latitude) === undefined ? {} : { latitude: finiteNumber(item.latitude) }),
          ...(finiteNumber(item.longitude) === undefined ? {} : { longitude: finiteNumber(item.longitude) })
        }))
      const countries = countryResponse.countries.map(item => ({
        code: item.code,
        nameZh: item.name_zh,
        nameEn: item.name_en,
        region: item.region,
        popular: item.is_popular
      }))
      runInAction(() => {
        this.airports = airports
        this.countries = countries
        this.loaded = true
        this.loading = false
      })
    } catch (error) {
      runInAction(() => {
        this.error = (error as Error)?.message || 'REFERENCE_DATA_UNAVAILABLE'
        this.loading = false
      })
    }
  }

  airport(iata: string): AirportReference | undefined {
    return this.airports.find(airport => airport.iata === iata.toUpperCase())
  }

  country(code: string): CountryReference | undefined {
    return this.countries.find(country => country.code === code.toUpperCase())
  }

  searchAirports(query: string): AirportReference[] {
    const value = query.trim().toLowerCase()
    if (!value) return this.airports
    return this.airports.filter(airport => [
      airport.iata, airport.nameZh, airport.nameEn, airport.cityNameZh, airport.cityNameEn,
      airport.countryNameZh, airport.countryNameEn
    ].some(field => field.toLowerCase().includes(value)))
  }

  searchCountries(query: string): CountryReference[] {
    const value = query.trim().toLowerCase()
    const source = value ? this.countries : this.countries.filter(country => country.popular)
    return source.filter(country => !value || [country.code, country.nameZh, country.nameEn].some(field => field.toLowerCase().includes(value)))
  }

  nearbyAirports(iata: string, radiusKm: number, maxCount = 3): Array<{ airport: AirportReference; distanceKm: number }> {
    const primary = this.airport(iata)
    if (!primary) return []
    return this.airports
      .filter(candidate => candidate.iata !== primary.iata)
      .map(candidate => ({ airport: candidate, distanceKm: distanceKm(primary, candidate) }))
      .filter((item): item is { airport: AirportReference; distanceKm: number } => item.distanceKm !== undefined && item.distanceKm <= radiusKm)
      .sort((left, right) => left.distanceKm - right.distanceKm)
      .slice(0, maxCount)
  }

  reset() {
    this.airports = []
    this.countries = []
    this.loading = false
    this.error = ''
    this.loaded = false
  }
}

export const referenceDataStore = new ReferenceDataStore()
