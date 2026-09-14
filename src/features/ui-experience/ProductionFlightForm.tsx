import { useEffect, useState } from 'react'
import { Button, Input, Picker, Slider, Text, View } from '@tarojs/components'
import { observer } from 'mobx-react-lite'
import { searchStore } from '../../stores/searchStore'
import { referenceDataStore } from '../../stores/referenceDataStore'
import type { Interest, SearchParams } from '../../types/flight'
import { localeStore, t } from '../../i18n'
import { daysFromNow, humanDate, toDateString } from '../../utils/format'
import { Icon } from './VisualMedia'
import { Sheet } from './SharedUI'
import './production-flights.scss'

const interests: Interest[] = ['food', 'culture', 'nature', 'shopping', 'nightlife']

/** The production form uses the existing exact-search contract and reference API. */
export const ProductionFlightForm = observer(function ProductionFlightForm({ onSearch, busy = false }: {
  onSearch: (params: SearchParams) => void
  busy?: boolean
}) {
  const [selector, setSelector] = useState<'origin' | 'destination' | 'countries' | null>(null)
  const [query, setQuery] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [error, setError] = useState('')
  const locale = localeStore.locale
  const copy = (zh: string, en: string) => locale === 'en' ? en : zh
  useEffect(() => { void referenceDataStore.ensureLoaded() }, [])
  const airportName = (code: string) => {
    const airport = referenceDataStore.airport(code)
    return airport ? copy(airport.cityNameZh, airport.cityNameEn) : copy('选择机场', 'Choose an airport')
  }
  const open = (value: typeof selector) => { setQuery(''); setSelector(value) }
  const submit = () => {
    if (busy) return
    if (!/^[A-Z]{3}$/.test(searchStore.origin) || !/^[A-Z]{3}$/.test(searchStore.destination)) {
      setError(copy('请选择出发和到达机场。', 'Choose departure and arrival airports.')); return
    }
    if (searchStore.origin === searchStore.destination) { setError(t('search.sameCity')); return }
    if (searchStore.departDate < toDateString(new Date())) { setError(copy('请重新选择出发日期。', 'Choose a new departure date.')); return }
    if (searchStore.tripType === 'roundtrip' && (!searchStore.returnDate || searchStore.returnDate < searchStore.departDate)) {
      setError(copy('返程日期不能早于出发日期。', 'Return date must be on or after departure.')); return
    }
    setError('')
    onSearch(searchStore.params)
  }
  const preferred = searchStore.transitCountryPreferences.preferred
  const excluded = searchStore.transitCountryPreferences.excluded
  const countryCount = preferred.length + excluded.length

  return <>
    <View className='pf-search-box'>
      <View className='pf-search-top'>
        <View className='pf-trip-types'>
          {(['oneway', 'roundtrip'] as const).map(type => <Button key={type} className={`pf-choice${searchStore.tripType === type ? ' is-active' : ''}`}
            disabled={busy} onClick={() => searchStore.setTripType(type)}>{type === 'oneway' ? t('search.oneway') : t('search.roundtrip')}</Button>)}
        </View>
        <Text className='pf-caption'>{copy('人民币报价', 'Prices in CNY')}</Text>
      </View>
      <View className='pf-airports'>
        <Button className='pf-airport-field' disabled={busy} onClick={() => open('origin')} ariaLabel={copy('选择出发机场', 'Choose departure airport')}>
          <Text className='pf-label'>{copy('从哪里出发', 'Flying from')}</Text><Text className='pf-airport-code'>{searchStore.origin}</Text><Text className='pf-caption'>{airportName(searchStore.origin)}</Text>
        </Button>
        <Button className='pf-swap' disabled={busy} onClick={() => searchStore.swapOD()} ariaLabel={copy('交换出发地和目的地', 'Swap airports')}><Icon name='swap' /></Button>
        <Button className='pf-airport-field pf-airport-field--right' disabled={busy} onClick={() => open('destination')} ariaLabel={copy('选择到达机场', 'Choose arrival airport')}>
          <Text className='pf-label'>{copy('想去哪里', 'Flying to')}</Text><Text className='pf-airport-code'>{searchStore.destination}</Text><Text className='pf-caption'>{airportName(searchStore.destination)}</Text>
        </Button>
      </View>
      <View className='pf-dates'>
        <Picker className='pf-date' mode='date' value={searchStore.departDate} start={toDateString(new Date())} end={daysFromNow(330)} disabled={busy}
          onChange={event => searchStore.setDepartDate(event.detail.value)}>
          <Text className='pf-label'>{t('search.depart')}</Text><View className='pf-date-value'><Icon name='calendar' /><Text>{humanDate(searchStore.departDate, locale)}</Text></View>
        </Picker>
        {searchStore.tripType === 'roundtrip' && <Picker className='pf-date' mode='date' value={searchStore.returnDate} start={searchStore.departDate} end={daysFromNow(330)} disabled={busy}
          onChange={event => searchStore.setReturnDate(event.detail.value)}>
          <Text className='pf-label'>{t('search.returnDate')}</Text><View className='pf-date-value'><Icon name='calendar' /><Text>{humanDate(searchStore.returnDate, locale)}</Text></View>
        </Picker>}
      </View>
      <Button className='pf-filter-toggle' disabled={busy} onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
        <View><Text>{copy('预算与中转偏好', 'Budget and connections')}</Text><Text className='pf-caption'>¥{searchStore.budgetMin.toLocaleString()}–{searchStore.budgetMax.toLocaleString()} · {searchStore.transferPref === 'direct' ? t('search.directOnly') : searchStore.transferPref === 'transfer' ? t('search.allowTransfer') : t('search.any')}{countryCount ? ` · ${countryCount} ${copy('项国家偏好', 'country preferences')}` : ''}</Text></View>
        <Icon name='chevron-right' className={advanced ? 'pf-chevron pf-chevron--open' : 'pf-chevron'} />
      </Button>
      {advanced && <View className='pf-preferences'>
        <View className='pf-budget-label'><Text>{t('search.min')}</Text><Text>¥{searchStore.budgetMin.toLocaleString()}</Text></View>
        <Slider min={500} max={20000} step={500} value={searchStore.budgetMin} disabled={busy} activeColor='#2563eb' backgroundColor='#dce9eb' blockSize={18}
          onChanging={event => searchStore.setBudget(Math.min(event.detail.value, searchStore.budgetMax - 500), searchStore.budgetMax)} />
        <View className='pf-budget-label'><Text>{t('search.max')}</Text><Text>¥{searchStore.budgetMax.toLocaleString()}</Text></View>
        <Slider min={500} max={20000} step={500} value={searchStore.budgetMax} disabled={busy} activeColor='#2563eb' backgroundColor='#dce9eb' blockSize={18}
          onChanging={event => searchStore.setBudget(searchStore.budgetMin, Math.max(event.detail.value, searchStore.budgetMin + 500))} />
        <Text className='pf-section-label'>{t('search.transfer')}</Text>
        <View className='pf-chips'>{(['any', 'direct', 'transfer'] as const).map(value => <Button key={value} disabled={busy} className={`pf-chip${searchStore.transferPref === value ? ' is-active' : ''}`} onClick={() => searchStore.setTransferPref(value)}>{value === 'any' ? t('search.any') : value === 'direct' ? t('search.directOnly') : t('search.allowTransfer')}</Button>)}</View>
        {searchStore.transferPref !== 'direct' && <Button className='pf-country-button' disabled={busy} onClick={() => open('countries')}><Text>{copy('中转国家偏好', 'Transit country preferences')}</Text><Text>{countryCount ? `${countryCount} ${copy('项已设置', 'selected')}` : copy('选择', 'Choose')}</Text><Icon name='chevron-right' /></Button>}
        <Text className='pf-section-label'>{t('search.interests')}</Text>
        <View className='pf-chips'>{interests.map(interest => <Button key={interest} disabled={busy} className={`pf-chip${searchStore.interests.includes(interest) ? ' is-active' : ''}`} onClick={() => searchStore.toggleInterest(interest)}>{t(`interest.${interest}`)}</Button>)}</View>
      </View>}
      {error && <View className='pf-form-error' role='alert'>{error}</View>}
      <Button className='ux-primary pf-submit' disabled={busy} onClick={submit}><Icon name='plane' />{busy ? t('search.searching') : copy('搜索航班', 'Search flights')}</Button>
      <Text className='pf-search-note'>{copy('先比较搜索报价，再确认当前价格与中转条件。', 'Compare search quotes, then confirm current fares and connection conditions.')}</Text>
    </View>
    {selector && <Sheet title={selector === 'countries' ? copy('中转国家偏好', 'Transit country preferences') : selector === 'origin' ? copy('从哪里出发', 'Flying from') : copy('想去哪里', 'Flying to')} onClose={() => setSelector(null)}>
      <View className='pf-picker-search'><Icon name='compass' /><Input value={query} onInput={event => setQuery(event.detail.value)} placeholder={selector === 'countries' ? copy('搜索国家或地区', 'Search countries') : copy('搜索城市、机场或三字码', 'Search cities or airport codes')} /></View>
      {referenceDataStore.loading ? <View className='pf-picker-note' role='status'>{copy('正在加载可选地点…', 'Loading available locations…')}</View> : referenceDataStore.error ? <View className='pf-picker-note' role='alert'><Text>{copy('地点列表暂时无法加载。', 'Locations are temporarily unavailable.')}</Text><Button className='ux-text-button' onClick={() => void referenceDataStore.ensureLoaded()}>{copy('重新加载', 'Retry')}</Button></View> : <View className='pf-picker-list'>
        {selector === 'countries' ? <>
          <Text className='pf-picker-note'>{copy('偏好影响推荐顺序；避开的国家会从结果中排除。', 'Preferred countries affect ranking; excluded countries filter results.')}</Text>
          {referenceDataStore.countries.filter(country => !query.trim() || [country.code, country.nameZh, country.nameEn].some(value => value.toLowerCase().includes(query.trim().toLowerCase()))).map(country => <View className='pf-country-row' key={country.code}>
            <Text>{copy(country.nameZh, country.nameEn)}</Text><View className='pf-country-actions'>
              <Button className={`pf-chip${preferred.includes(country.code) ? ' is-active' : ''}`} onClick={() => searchStore.setTransitCountryPreference(country.code, preferred.includes(country.code) ? 'neutral' : 'preferred')}>{copy('偏好', 'Prefer')}</Button>
              <Button className={`pf-chip${excluded.includes(country.code) ? ' is-excluded' : ''}`} onClick={() => searchStore.setTransitCountryPreference(country.code, excluded.includes(country.code) ? 'neutral' : 'excluded')}>{copy('避开', 'Avoid')}</Button>
            </View>
          </View>)}
        </> : <>
          {referenceDataStore.searchAirports(query).map(airport => <Button key={airport.iata} className='pf-airport-option' onClick={() => {
            if (selector === 'origin') searchStore.setOrigin(airport.iata)
            else searchStore.setDestination(airport.iata)
            setError(''); setSelector(null)
          }}><Text className='pf-airport-option-code'>{airport.iata}</Text><View><Text>{copy(airport.cityNameZh, airport.cityNameEn)}</Text><Text className='pf-caption'>{copy(airport.nameZh, airport.nameEn)}</Text></View><Icon name='chevron-right' /></Button>)}
          {referenceDataStore.searchAirports(query).length === 0 && <Text className='pf-picker-note'>{copy('没有找到匹配机场，试试三字码或其他城市名。', 'No matching airport. Try its code or another city name.')}</Text>}
        </>}
      </View>}
    </Sheet>}
  </>
})
