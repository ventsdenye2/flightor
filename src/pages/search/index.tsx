// pages/search — 搜索结果（双模式对比列表 + 航线地图）
import { useEffect, useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro, { useRouter, useShareAppMessage } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import DemoBadge from '../../components/common/DemoBadge'
import FlightCompareCard from '../../components/flight/FlightCompareCard'
import RiskWarningModal from '../../components/flight/RiskWarningModal'
import PriceMatrix from '../../components/matrix/PriceMatrix'
import { flightStore } from '../../stores/flightStore'
import { t, fd, localeStore } from '../../i18n'
import { formatPrice } from '../../utils/format'
import type { FlightOption } from '../../types/flight'
import type { RiskItem } from '../../types/common'
import './index.scss'

const MODE_TABS = [
  { key: 'all' as const, label: 'sp.all' },
  { key: 'self' as const, label: 'sp.self' },
  { key: 'official' as const, label: 'sp.official' }
]

function buildRisks(flight: FlightOption): RiskItem[] {
  const risks: RiskItem[] = [
    { icon: 'SELF', title: t('risk.i1.title'), description: t('risk.i1.desc'), severity: 'danger' },
    { icon: 'BAG', title: t('risk.i2.title'), description: t('risk.i2.desc'), severity: 'warning' }
  ]
  if (flight.hub) {
    risks.push({
      icon: 'TIME',
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
  const router = useRouter()
  const artifactId = typeof router.params.artifactId === 'string' ? router.params.artifactId : ''

  useEffect(() => {
    Taro.setNavigationBarTitle({ title: t('nav.search') })
  }, [locale])

  useEffect(() => {
    if (artifactId && flightStore.result?.metadata.artifactRef?.id !== artifactId) {
      void flightStore.loadArtifact(artifactId)
    }
  }, [artifactId])

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
  const goDetail = (flight: FlightOption) => {
    flightStore.select(flight)
    const sourceId = flightStore.result?.metadata.artifactRef?.id
    if (sourceId) Taro.navigateTo({ url: `/pages/route/index?artifactId=${encodeURIComponent(sourceId)}&offerId=${encodeURIComponent(flight.id)}` })
    else setExpandedId(flight.id)
  }

  const handleSelect = (flight: FlightOption) => {
    // 中转模式选择决策树：自行中转必须先确认风险
    if (flight.transferType === 'self') {
      setRiskFlight(flight)
    } else {
      goDetail(flight)
    }
  }

  return (
    <View className='search-page'>
      <DemoBadge />
      {/* 路线摘要栏 */}
      <View className='search-page__summary'>
        <View className='search-page__route'>
          <Text className='search-page__route-text'>
            {params ? params.origin : '—'} {' → '} {params ? params.destination : '—'}
          </Text>
          <Text className='search-page__route-date'>
            {params ? `${params.departDate}${params.returnDate ? ` → ${params.returnDate}` : ''}` : ''}
          </Text>
        </View>
        <View className='search-page__map-toggle' hoverClass='tap-dim' onClick={() => setShowMap(!showMap)}>
          <Text>{showMap ? t('sp.list') : t('sp.map')}</Text>
        </View>
      </View>

      {/* 航线地图 */}
      {showMap && params && (
        <View className='search-page__map search-page__map--unavailable'>
          <Text>{locale === 'zh' ? '当前航班 Artifact 未包含已核验机场坐标，地图不会使用本地模拟坐标。' : 'This flight Artifact has no verified airport coordinates, so the map will not use local mock coordinates.'}</Text>
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
        {(['recommended', 'price', 'duration'] as const).map(sort => (
          <View
            key={sort}
            className={`search-page__sort ${flightStore.sortBy === sort ? 'is-active' : ''}`}
            hoverClass='tap-dim'
            onClick={() => flightStore.setSortBy(sort)}
          >
            <Text>{sort === 'recommended' ? t('sp.sortRecommended') : sort === 'price' ? t('sp.sortPrice') : t('sp.sortDuration')}</Text>
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
          <Text className='search-page__loading-msg'>
            {t('search.searching')}
          </Text>
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
      ) : flightStore.error ? (
        <View className='search-page__error'>
          <Text>{locale === 'zh' ? '航班搜索暂时不可用。' : 'Flight search is temporarily unavailable.'}</Text>
          <Text className='search-page__error-detail'>{flightStore.error}</Text>
          <View className='search-page__retry' hoverClass='tap-dim' onClick={() => void flightStore.retryLastSearch()}>
            <Text>{locale === 'zh' ? '重试' : 'Retry'}</Text>
          </View>
        </View>
      ) : flightStore.visibleOptions.length === 0 ? (
        <View className='search-page__empty'>
          <Text className='search-page__empty-icon'>🛫</Text>
          <Text>{t('sp.empty')}</Text>
          {flightStore.filteredOutCount > 0 ? (
            <>
              <Text className='search-page__empty-tip'>
                {t('sp.filtered', { n: flightStore.filteredOutCount })}
              </Text>
              <View className='search-page__relax' hoverClass='tap-dim' onClick={() => flightStore.relaxFilters()}>
                <Text>{t('sp.relax')}</Text>
              </View>
            </>
          ) : (
            <Text className='search-page__empty-tip'>{t('sp.emptyTip')}</Text>
          )}
        </View>
      ) : (
        <View className='search-page__list'>
          {flightStore.visibleOptions.map((f, idx) => {
            const saving = flightStore.savingsOf(f)
            // 组合徽章：只保留结果排序徽章；请求本身没有候选机场或弹性日期。
            const badges: string[] = []
            if (idx === 0 && flightStore.visibleOptions.length > 1 && (flightStore.sortBy !== 'duration' || f.totalDuration !== undefined)) {
              badges.push(flightStore.sortBy === 'recommended' ? t('sp.recommended') : flightStore.sortBy === 'price' ? t('sp.best') : t('sp.fastest'))
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
        hub={riskFlight?.hub ? `${riskFlight.hub.city || riskFlight.hub.iata} ${riskFlight.hub.iata}` : ''}
        visaStatus={riskFlight?.hub?.visaStatus}
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
