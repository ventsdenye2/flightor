import { useEffect, useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import Taro, { useRouter, useShareAppMessage } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import RiskWarningModal from '../../components/flight/RiskWarningModal'
import { EmptyState, PageHeader } from '../../features/ui-experience/SharedUI'
import { ProductionFlightCard } from '../../features/ui-experience/ProductionFlightCard'
import { Icon } from '../../features/ui-experience/VisualMedia'
import { flightStore } from '../../stores/flightStore'
import { searchStore } from '../../stores/searchStore'
import { t, fd, localeStore } from '../../i18n'
import type { FlightOption } from '../../types/flight'
import type { RiskItem } from '../../types/common'
import '../../features/ui-experience/experience.scss'
import './index.scss'

const MODES = [{ key: 'all' as const, label: 'sp.all' }, { key: 'self' as const, label: 'sp.self' }, { key: 'official' as const, label: 'sp.official' }]

function buildRisks(flight: FlightOption): RiskItem[] {
  const risks: RiskItem[] = [
    { icon: 'SELF', title: t('risk.i1.title'), description: t('risk.i1.desc'), severity: 'danger' },
    { icon: 'BAG', title: t('risk.i2.title'), description: t('risk.i2.desc'), severity: 'warning' }
  ]
  if (flight.hub) risks.push({ icon: 'TIME', title: t('risk.i4.title', { dur: fd(flight.hub.layoverMinutes) }), description: t('risk.i4.desc'), severity: 'info' })
  return risks
}

function SearchPage() {
  const [expandedId, setExpandedId] = useState('')
  const [riskFlight, setRiskFlight] = useState<FlightOption | null>(null)
  const locale = localeStore.locale
  const copy = (zh: string, en: string) => locale === 'en' ? en : zh
  const router = useRouter()
  const artifactId = typeof router.params.artifactId === 'string' ? router.params.artifactId : ''
  useEffect(() => { Taro.setNavigationBarTitle({ title: t('nav.search') }) }, [locale])
  useEffect(() => {
    if (artifactId && flightStore.result?.metadata.artifactRef?.id !== artifactId) void flightStore.loadArtifact(artifactId)
  }, [artifactId])
  useShareAppMessage(() => ({ title: t('share.app'), path: '/pages/index/index' }))
  const params = flightStore.lastParams
  const options = flightStore.visibleOptions
  const editSearch = () => {
    if (params) {
      searchStore.setOrigin(params.origin)
      searchStore.setDestination(params.destination)
      searchStore.setDepartDate(params.departDate)
      searchStore.setTripType(params.tripType)
      if (params.returnDate) searchStore.setReturnDate(params.returnDate)
      searchStore.setBudget(...params.budgetRange)
      searchStore.setTransferPref(params.transferPref)
      for (const interest of [...searchStore.interests]) searchStore.toggleInterest(interest)
      for (const interest of params.interests) searchStore.toggleInterest(interest)
      for (const code of [...searchStore.transitCountryPreferences.preferred, ...searchStore.transitCountryPreferences.excluded]) searchStore.setTransitCountryPreference(code, 'neutral')
      for (const code of params.transitCountryPreferences?.preferred ?? []) searchStore.setTransitCountryPreference(code, 'preferred')
      for (const code of params.transitCountryPreferences?.excluded ?? []) searchStore.setTransitCountryPreference(code, 'excluded')
    }
    void Taro.navigateTo({ url: '/pages/index/index' })
  }
  const goBack = () => { void Taro.navigateBack().catch(() => Taro.switchTab({ url: '/pages/plan/index' })) }
  const goDetail = (flight: FlightOption) => {
    flightStore.select(flight)
    const sourceId = flightStore.result?.metadata.artifactRef?.id
    if (sourceId) void Taro.navigateTo({ url: '/pages/route/index?artifactId=' + encodeURIComponent(sourceId) + '&offerId=' + encodeURIComponent(flight.id) })
    else setExpandedId(flight.id)
  }
  const select = (flight: FlightOption) => { if (flight.transferType === 'self') setRiskFlight(flight); else goDetail(flight) }
  const retry = () => { if (artifactId) void flightStore.loadArtifact(artifactId); else void flightStore.retryLastSearch() }
  return <View className='ux-app pf-app production-detail-page'>
    <PageHeader title={copy('比较航班', 'Compare flights')} onBack={goBack} action={<Button className='ux-text-button' onClick={editSearch}>{copy('修改条件', 'Edit search')}</Button>} />
    <View className='ux-scroll pf-page pf-results-page'>
      <View className='pf-results-intro'><Text className='pf-title'>{params ? params.origin + ' → ' + params.destination : copy('出发，有几种可能', 'Find your way there')}</Text><Text className='pf-subtitle'>{params ? params.departDate + (params.returnDate ? ' → ' + params.returnDate : '') + ' · ' + (params.tripType === 'roundtrip' ? t('search.roundtrip') : t('search.oneway')) : copy('查看已保存的航班搜索结果。', 'Review saved flight search results.')}</Text></View>
      {flightStore.isLoading ? <View className='pf-loading' role='status'><View className='pf-loading-line' /><Text className='pf-state-title'>{copy('正在查找合适的航班', 'Finding flight options')}</Text><Text className='pf-subtitle'>{copy('把报价、时间和中转放在一起。', 'Comparing fares, times and connections.')}</Text></View> : flightStore.error ? <>
        <EmptyState title={copy('航班结果暂时无法加载', 'Flight results are unavailable')} description={flightStore.error} icon='plane' actionLabel={copy('重试', 'Retry')} onAction={retry} />
        <Button className='ux-text-button pf-edit-empty' onClick={editSearch}>{copy('返回修改搜索条件', 'Edit search conditions')}</Button>
      </> : !flightStore.result ? <EmptyState title={copy('输入航线，开始比较', 'Choose a route to get started')} description={copy('输入机场和日期，开始一次航班搜索。', 'Choose airports and dates to search for flights.')} icon='plane' actionLabel={copy('搜索航班', 'Search flights')} onAction={editSearch} /> : <>
        <View className='pf-mode-tabs'>{MODES.map(mode => <Button key={mode.key} className={'pf-mode-tab' + (flightStore.viewMode === mode.key ? ' is-active' : '')} onClick={() => flightStore.setViewMode(mode.key)}>{t(mode.label)}</Button>)}</View>
        <View className='pf-results-toolbar'><View className='pf-result-sorts'>{(['recommended', 'price', 'duration'] as const).map(sort => <Button key={sort} className={'pf-result-sort' + (flightStore.sortBy === sort ? ' is-active' : '')} onClick={() => flightStore.setSortBy(sort)}>{sort === 'recommended' ? t('sp.sortRecommended') : sort === 'price' ? t('sp.sortPrice') : t('sp.sortDuration')}</Button>)}</View><Text className='pf-caption'>{options.length} {copy('个方案', 'options')}</Text></View>
        {options.length === 0 ? <EmptyState title={copy('暂时没有匹配的航班', 'No matching flights')} description={flightStore.filteredOutCount > 0 ? t('sp.filtered', { n: flightStore.filteredOutCount }) : t('sp.emptyTip')} icon='plane' actionLabel={flightStore.filteredOutCount > 0 ? t('sp.relax') : copy('调整条件', 'Edit search')} onAction={flightStore.filteredOutCount > 0 ? () => flightStore.relaxFilters() : editSearch} />
          : <View className='pf-results-list'>{options.map((flight, index) => {
            const badge = index === 0 && options.length > 1 && (flightStore.sortBy !== 'duration' || flight.totalDuration !== undefined)
              ? flightStore.sortBy === 'recommended' ? t('sp.recommended') : flightStore.sortBy === 'price' ? t('sp.best') : t('sp.fastest') : undefined
            return <ProductionFlightCard key={flight.id} flight={flight} locale={locale} badge={badge} expanded={expandedId === flight.id} roundtrip={params?.tripType === 'roundtrip'} savings={flightStore.savingsOf(flight).amount}
              onExpand={() => setExpandedId(expandedId === flight.id ? '' : flight.id)} onSelect={select} />
          })}</View>}
        <View className='pf-result-note'><Icon name='info' /><Text>{flightStore.result.metadata.priceDisclaimer || t('common.priceRef')}</Text></View>
      </>}
    </View>
    <RiskWarningModal visible={!!riskFlight} hub={riskFlight?.hub ? (riskFlight.hub.city || riskFlight.hub.iata) + ' ' + riskFlight.hub.iata : ''} visaStatus={riskFlight?.hub?.visaStatus} risks={riskFlight ? buildRisks(riskFlight) : []}
      onCancel={() => setRiskFlight(null)} onConfirm={() => { if (!riskFlight) return; const flight = riskFlight; setRiskFlight(null); goDetail(flight) }} />
  </View>
}

export default observer(SearchPage)
