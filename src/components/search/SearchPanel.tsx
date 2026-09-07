// src/components/search/SearchPanel.tsx — 首页搜索面板
import { useEffect, useState } from 'react'
import { View, Text, Picker, Slider } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { searchStore } from '../../stores/searchStore'
import { referenceDataStore, type AirportReference } from '../../stores/referenceDataStore'
import AirportSelector from './AirportSelector'
import CountryPreferenceSelector from './CountryPreferenceSelector'
import { t, localeStore } from '../../i18n'
import { humanDate, toDateString, daysFromNow } from '../../utils/format'
import type { SearchParams, Interest } from '../../types/flight'
import './SearchPanel.scss'

interface SearchPanelProps {
  onSearch: (params: SearchParams) => void
  isLoading?: boolean
}

const INTEREST_KEYS: Interest[] = ['food', 'culture', 'nature', 'shopping', 'nightlife']

const TRANSFER_PREFS: Array<{ key: 'any' | 'direct' | 'transfer'; label: string }> = [
  { key: 'any', label: 'search.any' },
  { key: 'direct', label: 'search.directOnly' },
  { key: 'transfer', label: 'search.allowTransfer' }
]

function SearchPanel({ onSearch, isLoading }: SearchPanelProps) {
  // 机场搜索弹层：当前正在选择的字段
  const [selectorFor, setSelectorFor] = useState<'origin' | 'destination' | ''>('')
  const [showCountryPreferences, setShowCountryPreferences] = useState(false)
  const locale = localeStore.locale

  useEffect(() => { void referenceDataStore.ensureLoaded() }, [])

  const originAirport = referenceDataStore.airport(searchStore.origin)
  const destAirport = referenceDataStore.airport(searchStore.destination)

  const airportCity = (airport: AirportReference) => locale === 'zh' ? airport.cityNameZh : airport.cityNameEn
  const airportName = (airport: AirportReference) => locale === 'zh' ? airport.nameZh : airport.nameEn

  const handleSelect = (iata: string) => {
    if (selectorFor === 'origin') searchStore.setOrigin(iata)
    else if (selectorFor === 'destination') searchStore.setDestination(iata)
  }

  const handleSearch = () => {
    if (isLoading) return
    if (searchStore.origin === searchStore.destination) {
      Taro.showToast({ title: t('search.sameCity'), icon: 'none' })
      return
    }
    onSearch(searchStore.params)
  }

  const countryPreferenceChips = [
    ...searchStore.transitCountryPreferences.preferred.map(code => ({ code, preference: 'preferred' as const })),
    ...searchStore.transitCountryPreferences.excluded.map(code => ({ code, preference: 'excluded' as const }))
  ]

  return (
    <View className='search-panel'>
      {/* 行程卡：对称 OD（机票式布局）+ 精确出发/返程日 */}
      <View className='search-panel__group'>
        <View className='search-panel__od'>
          <View className='search-panel__od-side' hoverClass='tap-dim' onClick={() => setSelectorFor('origin')}>
            <Text className='search-panel__od-city'>{originAirport ? airportCity(originAirport) : searchStore.origin}</Text>
            <Text className='search-panel__od-airport'>{originAirport ? airportName(originAirport) : ''}</Text>
          </View>
          <View className='search-panel__od-mid' hoverClass='tap-dim' onClick={() => searchStore.swapOD()}>
            <View className='search-panel__od-track'>
              <View className='search-panel__od-line' />
              <Text className='search-panel__od-plane'>✈</Text>
              <View className='search-panel__od-line' />
            </View>
            <View className='search-panel__od-swap'>
              <Text>⇄</Text>
            </View>
          </View>
          <View
            className='search-panel__od-side search-panel__od-side--right'
            hoverClass='tap-dim'
            onClick={() => setSelectorFor('destination')}
          >
            <Text className='search-panel__od-city'>{destAirport ? airportCity(destAirport) : searchStore.destination}</Text>
            <Text className='search-panel__od-airport'>{destAirport ? airportName(destAirport) : ''}</Text>
          </View>
        </View>
        <View className='search-panel__divider' />
        <View className='search-panel__dates'>
          <Picker
            className='search-panel__date-col'
            mode='date'
            value={searchStore.departDate}
            start={toDateString(new Date())}
            end={daysFromNow(330)}
            onChange={e => searchStore.setDepartDate(e.detail.value)}
          >
            <View className='search-panel__date-field'>
              <Text className='search-panel__row-label'>{t('search.depart')}</Text>
              <Text className='search-panel__date-value'>{humanDate(searchStore.departDate, locale)}</Text>
            </View>
          </Picker>
          {searchStore.tripType === 'roundtrip' && (
            <>
              <View className='search-panel__vline' />
              <Picker
                className='search-panel__date-col'
                mode='date'
                value={searchStore.returnDate || searchStore.departDate}
                start={searchStore.departDate}
                end={daysFromNow(330)}
                onChange={e => searchStore.setReturnDate(e.detail.value)}
              >
                <View className='search-panel__date-field'>
                  <Text className='search-panel__row-label'>{t('search.returnDate')}</Text>
                  <Text className='search-panel__date-value'>
                    {humanDate(searchStore.returnDate || searchStore.departDate, locale)}
                  </Text>
                </View>
              </Picker>
            </>
          )}
        </View>
      </View>

      {/* 行程类型 + 预算 */}
      <View className='search-panel__group search-panel__group--pad'>
        <View className='search-panel__seg'>
          {(['oneway', 'roundtrip'] as const).map(type => (
            <View
              key={type}
              className={`search-panel__seg-item ${searchStore.tripType === type ? 'is-active' : ''}`}
              onClick={() => searchStore.setTripType(type)}
            >
              <Text>{type === 'oneway' ? t('search.oneway') : t('search.roundtrip')}</Text>
            </View>
          ))}
        </View>

        {/* 预算范围 */}
        <View className='search-panel__block'>
          <View className='search-panel__block-header'>
            <Text className='search-panel__block-label'>{t('search.budget')}</Text>
            <Text className='search-panel__block-value'>
              ¥{searchStore.budgetMin.toLocaleString()} - ¥{searchStore.budgetMax.toLocaleString()}
            </Text>
          </View>
          <View className='search-panel__slider-row'>
            <Text className='search-panel__slider-label'>{t('search.min')}</Text>
            <Slider
              className='search-panel__slider'
              min={500}
              max={20000}
              step={500}
              value={searchStore.budgetMin}
              activeColor='#0a84ff'
              backgroundColor='#3a3a3c'
              blockSize={20}
              blockColor='#ffffff'
              onChanging={e => searchStore.setBudget(Math.min(e.detail.value, searchStore.budgetMax - 500), searchStore.budgetMax)}
            />
          </View>
          <View className='search-panel__slider-row'>
            <Text className='search-panel__slider-label'>{t('search.max')}</Text>
            <Slider
              className='search-panel__slider'
              min={500}
              max={20000}
              step={500}
              value={searchStore.budgetMax}
              activeColor='#0a84ff'
              backgroundColor='#3a3a3c'
              blockSize={20}
              blockColor='#ffffff'
              onChanging={e => searchStore.setBudget(searchStore.budgetMin, Math.max(e.detail.value, searchStore.budgetMin + 500))}
            />
          </View>
        </View>
      </View>

      {/* 偏好：中转 + 兴趣 */}
      <View className='search-panel__group search-panel__group--pad'>
        <View className='search-panel__block'>
          <Text className='search-panel__block-label'>{t('search.transfer')}</Text>
          <View className='search-panel__seg'>
            {TRANSFER_PREFS.map(p => (
              <View
                key={p.key}
                className={`search-panel__seg-item ${searchStore.transferPref === p.key ? 'is-active' : ''}`}
                onClick={() => searchStore.setTransferPref(p.key)}
              >
                <Text>{t(p.label)}</Text>
              </View>
            ))}
          </View>
        </View>
        {searchStore.transferPref !== 'direct' && (
          <View className='search-panel__block'>
            <View className='search-panel__block-header'>
              <View>
                <Text className='search-panel__block-label'>{t('countryPref.searchTitle')}</Text>
                <Text className='search-panel__block-hint'>{t('countryPref.searchHint')}</Text>
              </View>
              <View className='search-panel__country-manage' hoverClass='tap-dim' onClick={() => setShowCountryPreferences(true)}>
                <Text>{countryPreferenceChips.length > 0 ? t('countryPref.manage') : t('countryPref.add')}</Text>
              </View>
            </View>
            {countryPreferenceChips.length > 0 ? (
              <View className='search-panel__chips'>
                {countryPreferenceChips.map(item => {
                  const country = referenceDataStore.country(item.code)
                  if (!country) return null
                  return (
                    <View key={item.code} className={`search-panel__country-chip is-${item.preference}`}>
                      <Text>
                        {item.preference === 'preferred' ? '↑ ' : '× '}
                        {locale === 'zh' ? country.nameZh : country.nameEn}
                      </Text>
                    </View>
                  )
                })}
              </View>
            ) : (
              <Text className='search-panel__country-empty'>{t('countryPref.empty')}</Text>
            )}
          </View>
        )}
        <View className='search-panel__block'>
          <Text className='search-panel__block-label'>{t('search.interests')}</Text>
          <View className='search-panel__chips'>
            {INTEREST_KEYS.map(key => (
              <View
                key={key}
                className={`search-panel__chip ${searchStore.interests.includes(key) ? 'is-active' : ''}`}
                hoverClass='tap-dim'
                onClick={() => searchStore.toggleInterest(key)}
              >
                <Text>{t(`interest.${key}`)}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* CTA */}
      <View
        className={`search-panel__cta ${isLoading ? 'is-loading' : ''}`}
        hoverClass='tap-dim'
        onClick={handleSearch}
      >
        <Text>{isLoading ? t('search.searching') : t('search.cta')}</Text>
      </View>

      {/* 机场搜索弹层 */}
      <AirportSelector
        visible={selectorFor !== ''}
        title={selectorFor === 'origin' ? t('search.depart') : t('search.arrive')}
        selected={selectorFor === 'origin' ? searchStore.origin : searchStore.destination}
        onSelect={handleSelect}
        onClose={() => setSelectorFor('')}
      />
      <CountryPreferenceSelector
        visible={showCountryPreferences}
        preferences={searchStore.transitCountryPreferences}
        onChange={(countryCode, preference) => searchStore.setTransitCountryPreference(countryCode, preference)}
        onClose={() => setShowCountryPreferences(false)}
      />
    </View>
  )
}

export default observer(SearchPanel)
