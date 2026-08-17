// pages/search — 搜索结果（双模式对比列表 + 航线地图）
import { useEffect, useMemo, useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro, { useShareAppMessage } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import FlightCompareCard from '../../components/flight/FlightCompareCard'
import RiskWarningModal from '../../components/flight/RiskWarningModal'
import RouteMapVisualization from '../../components/map/RouteMapVisualization'
import PriceMatrix from '../../components/matrix/PriceMatrix'
import { flightStore } from '../../stores/flightStore'
import { findAirport, airportCity, cityOf } from '../../mocks/airports'
import { getHubVisaNote } from '../../mocks/hubs'
import { t, fd, localeStore } from '../../i18n'
import { formatPrice } from '../../utils/format'
import type { FlightOption } from '../../types/flight'
import type { HubPoint, RiskItem } from '../../types/common'
import './index.scss'

const MODE_TABS = [
  { key: 'all' as const, label: 'sp.all' },
  { key: 'self' as const, label: 'sp.self' },
  { key: 'official' as const, label: 'sp.official' }
]

function buildRisks(flight: FlightOption): RiskItem[] {
  const locale = localeStore.locale
  const risks: RiskItem[] = [
    { icon: '⛓️', title: t('risk.i1.title'), description: t('risk.i1.desc'), severity: 'danger' },
    { icon: '🧳', title: t('risk.i2.title'), description: t('risk.i2.desc'), severity: 'warning' }
  ]
  if (flight.hub) {
    risks.push({
      icon: '🛂',
      title: t('risk.i3.title', { city: cityOf(flight.hub.iata, locale) }),
      description: getHubVisaNote(flight.hub.iata, locale),
      severity: flight.hub.visaStatus === 'required' ? 'danger' : 'info'
    })
    risks.push({
      icon: '⏱',
      title: t('risk.i4.title', { dur: fd(flight.hub.layoverMinutes) }),
      description: t('risk.i4.desc'),
      severity: 'info'
    })
  }
  return risks
}

function SearchPage() {
  const [showMap, setShowMap] = useState(false)
  const [expandedId, setExpandedId] = useState('')
  const [riskFlight, setRiskFlight] = useState<FlightOption | null>(null)
  const locale = localeStore.locale

  useEffect(() => {
    Taro.setNavigationBarTitle({ title: t('nav.search') })
  }, [locale])

  useShareAppMessage(() => {
    const p = flightStore.lastParams
    const best = flightStore.visibleOptions[0]
    const saving = best ? flightStore.savingsOf(best) : { amount: 0 }
    return {
      title: p
        ? t('share.route', { o: p.origin, d: p.destination, amt: formatPrice(saving.amount) })
        : t('share.app'),
      path: '/pages/index/index'
    }
  })

  const params = flightStore.lastParams
  const origin = params ? findAirport(params.origin) : undefined
  const destination = params ? findAirport(params.destination) : undefined

  const goDetail = (flight: FlightOption) => {
    flightStore.select(flight)
    Taro.navigateTo({ url: `/pages/route/index?id=${flight.id}` })
  }

  const handleSelect = (flight: FlightOption) => {
    // 中转模式选择决策树：自行中转必须先确认风险
    if (flight.transferType === 'self') {
      setRiskFlight(flight)
    } else {
      goDetail(flight)
    }
  }

  // 地图 Hub 点位（记忆化，避免展开卡片等无关渲染触发地图重绘）
  const hubPoints: HubPoint[] = useMemo(
    () =>
      (flightStore.result?.selfTransfer ?? [])
        .filter(f => f.hub)
        .map(f => {
          const airport = findAirport(f.hub!.iata)
          return {
            iata: f.hub!.iata,
            name: cityOf(f.hub!.iata, locale),
            latitude: airport?.lat ?? 0,
            longitude: airport?.lng ?? 0,
            savingsPercent: flightStore.savingsOf(f).percent,
            isRecommended: f.id === flightStore.result?.selfTransfer[0]?.id
          }
        }),
    [flightStore.result, locale]
  )

  return (
    <View className='search-page'>
      {/* 路线摘要栏 */}
      <View className='search-page__summary'>
        <View className='search-page__route'>
          <Text className='font-code search-page__route-text'>
            {params?.origin ?? '—'}
            {params && params.originCandidates.length > 1 ? `+${params.originCandidates.length - 1}` : ''}
            {' → '}
            {params?.destination ?? '—'}
            {params && params.destinationCandidates.length > 1 ? `+${params.destinationCandidates.length - 1}` : ''}
          </Text>
          <Text className='search-page__route-date'>
            {params
              ? params.departDateEnd && params.departDateEnd !== params.departDate
                ? `${params.departDate} ~ ${params.departDateEnd}`
                : params.departDate
              : ''}
          </Text>
        </View>
        <View className='search-page__map-toggle' hoverClass='tap-dim' onClick={() => setShowMap(!showMap)}>
          <Text>{showMap ? t('sp.list') : t('sp.map')}</Text>
        </View>
      </View>

      {/* 航线地图 */}
      {showMap && origin && destination && (
        <View className='search-page__map'>
          <RouteMapVisualization
            origin={{ iata: origin.iata, name: airportCity(origin, locale), latitude: origin.lat, longitude: origin.lng }}
            destination={{ iata: destination.iata, name: airportCity(destination, locale), latitude: destination.lat, longitude: destination.lng }}
            hubs={hubPoints}
            onHubClick={hub => {
              const f = flightStore.result?.selfTransfer.find(x => x.hub?.iata === hub.iata)
              if (f) handleSelect(f)
            }}
          />
        </View>
      )}

      {/* 模式 Tab */}
      <View className='search-page__tabs'>
        {MODE_TABS.map(tab => (
          <View
            key={tab.key}
            className={`search-page__tab ${flightStore.viewMode === tab.key ? 'is-active' : ''}`}
            hoverClass='tap-dim'
            onClick={() => flightStore.setViewMode(tab.key)}
          >
            <Text>{t(tab.label)}</Text>
          </View>
        ))}
      </View>

      {/* 排序切换 */}
      <View className='search-page__sorts'>
        {(['price', 'duration'] as const).map(sort => (
          <View
            key={sort}
            className={`search-page__sort ${flightStore.sortBy === sort ? 'is-active' : ''}`}
            hoverClass='tap-dim'
            onClick={() => flightStore.setSortBy(sort)}
          >
            <Text>{sort === 'price' ? t('sp.sortPrice') : t('sp.sortDuration')}</Text>
          </View>
        ))}
      </View>

      {/* 价差矩阵（多机场或多日期时展示） */}
      {flightStore.matrix &&
        (flightStore.matrix.origins.length > 1 || flightStore.matrix.dates.length > 1) && (
          <PriceMatrix
            matrix={flightStore.matrix}
            picked={flightStore.matrixPick}
            onPick={(o, d) => flightStore.pickMatrixCell(o, d)}
          />
        )}

      {/* 结果列表 */}
      {flightStore.isLoading ? (
        <View className='search-page__skeletons'>
          {[0, 1, 2].map(i => (
            <View key={i} className='search-page__skeleton'>
              <View className='search-page__sk-line search-page__sk-line--w40' />
              <View className='search-page__sk-row'>
                <View className='search-page__sk-block' />
                <View className='search-page__sk-line search-page__sk-line--grow' />
                <View className='search-page__sk-block' />
              </View>
              <View className='search-page__sk-line search-page__sk-line--w70' />
            </View>
          ))}
        </View>
      ) : flightStore.visibleOptions.length === 0 ? (
        <View className='search-page__empty'>
          <Text className='search-page__empty-icon'>🛫</Text>
          <Text>{t('sp.empty')}</Text>
          <Text className='search-page__empty-tip'>{t('sp.emptyTip')}</Text>
        </View>
      ) : (
        <View className='search-page__list'>
          {flightStore.visibleOptions.map((f, idx) => {
            const saving = flightStore.savingsOf(f)
            // 组合徽章：最优组合（仅价格排序）/ 邻近机场出发 / 错峰日期
            const badges: string[] = []
            if (idx === 0 && flightStore.sortBy === 'price' && flightStore.visibleOptions.length > 1) {
              badges.push(t('sp.best'))
            }
            const firstSeg = f.segments[0]
            const lastSeg = f.segments[f.segments.length - 1]
            if (params && firstSeg.origin !== params.origin) {
              badges.push(t('sp.altOrigin', { iata: firstSeg.origin }))
            }
            if (params && lastSeg.destination !== params.destination) {
              badges.push(t('sp.altDest', { iata: lastSeg.destination }))
            }
            if (params && firstSeg.departTime.slice(0, 10) !== params.departDate) {
              badges.push(t('sp.altDate', { date: firstSeg.departTime.slice(5, 10) }))
            }
            return (
              <FlightCompareCard
                key={f.id}
                flight={f}
                savingsAmount={saving.amount}
                savingsPercent={saving.percent}
                badges={badges}
                isExpanded={expandedId === f.id}
                onToggleExpand={() => setExpandedId(prev => (prev === f.id ? '' : f.id))}
                onSelect={handleSelect}
              />
            )
          })}
          <View className='search-page__disclaimer'>
            <Text>{t('common.priceRef')}</Text>
          </View>
        </View>
      )}

      {/* 风险确认弹窗 */}
      <RiskWarningModal
        visible={!!riskFlight}
        hub={riskFlight?.hub ? `${cityOf(riskFlight.hub.iata, locale)} ${riskFlight.hub.iata}` : ''}
        visaStatus={riskFlight?.hub?.visaStatus ?? 'free'}
        risks={riskFlight ? buildRisks(riskFlight) : []}
        onCancel={() => setRiskFlight(null)}
        onConfirm={() => {
          const f = riskFlight!
          setRiskFlight(null)
          goDetail(f)
        }}
      />
    </View>
  )
}

export default observer(SearchPage)
