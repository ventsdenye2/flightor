import { useEffect } from 'react'
import { Button, Text, View } from '@tarojs/components'
import Taro, { useShareAppMessage, useShareTimeline } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { ProductionFlightForm } from '../../features/ui-experience/ProductionFlightForm'
import { PageHeader } from '../../features/ui-experience/SharedUI'
import { Icon } from '../../features/ui-experience/VisualMedia'
import { flightStore } from '../../stores/flightStore'
import { userStore } from '../../stores/userStore'
import { t, localeStore } from '../../i18n'
import type { SearchParams } from '../../types/flight'
import { humanDate } from '../../utils/format'
import '../../features/ui-experience/experience.scss'
import './index.scss'

function IndexPage() {
  const locale = localeStore.locale
  const copy = (zh: string, en: string) => locale === 'en' ? en : zh
  useEffect(() => { Taro.setNavigationBarTitle({ title: t('nav.index') }) }, [locale])
  useShareAppMessage(() => ({ title: t('share.app'), path: '/pages/index/index' }))
  useShareTimeline(() => ({ title: t('share.timeline'), query: 'from=timeline' }))
  const handleSearch = (params: SearchParams) => {
    if (flightStore.isLoading) return
    userStore.addHistory(params)
    void flightStore.search(params)
    void Taro.navigateTo({ url: '/pages/search/index' })
  }
  const goBack = () => { void Taro.navigateBack().catch(() => Taro.switchTab({ url: '/pages/plan/index' })) }
  return <View className='ux-app pf-app production-detail-page'>
    <PageHeader title={copy('找一张合适的机票', 'Find a flight')} onBack={goBack} />
    <View className='ux-scroll pf-page'>
      <View className='pf-intro'><Text className='pf-title'>{copy('让出发，刚刚好。', 'Find your way there.')}</Text><Text className='pf-subtitle'>{copy('在价格、时间与中转之间，找到你的平衡。', 'Find your balance of price, time and connections.')}</Text></View>
      <ProductionFlightForm onSearch={handleSearch} busy={flightStore.isLoading} />
      {userStore.history.length > 0 && <View className='pf-history'>
        <Text className='pf-section-label'>{t('index.recent')}</Text>
        {userStore.history.slice(0, 5).map((history, index) => <Button key={history.params.origin + '-' + history.params.destination + '-' + history.params.departDate + '-' + index} className='pf-history-row' disabled={flightStore.isLoading} onClick={() => handleSearch(history.params)}>
          <View className='pf-history-icon'><Icon name='plane' /></View><View><Text>{history.params.origin} → {history.params.destination}</Text><Text className='pf-caption'>{humanDate(history.params.departDate, locale)}{history.params.returnDate ? ' · ' + copy('返程', 'Return') + ' ' + humanDate(history.params.returnDate, locale) : ''}</Text></View><Icon name='chevron-right' />
        </Button>)}
      </View>}
      <View className='pf-intent-note'><Icon name='info' /><Text>{copy('航班时刻与价格以搜索结果为准。选好方案后，可以继续查看航段和确认报价。', 'Times and fares follow the search results. Open an option to review its segments and confirm the quote.')}</Text></View>
    </View>
  </View>
}

export default observer(IndexPage)
