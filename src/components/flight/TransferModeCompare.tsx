// src/components/flight/TransferModeCompare.tsx — 自行中转 vs 航司联程 9维度对比
import { useState } from 'react'
import { View, Text } from '@tarojs/components'
import { observer } from 'mobx-react-lite'
import type { TransferOption } from '../../types/flight'
import { t, fd } from '../../i18n'
import { formatPrice } from '../../utils/format'
import './TransferModeCompare.scss'

interface TransferModeCompareProps {
  selfTransfer: TransferOption
  airlineTransfer: TransferOption
  onSelect: (mode: 'self' | 'airline') => void
}

interface DimensionRow {
  label: string
  self: string
  airline: string
  /** 优胜方：'self' | 'airline' | '' */
  winner: 'self' | 'airline' | ''
}

const RISK_KEY = { low: 'tmc.low', medium: 'tmc.mid', high: 'tmc.high' } as const

function buildDimensions(s: TransferOption, a: TransferOption): DimensionRow[] {
  return [
    {
      label: t('tmc.price'),
      self: formatPrice(s.price),
      airline: formatPrice(a.price),
      winner: s.price < a.price ? 'self' : 'airline'
    },
    {
      label: t('tmc.baggage'),
      self: s.baggagePolicy,
      airline: a.baggagePolicy,
      winner: 'airline'
    },
    {
      label: t('tmc.missRisk'),
      self: t(RISK_KEY[s.missedConnectionRisk]),
      airline: t(RISK_KEY[a.missedConnectionRisk]),
      winner: 'airline'
    },
    {
      label: t('tmc.visa'),
      self: s.visaRequired ? `${t('tmc.needVisa')} · ${s.visaDetail ?? ''}` : t('tmc.noVisaSelf'),
      airline: a.visaRequired ? `${t('tmc.needVisa')} · ${a.visaDetail ?? ''}` : t('tmc.noVisa'),
      winner: s.visaRequired === a.visaRequired ? '' : s.visaRequired ? 'airline' : 'self'
    },
    {
      label: t('tmc.play'),
      self: s.stopoverPlayable ? t('tmc.playYes') : t('tmc.no'),
      airline: a.stopoverPlayable ? t('tmc.yes') : t('tmc.playNo'),
      winner: s.stopoverPlayable && !a.stopoverPlayable ? 'self' : ''
    },
    {
      label: t('tmc.mct'),
      self: fd(s.minConnectionTime),
      airline: fd(a.minConnectionTime),
      winner: ''
    },
    {
      label: t('tmc.duration'),
      self: fd(s.totalDuration),
      airline: fd(a.totalDuration),
      winner: s.totalDuration <= a.totalDuration ? 'self' : 'airline'
    },
    {
      label: t('tmc.protection'),
      self: s.protectionLevel,
      airline: a.protectionLevel,
      winner: 'airline'
    },
    {
      label: t('tmc.flex'),
      self: s.flexibility,
      airline: a.flexibility,
      winner: 'self'
    }
  ]
}

function TransferModeCompare({ selfTransfer, airlineTransfer, onSelect }: TransferModeCompareProps) {
  const [mode, setMode] = useState<'self' | 'airline'>('self')
  const dims = buildDimensions(selfTransfer, airlineTransfer)

  return (
    <View className='tmc'>
      {/* 顶部 Tab */}
      <View className='tmc__tabs'>
        <View
          className={`tmc__tab ${mode === 'self' ? 'is-active' : ''}`}
          hoverClass='tap-dim'
          onClick={() => setMode('self')}
        >
          <Text className='tmc__tab-title'>{t('tmc.self')}</Text>
          <Text className='tmc__tab-price'>{formatPrice(selfTransfer.price)}</Text>
        </View>
        <View
          className={`tmc__tab ${mode === 'airline' ? 'is-active' : ''}`}
          hoverClass='tap-dim'
          onClick={() => setMode('airline')}
        >
          <Text className='tmc__tab-title'>{t('tmc.airline')}</Text>
          <Text className='tmc__tab-price'>{formatPrice(airlineTransfer.price)}</Text>
        </View>
      </View>

      {/* 9 维度列表 */}
      <View className='tmc__dims'>
        {dims.map(d => {
          const value = mode === 'self' ? d.self : d.airline
          const other = mode === 'self' ? d.airline : d.self
          const isWinner = d.winner === mode
          return (
            <View key={d.label} className='tmc__dim'>
              <Text className='tmc__dim-label'>{d.label}</Text>
              <View className='tmc__dim-values'>
                <Text className={`tmc__dim-value ${isWinner ? 'is-winner' : ''}`}>
                  {value}{isWinner ? t('tmc.winner') : ''}
                </Text>
                <Text className='tmc__dim-other'>{t('tmc.vs', { v: other })}</Text>
              </View>
            </View>
          )
        })}
      </View>

      {/* 底部 CTA */}
      <View className='tmc__cta' hoverClass='tap-dim' onClick={() => onSelect(mode)}>
        <Text>
          {mode === 'self'
            ? t('tmc.pickSelf', { p: formatPrice(selfTransfer.price) })
            : t('tmc.pickAirline', { p: formatPrice(airlineTransfer.price) })}
        </Text>
      </View>
    </View>
  )
}

export default observer(TransferModeCompare)
