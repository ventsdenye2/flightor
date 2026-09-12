import { View, Text, Button, Image } from '@tarojs/components'
import { Icon } from './VisualMedia'

export function FlightTicket({ expanded = false, complex = false, onExpand }: {
  expanded?: boolean; complex?: boolean; onExpand?: () => void
}) {
  return <View className='ux-ticket'>
    <View className='ux-section-head'><Text className='ux-section-title'>去程航班</Text>
      {onExpand ? <Button className='ux-text-button' onClick={onExpand}>查看航班<Icon name='chevron-right' /></Button> : <Text className='ux-muted'>10 月 12 日</Text>}
    </View>
    <View className='ux-flight-times'>
      <View><Text className='ux-code'>PVG</Text><Text className='ux-time'>01:50</Text><Text className='ux-muted'>上海浦东</Text></View>
      <View className='ux-flight-line'><Icon name='plane' /><View className='ux-airline-line' /><Text>{complex ? '2 次转机' : '多哈转机'}</Text><Text>{complex ? '含自行中转' : '2h 20m'}</Text></View>
      <View className='ux-align-right'><Text className='ux-code'>LIS</Text><Text className='ux-time'>{complex ? '17:40' : '14:00'}</Text><Text className='ux-muted'>里斯本</Text></View>
    </View>
    <View className='ux-airline'><View className='ux-airline-logo'>QR</View><Text>{complex ? '卡塔尔航空 + 葡萄牙航空 · 示例' : '卡塔尔航空 · 示例航班'}</Text></View>
    {expanded ? <View className='ux-flight-expanded'>
      <Text className='ux-section-title'>航段与中转</Text>
      <View className='ux-leg'><Text>01:50　上海浦东 PVG</Text><Text className='ux-muted'>飞行 9h 05m · 示例</Text><Text>05:55　多哈 DOH</Text></View>
      <View className='ux-transfer'><Icon name='info' /><Text>多哈停留 2h 20m · 中转条件待核验</Text></View>
      <View className='ux-leg'><Text>08:15　多哈 DOH</Text><Text className='ux-muted'>{complex ? '飞行 7h 00m · 示例' : '飞行 7h 45m · 示例'}</Text><Text>{complex ? '14:15　马德里 MAD' : '14:00　里斯本 LIS'}</Text></View>
      {complex ? <><View className='ux-transfer'><Icon name='info' /><Text>马德里停留 2h 55m · 自行中转</Text></View><View className='ux-leg'><Text>17:10　马德里 MAD</Text><Text className='ux-muted'>飞行 1h 30m · 葡萄牙航空 · 示例</Text><Text>17:40　里斯本 LIS</Text></View><View className='ux-warning'>分开出票，行李需提取并重新托运。入境资格、航站楼与中转时间待核验。</View></> : null}
      <Text className='ux-caption'>以上均为当地时间。票价、班次与中转条件是设计样例，不能用于购票。</Text>
    </View> : null}
  </View>
}
export function FlightRoute({ complex = false }: { complex?: boolean }) {
  return <View><Image className='ux-flight-map' src='/assets/ui-experience/flight-route.svg' mode='aspectFit' ariaLabel='航线示意：上海经多哈前往里斯本，非实际飞行轨迹' />{complex ? <Text className='ux-caption'>多哈 → 马德里 → 里斯本（含自行中转）</Text> : null}</View>
}
