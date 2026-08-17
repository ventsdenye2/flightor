// src/components/search/AirportSelector.tsx — 机场搜索选择弹层
// 替代原 Picker：支持 IATA / 中英文城市名 / 机场名实时搜索
import { useState } from 'react'
import { View, Text, Input, ScrollView } from '@tarojs/components'
import { observer } from 'mobx-react-lite'
import { AIRPORTS, Airport, airportName, airportCity } from '../../mocks/airports'
import { t, localeStore } from '../../i18n'
import './AirportSelector.scss'

interface AirportSelectorProps {
  visible: boolean
  title: string
  selected?: string
  onSelect: (iata: string) => void
  onClose: () => void
}

/** 关键词匹配：IATA 代码 / 中文名 / 英文名 / 国家，均不区分大小写 */
function matchAirport(a: Airport, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    a.iata.toLowerCase().includes(q) ||
    a.name.includes(query) ||
    a.city.includes(query) ||
    a.country.includes(query) ||
    a.enName.toLowerCase().includes(q) ||
    a.enCity.toLowerCase().includes(q)
  )
}

function AirportSelector({ visible, title, selected, onSelect, onClose }: AirportSelectorProps) {
  const [query, setQuery] = useState('')
  const locale = localeStore.locale

  if (!visible) return null

  const results = AIRPORTS.filter(a => matchAirport(a, query))

  const handlePick = (iata: string) => {
    onSelect(iata)
    setQuery('')
    onClose()
  }

  const handleClose = () => {
    setQuery('')
    onClose()
  }

  return (
    <View className='airport-selector' catchMove>
      <View className='airport-selector__mask' onClick={handleClose} />
      <View className='airport-selector__sheet'>
        <View className='airport-selector__header'>
          <Text className='airport-selector__title'>{title}</Text>
          <View className='airport-selector__close' hoverClass='tap-dim' onClick={handleClose}>
            <Text>✕</Text>
          </View>
        </View>

        <View className='airport-selector__search'>
          <Text className='airport-selector__search-icon'>🔍</Text>
          <Input
            className='airport-selector__input'
            value={query}
            placeholder={t('as.placeholder')}
            placeholderClass='airport-selector__placeholder'
            confirmType='search'
            onInput={e => setQuery(e.detail.value)}
          />
          {query.length > 0 && (
            <View className='airport-selector__clear' onClick={() => setQuery('')}>
              <Text>✕</Text>
            </View>
          )}
        </View>

        <ScrollView className='airport-selector__list' scrollY enhanced showScrollbar={false}>
          {results.map(a => (
            <View
              key={a.iata}
              className={`airport-selector__row ${a.iata === selected ? 'is-selected' : ''}`}
              hoverClass='tap-dim'
              onClick={() => handlePick(a.iata)}
            >
              <Text className='font-code airport-selector__iata'>{a.iata}</Text>
              <View className='airport-selector__names'>
                <Text className='airport-selector__city'>{airportCity(a, locale)}</Text>
                <Text className='airport-selector__airport'>{airportName(a, locale)}</Text>
              </View>
              {a.iata === selected && <Text className='airport-selector__check'>✓</Text>}
            </View>
          ))}
          {results.length === 0 && (
            <View className='airport-selector__empty'>
              <Text>{t('as.empty')}</Text>
            </View>
          )}
          <View className='airport-selector__list-pad' />
        </ScrollView>
      </View>
    </View>
  )
}

export default observer(AirportSelector)
