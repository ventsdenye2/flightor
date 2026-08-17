// src/components/search/SearchPanel.tsx — 首页搜索面板
import { useState } from 'react'
import { View, Text, Picker, Slider } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { searchStore } from '../../stores/searchStore'
import { findAirport, airportName, airportCity, nearbyAirports } from '../../mocks/airports'
import AirportSelector from './AirportSelector'
import { t, localeStore } from '../../i18n'
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

// 出发圈半径选项（公里，0=仅本场）
const CIRCLE_RADIUS_OPTIONS = [0, 100, 200, 300]

function SearchPanel({ onSearch, isLoading }: SearchPanelProps) {
  // 机场搜索弹层：当前正在选择的字段
  const [selectorFor, setSelectorFor] = useState<'origin' | 'destination' | ''>('')
  const locale = localeStore.locale

  const originAirport = findAirport(searchStore.origin)
  const destAirport = findAirport(searchStore.destination)

  // 出发圈/到达圈内的邻近机场（不含主机场）
  const circleMates = nearbyAirports(searchStore.origin, searchStore.circleRadiusKm).slice(1)
  const destCircleMates = nearbyAirports(searchStore.destination, searchStore.destCircleRadiusKm).slice(1)

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

  return (
    <View className='search-panel'>
      {/* 行程卡：对称 OD（机票式布局）+ 出发窗口 */}
      <View className='search-panel__group'>
        <View className='search-panel__od'>
          <View className='search-panel__od-side' hoverClass='tap-dim' onClick={() => setSelectorFor('origin')}>
            <Text className='font-code search-panel__od-iata'>{searchStore.origin}</Text>
            <Text className='search-panel__od-city'>{originAirport ? airportCity(originAirport, locale) : ''}</Text>
            <Text className='search-panel__od-airport'>{originAirport ? airportName(originAirport, locale) : ''}</Text>
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
            <Text className='font-code search-panel__od-iata'>{searchStore.destination}</Text>
            <Text className='search-panel__od-city'>{destAirport ? airportCity(destAirport, locale) : ''}</Text>
            <Text className='search-panel__od-airport'>{destAirport ? airportName(destAirport, locale) : ''}</Text>
          </View>
        </View>
        <View className='search-panel__divider' />
        <View className='search-panel__dates'>
          <Picker
            className='search-panel__date-col'
            mode='date'
            value={searchStore.departDate}
            onChange={e => searchStore.setDepartDate(e.detail.value)}
          >
            <View className='search-panel__date-field'>
              <Text className='search-panel__row-label'>{t('search.earliest')}</Text>
              <Text className='font-code search-panel__date-value'>{searchStore.departDate}</Text>
            </View>
          </Picker>
          <View className='search-panel__vline' />
          <Picker
            className='search-panel__date-col'
            mode='date'
            value={searchStore.departDateEnd}
            start={searchStore.departDate}
            onChange={e => searchStore.setDepartDateEnd(e.detail.value)}
          >
            <View className='search-panel__date-field'>
              <Text className='search-panel__row-label'>{t('search.latest')}</Text>
              <Text className='font-code search-panel__date-value'>{searchStore.departDateEnd}</Text>
            </View>
          </Picker>
        </View>
      </View>

      {/* 比价圈：出发圈 / 到达圈 */}
      <View className='search-panel__group search-panel__group--pad'>
        <View className='search-panel__block'>
          <Text className='search-panel__block-label'>{t('search.circle')}</Text>
          <View className='search-panel__seg'>
            {CIRCLE_RADIUS_OPTIONS.map(km => (
              <View
                key={km}
                className={`search-panel__seg-item ${searchStore.circleRadiusKm === km ? 'is-active' : ''}`}
                onClick={() => searchStore.setCircleRadius(km)}
              >
                <Text>{km === 0 ? t('search.onlySelf') : `±${km}km`}</Text>
              </View>
            ))}
          </View>
          {circleMates.length > 0 && (
            <Text className='search-panel__hint'>
              {t('search.include', { list: circleMates.map(a => `${a.iata} ${airportCity(a, locale)}`).join(' · ') })}
            </Text>
          )}
        </View>
        <View className='search-panel__block'>
          <Text className='search-panel__block-label'>{t('search.destCircle')}</Text>
          <View className='search-panel__seg'>
            {CIRCLE_RADIUS_OPTIONS.map(km => (
              <View
                key={km}
                className={`search-panel__seg-item ${searchStore.destCircleRadiusKm === km ? 'is-active' : ''}`}
                onClick={() => searchStore.setDestCircleRadius(km)}
              >
                <Text>{km === 0 ? t('search.onlySelf') : `±${km}km`}</Text>
              </View>
            ))}
          </View>
          {destCircleMates.length > 0 && (
            <Text className='search-panel__hint'>
              {t('search.include', { list: destCircleMates.map(a => `${a.iata} ${airportCity(a, locale)}`).join(' · ') })}
            </Text>
          )}
        </View>
      </View>

      {/* 行程类型 + 天数/预算 */}
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

        {/* 往返：游玩天数区间 */}
        {searchStore.tripType === 'roundtrip' && (
          <View className='search-panel__block'>
            <View className='search-panel__block-header'>
              <Text className='search-panel__block-label'>{t('search.stay')}</Text>
              <Text className='search-panel__block-value'>
                {t('search.stayDays', { min: searchStore.stayMin, max: searchStore.stayMax })}
              </Text>
            </View>
            <View className='search-panel__slider-row'>
              <Text className='search-panel__slider-label'>{t('search.stayMin')}</Text>
              <Slider
                className='search-panel__slider'
                min={2}
                max={30}
                step={1}
                value={searchStore.stayMin}
                activeColor='#0a84ff'
                backgroundColor='#3a3a3c'
                blockSize={20}
                blockColor='#ffffff'
                onChanging={e => searchStore.setStay(Math.min(e.detail.value, searchStore.stayMax), searchStore.stayMax)}
              />
            </View>
            <View className='search-panel__slider-row'>
              <Text className='search-panel__slider-label'>{t('search.stayMax')}</Text>
              <Slider
                className='search-panel__slider'
                min={2}
                max={30}
                step={1}
                value={searchStore.stayMax}
                activeColor='#0a84ff'
                backgroundColor='#3a3a3c'
                blockSize={20}
                blockColor='#ffffff'
                onChanging={e => searchStore.setStay(searchStore.stayMin, Math.max(e.detail.value, searchStore.stayMin))}
              />
            </View>
          </View>
        )}

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
    </View>
  )
}

export default observer(SearchPanel)
