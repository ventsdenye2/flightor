// src/components/common/DemoBadge.tsx — 演示数据角标（Mock 模式全局提示）
import { View, Text } from '@tarojs/components'
import { observer } from 'mobx-react-lite'
import { USE_MOCK } from '../../utils/request'
import { hasSerpKey } from '../../services/flightService'
import { t } from '../../i18n'
import './DemoBadge.scss'

function DemoBadge() {
  // SerpApi 直连启用后报价已是真实数据，不再标演示
  if (!USE_MOCK || hasSerpKey()) return null
  return (
    <View className='demo-badge'>
      <Text>{t('common.demo')}</Text>
    </View>
  )
}

export default observer(DemoBadge)
