// 国家目录：国家是一等实体，机场通过 country 字段归入国家层级。
import type { Locale } from '../i18n'
import { AIRPORTS, type Airport } from './airports'

export interface Country {
  code: string
  name: string
  enName: string
  airports: Airport[]
}

const COUNTRY_META: Record<string, { code: string; enName: string }> = {
  中国: { code: 'CN', enName: 'China' },
  中国香港: { code: 'HK', enName: 'Hong Kong SAR' },
  中国台湾: { code: 'TW', enName: 'Taiwan, China' },
  日本: { code: 'JP', enName: 'Japan' },
  韩国: { code: 'KR', enName: 'South Korea' },
  新加坡: { code: 'SG', enName: 'Singapore' },
  泰国: { code: 'TH', enName: 'Thailand' },
  马来西亚: { code: 'MY', enName: 'Malaysia' },
  越南: { code: 'VN', enName: 'Vietnam' },
  菲律宾: { code: 'PH', enName: 'Philippines' },
  印度: { code: 'IN', enName: 'India' },
  斯里兰卡: { code: 'LK', enName: 'Sri Lanka' },
  卡塔尔: { code: 'QA', enName: 'Qatar' },
  阿联酋: { code: 'AE', enName: 'United Arab Emirates' },
  土耳其: { code: 'TR', enName: 'Türkiye' },
  芬兰: { code: 'FI', enName: 'Finland' },
  英国: { code: 'GB', enName: 'United Kingdom' },
  法国: { code: 'FR', enName: 'France' },
  德国: { code: 'DE', enName: 'Germany' },
  荷兰: { code: 'NL', enName: 'Netherlands' },
  瑞士: { code: 'CH', enName: 'Switzerland' },
  意大利: { code: 'IT', enName: 'Italy' },
  西班牙: { code: 'ES', enName: 'Spain' },
  美国: { code: 'US', enName: 'United States' },
  加拿大: { code: 'CA', enName: 'Canada' },
  澳大利亚: { code: 'AU', enName: 'Australia' },
  新西兰: { code: 'NZ', enName: 'New Zealand' },
  印度尼西亚: { code: 'ID', enName: 'Indonesia' },
  沙特阿拉伯: { code: 'SA', enName: 'Saudi Arabia' },
  埃及: { code: 'EG', enName: 'Egypt' },
  南非: { code: 'ZA', enName: 'South Africa' },
  肯尼亚: { code: 'KE', enName: 'Kenya' },
  埃塞俄比亚: { code: 'ET', enName: 'Ethiopia' },
  奥地利: { code: 'AT', enName: 'Austria' },
  丹麦: { code: 'DK', enName: 'Denmark' },
  瑞典: { code: 'SE', enName: 'Sweden' },
  挪威: { code: 'NO', enName: 'Norway' },
  爱尔兰: { code: 'IE', enName: 'Ireland' },
  葡萄牙: { code: 'PT', enName: 'Portugal' },
  希腊: { code: 'GR', enName: 'Greece' },
  捷克: { code: 'CZ', enName: 'Czechia' },
  波兰: { code: 'PL', enName: 'Poland' },
  俄罗斯: { code: 'RU', enName: 'Russia' },
  墨西哥: { code: 'MX', enName: 'Mexico' },
  巴西: { code: 'BR', enName: 'Brazil' },
  阿根廷: { code: 'AR', enName: 'Argentina' },
  智利: { code: 'CL', enName: 'Chile' },
  哥伦比亚: { code: 'CO', enName: 'Colombia' }
}

/** 国家 → 机场的规范层级；原 AIRPORTS 继续作为兼容的扁平索引。 */
export const COUNTRIES: Country[] = Object.entries(COUNTRY_META)
  .map(([name, meta]) => ({
    ...meta,
    name,
    airports: AIRPORTS.filter(airport => airport.country === name)
  }))
  .filter(country => country.airports.length > 0)

const COUNTRY_BY_CODE = new Map(COUNTRIES.map(country => [country.code, country]))
const COUNTRY_BY_AIRPORT = new Map(
  COUNTRIES.flatMap(country => country.airports.map(airport => [airport.iata, country] as const))
)

export function findCountry(code: string): Country | undefined {
  return COUNTRY_BY_CODE.get(code.toUpperCase())
}

export function countryOfAirport(iata: string): Country | undefined {
  return COUNTRY_BY_AIRPORT.get(iata.toUpperCase())
}

export function countryName(country: Country, locale: Locale): string {
  return locale === 'zh' ? country.name : country.enName
}

/** 国家检索：同时匹配国家名称/代码，以及其下机场的城市、名称和 IATA。 */
export function searchCountries(keyword: string): Country[] {
  const query = keyword.trim().toLowerCase()
  if (!query) return []
  return COUNTRIES.filter(country =>
    country.code.toLowerCase().includes(query) ||
    country.name.toLowerCase().includes(query) ||
    country.enName.toLowerCase().includes(query) ||
    country.airports.some(airport =>
      airport.iata.toLowerCase().includes(query) ||
      airport.name.toLowerCase().includes(query) ||
      airport.enName.toLowerCase().includes(query) ||
      airport.city.toLowerCase().includes(query) ||
      airport.enCity.toLowerCase().includes(query)
    )
  )
}

/** 当前搜索引擎能生成的中转枢纽；选择器只展示真正可参与推荐的国家。 */
export const TRANSFER_HUB_IATAS = ['KUL', 'BKK', 'SIN', 'DOH', 'DXB', 'IST', 'HEL'] as const

export const TRANSFER_COUNTRIES: Country[] = Array.from(
  new Set(TRANSFER_HUB_IATAS.map(iata => countryOfAirport(iata)?.code).filter(Boolean) as string[])
)
  .map(code => findCountry(code))
  .filter((country): country is Country => Boolean(country))
