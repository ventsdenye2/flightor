import { Button, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { makeAutoObservable } from 'mobx'
import { observer } from 'mobx-react-lite'
import { localeStore } from '../../i18n'
import { Icon } from '../../features/ui-experience/VisualMedia'
import './ProductionTabBar.scss'

export type ProductionSection = 'plan' | 'explore' | 'trips' | 'profile'
const tabs = [
  { id: 'plan', icon: 'home', zh: '规划', en: 'Plan' },
  { id: 'explore', icon: 'compass', zh: '探索', en: 'Explore' },
  { id: 'trips', icon: 'calendar', zh: '行程', en: 'Trips' },
  { id: 'profile', icon: 'user', zh: '我的', en: 'Me' }
] as const
const navigation = makeAutoObservable({
  selected: 'plan' as ProductionSection,
  select(section: ProductionSection) { this.selected = section }
})

/** Each native tab confirms selection when shown, including programmatic navigation. */
export function useProductionTab(section: ProductionSection) {
  useDidShow(() => { navigation.select(section) })
}

export const ProductionTabBar = observer(function ProductionTabBar({ selected, embedded = false }: {
  selected?: ProductionSection
  embedded?: boolean
}) {
  const active = selected ?? navigation.selected
  return <View className={`production-nav${embedded ? ' production-nav--embedded' : ''}`} ariaLabel='主导航'>
    {tabs.map(tab => <Button key={tab.id} className={`production-nav__item${active === tab.id ? ' is-active' : ''}`}
      aria-pressed={active === tab.id} onClick={() => {
        if (tab.id !== active) void Taro.switchTab({ url: `/pages/${tab.id}/index` }).catch(() => Taro.showToast({ title: '页面暂时未能打开，请重试', icon: 'none' }))
      }}><Icon name={tab.icon} /><Text>{localeStore.locale === 'en' ? tab.en : tab.zh}</Text></Button>)}
  </View>
})

export default ProductionTabBar
