// src/components/flight/FlightCompareCard.tsx — 航班对比卡（飞常准式布局 + 登机牌质感）
import { View, Text } from '@tarojs/components'
import { observer } from 'mobx-react-lite'
import type { FlightOption, FlightSegment } from '../../types/flight'
import { cityOf } from '../../mocks/airports'
import { countryName, countryOfAirport } from '../../mocks/countries'
import { getHubVisaNote } from '../../mocks/hubs'
import { t, fd, localeStore } from '../../i18n'
import { formatTime, formatPrice, crossDayMark, formatMonthDay } from '../../utils/format'
import './FlightCompareCard.scss'

interface FlightCompareCardProps {
  flight: FlightOption
  savingsAmount: number
  savingsPercent: number
  /** 已本地化的徽章（最优组合/邻近机场/错峰日期） */
  badges?: string[]
  /** 综合推荐中命中国家偏好的可解释原因 */
  recommendationReason?: string
  /** 往返价说明（如「往返总价 · 含回程 · 玩 7-14 天」），避免只画去程让用户误读价格 */
  roundtripNote?: string
  isExpanded?: boolean
  onToggleExpand?: () => void
  onSelect?: (flight: FlightOption) => void
}

/** 准点率（Mock：按航班号确定性生成 78%-97%，接入真实数据后替换） */
function punctualityOf(flightNo: string): number {
  let h = 0
  for (let i = 0; i < flightNo.length; i++) h = (h * 31 + flightNo.charCodeAt(i)) % 997
  return 78 + (h % 20)
}

/** 单个航段：飞常准式 大时间 + 进度线 + 机场码/城市 */
const SegmentRow = observer(({ seg }: { seg: FlightSegment }) => {
  const locale = localeStore.locale
  const punctuality = punctualityOf(seg.flightNo)

  return (
    <View className='fcc__segment'>
      {/* 航班号行 */}
      <View className='fcc__seg-head'>
        <View className='fcc__seg-flight'>
          <Text className='font-code fcc__flight-no'>{seg.flightNo}</Text>
          <Text className='fcc__airline'>{seg.airline}</Text>
          <Text className='fcc__seg-date'>{formatMonthDay(seg.departTime)}</Text>
        </View>
        <View className={`fcc__punctuality ${punctuality >= 90 ? 'is-good' : punctuality >= 84 ? 'is-mid' : 'is-low'}`}>
          <Text>{t('fcc.punctuality', { pct: punctuality })}</Text>
        </View>
      </View>

      {/* 大时间 + 飞行进度线 */}
      <View className='fcc__timeline'>
        <View className='fcc__endpoint'>
          <Text className='font-code fcc__time'>{formatTime(seg.departTime)}</Text>
          <Text className='fcc__city'>{cityOf(seg.origin, locale)}</Text>
        </View>

        <View className='fcc__track'>
          <Text className='fcc__duration'>{fd(seg.duration)}</Text>
          <View className='fcc__track-line'>
            <View className='fcc__track-dot' />
            <View className='fcc__track-dash' />
            <Text className='fcc__track-plane'>✈</Text>
            <View className='fcc__track-dash' />
            <View className='fcc__track-dot fcc__track-dot--end' />
          </View>
          {seg.aircraft && <Text className='fcc__aircraft'>{seg.aircraft}</Text>}
        </View>

        <View className='fcc__endpoint fcc__endpoint--right'>
          <Text className='font-code fcc__time'>
            {formatTime(seg.arriveTime)}
            <Text className='fcc__cross-day'>{crossDayMark(seg.departTime, seg.arriveTime)}</Text>
          </Text>
          <Text className='fcc__city'>{cityOf(seg.destination, locale)}</Text>
        </View>
      </View>
    </View>
  )
})

function FlightCompareCard(props: FlightCompareCardProps) {
  const { flight, savingsAmount, savingsPercent, badges, recommendationReason, roundtripNote, isExpanded, onToggleExpand, onSelect } = props
  const locale = localeStore.locale
  const hubCountry = flight.hub ? countryOfAirport(flight.hub.iata) : undefined
  const hubLabel = flight.hub
    ? `${cityOf(flight.hub.iata, locale)}${hubCountry ? ` · ${countryName(hubCountry, locale)}` : ''}`
    : ''

  return (
    <View className='fcc' hoverClass='tap-dim' onClick={() => onSelect?.(flight)}>
      {/* 组合徽章：最优组合/邻近机场/错峰日期 */}
      {badges && badges.length > 0 && (
        <View className='fcc__badges'>
          {badges.map(b => (
            <Text key={b} className='fcc__badge'>{b}</Text>
          ))}
        </View>
      )}
      {flight.segments.map((seg, i) => (
        <View key={seg.flightNo + i}>
          {/* 中转停留分隔条 */}
          {i > 0 && flight.hub && (
            <View className='fcc__layover'>
              <View className='fcc__layover-line' />
              <Text className='fcc__layover-text'>
                {t('fcc.layoverAt', { city: hubLabel, dur: fd(flight.hub.layoverMinutes) })}
              </Text>
              <View className='fcc__layover-line' />
            </View>
          )}
          <SegmentRow seg={seg} />
        </View>
      ))}

      {recommendationReason && (
        <View className='fcc__recommendation-reason'>
          <Text>{recommendationReason}</Text>
        </View>
      )}

      {/* 穿孔撕裂线 */}
      <View className='fcc__perforation'>
        <View className='fcc__hole fcc__hole--left' />
        <View className='fcc__dashed' />
        <View className='fcc__hole fcc__hole--right' />
      </View>

      {/* 价格行 */}
      <View className='fcc__price-row'>
        <View className='fcc__price-main'>
          <Text className='font-code fcc__price'>{formatPrice(flight.totalPrice)}</Text>
          <Text className='fcc__total-duration'>{t('fcc.total', { dur: fd(flight.totalDuration) })}</Text>
          {roundtripNote && <Text className='fcc__roundtrip'>{roundtripNote}</Text>}
        </View>
        {savingsAmount > 0 ? (
          <View className='fcc__savings'>
            <Text className='fcc__savings-amount'>{t('common.saveAmt', { amt: formatPrice(savingsAmount) })}</Text>
            <Text className='fcc__savings-badge'>{t('common.dropPct', { pct: savingsPercent })}</Text>
          </View>
        ) : (
          <Text
            className='fcc__detail-toggle'
            onClick={e => {
              e.stopPropagation()
              onToggleExpand?.()
            }}
          >
            {t('common.detail')} {isExpanded ? '▴' : '▾'}
          </Text>
        )}
      </View>

      {/* 底部：中转信息条 */}
      <View className='fcc__footer'>
        <View className='fcc__footer-left'>
          <Text className='fcc__transfer-type'>{t(`fcc.${flight.transferType}`)}</Text>
          {flight.hub && (
            <Text className='fcc__hub-info'>
              {' · '}
              {t('fcc.stayShort', { city: hubLabel, dur: fd(flight.hub.layoverMinutes) })}
            </Text>
          )}
        </View>
        {flight.transferType === 'self' && flight.hub?.baggageRecheck ? (
          <Text className='fcc__baggage-warn'>{t('fcc.baggage')}</Text>
        ) : (
          <View className='fcc__barcode' />
        )}
      </View>

      {/* 展开态：停留玩法提示 */}
      {isExpanded && flight.hub && (
        <View className='fcc__expand'>
          <Text className='fcc__expand-title'>{t('fcc.playTitle')}</Text>
          <Text className='fcc__expand-desc'>
            {t('fcc.playDesc', {
              city: cityOf(flight.hub.iata, locale),
              dur: fd(flight.hub.layoverMinutes),
              visa: getHubVisaNote(flight.hub.iata, locale)
            })}
          </Text>
        </View>
      )}
    </View>
  )
}

export default observer(FlightCompareCard)
