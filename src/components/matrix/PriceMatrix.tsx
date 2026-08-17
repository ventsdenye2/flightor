// src/components/matrix/PriceMatrix.tsx — 价差矩阵（机场 × 日期 热力表）
import { View, Text } from '@tarojs/components'
import { observer } from 'mobx-react-lite'
import type { PriceMatrixData } from '../../services/flightService'
import { cityOf } from '../../mocks/airports'
import { t, localeStore } from '../../i18n'
import './PriceMatrix.scss'

interface PriceMatrixProps {
  matrix: PriceMatrixData
  picked: { origin: string; date: string } | null
  onPick: (origin: string, date: string) => void
}

/** 价格分层：以矩阵内最低价为基准，≤5% 绿档、≤15% 橙档、其余红档 */
function tierOf(price: number, min: number): 'low' | 'mid' | 'high' {
  const ratio = price / min
  if (ratio <= 1.05) return 'low'
  if (ratio <= 1.15) return 'mid'
  return 'high'
}

function PriceMatrix({ matrix, picked, onPick }: PriceMatrixProps) {
  const locale = localeStore.locale
  const { origins, dates, cells } = matrix
  const flat = cells.flat()
  const min = Math.min(...flat)

  return (
    <View className='pmx'>
      <View className='pmx__head'>
        <Text className='pmx__title'>{t('mx.title')}</Text>
        <Text className='pmx__sub'>{t('mx.sub')}</Text>
      </View>

      {/* 表头：机场列 */}
      <View className='pmx__row pmx__row--header'>
        <View className='pmx__corner' />
        {origins.map(o => (
          <View key={o} className='pmx__col-head'>
            <Text className='font-code pmx__col-iata'>{o}</Text>
            <Text className='pmx__col-city'>{cityOf(o, locale)}</Text>
          </View>
        ))}
      </View>

      {/* 数据行：日期 × 机场 */}
      {dates.map((date, di) => (
        <View key={date} className='pmx__row'>
          <View className='pmx__row-head'>
            <Text className='font-code'>{date.slice(5)}</Text>
          </View>
          {origins.map((o, oi) => {
            const price = cells[di][oi]
            const isPicked = picked?.origin === o && picked?.date === date
            const isGlobalMin = price === min
            return (
              <View
                key={o}
                className={`pmx__cell is-${tierOf(price, min)} ${isPicked ? 'is-picked' : ''} ${isGlobalMin ? 'is-min' : ''}`}
                hoverClass='tap-dim'
                onClick={() => onPick(o, date)}
              >
                <Text className='pmx__price'>¥{price.toLocaleString()}</Text>
                {isGlobalMin && <Text className='pmx__min-mark'>▼</Text>}
              </View>
            )
          })}
        </View>
      ))}

      {/* 点选态提示条 */}
      {picked && (
        <View className='pmx__picked-bar'>
          <Text className='pmx__picked-text'>
            {t('mx.picked', { o: picked.origin, d: picked.date.slice(5) })}
          </Text>
          <View className='pmx__clear' hoverClass='tap-dim' onClick={() => onPick(picked.origin, picked.date)}>
            <Text>{t('mx.clear')}</Text>
          </View>
        </View>
      )}
    </View>
  )
}

export default observer(PriceMatrix)
