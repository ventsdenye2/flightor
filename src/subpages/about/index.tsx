// subpages/about — 关于 & 免责声明（分包，双语）
import { useEffect } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { t, localeStore } from '../../i18n'
import './index.scss'

const SECTIONS_ZH = [
  {
    title: '产品定位',
    content:
      '本小程序是一款国际航线信息聚合与路线规划工具，帮助用户发现「分段购票 + 中转停留」的航线组合方案，把中转等待变为中转体验。本产品不销售机票、不参与任何交易。'
  },
  {
    title: '价格声明',
    content:
      '所有价格数据来源于第三方公开接口（Travelpayouts 等），存在缓存延迟，仅供参考，实际价格以航司官网或购票平台为准。'
  },
  {
    title: '自行中转风险',
    content:
      '自行中转方案由多张独立客票组成：前段航班延误或取消导致后续航段误机时，后续航段承运人无免费改签或退票义务；行李需在中转站自取并重新托运；出入境需符合中转国签证政策。上述风险由用户自行评估并承担。'
  },
  {
    title: '签证信息',
    content:
      '页面展示的过境免签/落地签信息为编写时的公开政策摘要，各国政策随时可能调整，请务必以使领馆及移民局最新公告为准。'
  },
  {
    title: '数据与隐私',
    content:
      '搜索历史、收藏与提醒仅存储于你的设备本地缓存及必要的云端订阅记录，不会用于任何商业用途。'
  }
]

const SECTIONS_EN = [
  {
    title: 'What is this',
    content:
      'This mini program aggregates international route information and helps travelers discover split-ticket itineraries with rewarding layovers. We do not sell tickets or take part in any transaction.'
  },
  {
    title: 'Pricing',
    content:
      'All prices come from third-party public APIs (e.g. Travelpayouts) and may be cached. They are for reference only; the airline or booking platform price prevails.'
  },
  {
    title: 'Self-transfer Risks',
    content:
      'Self-transfer itineraries consist of separate tickets. If a delay or cancellation causes a missed connection, the onward carrier owes no free rebooking or refund. Bags must be collected and rechecked, and transit visa rules apply. Travelers assess and bear these risks.'
  },
  {
    title: 'Visa Information',
    content:
      'Transit visa summaries reflect public policies at the time of writing and may change at any time. Always verify with embassies and immigration authorities.'
  },
  {
    title: 'Data & Privacy',
    content:
      'Search history, saved routes and alerts are stored locally on your device plus minimal cloud subscription records, and are never used commercially.'
  }
]

function AboutPage() {
  const locale = localeStore.locale
  const sections = locale === 'zh' ? SECTIONS_ZH : SECTIONS_EN

  useEffect(() => {
    Taro.setNavigationBarTitle({ title: t('nav.about') })
  }, [locale])

  return (
    <View className='about-page'>
      <View className='about-page__logo'>
        <Text className='about-page__version'>v1.0.0</Text>
      </View>

      {sections.map(s => (
        <View key={s.title} className='about-page__section'>
          <Text className='about-page__section-title'>{s.title}</Text>
          <Text className='about-page__section-content'>{s.content}</Text>
        </View>
      ))}

      <View className='about-page__footer'>
        <Text>© 2026</Text>
      </View>
    </View>
  )
}

export default observer(AboutPage)
