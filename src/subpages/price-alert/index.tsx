// subpages/price-alert — 价格提醒设置（分包）
import { useEffect, useState } from 'react'
import { Button, View, Text, Slider } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import AirportSelector from '../../components/search/AirportSelector'
import LoginSheet from '../../components/common/LoginSheet'
import { userStore } from '../../stores/userStore'
import { t, localeStore } from '../../i18n'
import { formatPrice } from '../../utils/format'
import { Icon } from '../../features/ui-experience/VisualMedia'
import { PageHeader, SectionHeading } from '../../features/ui-experience/SharedUI'
import '../../features/ui-experience/experience.scss'
import './index.scss'

const airportCode = (value?: string) => value && /^[A-Z]{3}$/.test(value.toUpperCase()) ? value.toUpperCase() : ''

function PriceAlertPage() {
  const router = useRouter()
  const [origin, setOrigin] = useState(airportCode(router.params?.origin))
  const [destination, setDestination] = useState(airportCode(router.params?.destination))
  const suppliedPrice = Number(router.params?.current)
  const currentPrice = Number.isFinite(suppliedPrice) && suppliedPrice > 0 ? suppliedPrice : null
  const [targetPrice, setTargetPrice] = useState(currentPrice ? Math.max(500, Math.round(currentPrice * 0.85 / 100) * 100) : 3000)
  const [selectorFor, setSelectorFor] = useState<'origin' | 'destination' | ''>('')
  const [showLogin, setShowLogin] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const locale = localeStore.locale
  const en = locale === 'en'
  const back = () => { void Taro.navigateBack().catch(() => Taro.switchTab({ url: '/pages/profile/index' })) }

  useEffect(() => {
    Taro.setNavigationBarTitle({ title: t('nav.priceAlert') })
  }, [locale])

  const handleSaveTarget = async () => {
    if (saving) return
    if (!origin || !destination || origin === destination) {
      setError(en ? 'Choose two different airports.' : '请选择不同的出发与到达机场。')
      return
    }
    setError('')
    // Keep the existing account gate before saving a target on this device.
    if (!userStore.isLoggedIn) {
      setShowLogin(true)
      return
    }
    // The current store persists targets on this device; notifications are not configured.
    setSaving(true)
    userStore.addAlert({ origin, destination, targetPrice })
    Taro.showToast({ title: en ? 'Saved on this device' : '目标价已保存到本机', icon: 'success' })
    setTimeout(back, 1200)
  }

  return (
    <View className='ux-app price-alert-production'>
      <PageHeader title={en ? 'Price alerts' : '价格提醒'} onBack={back} />
      <View className='ux-scroll ui-page'>
      <Text className='ui-display'>{en ? 'Keep a price in mind.' : '给心动的价格，留个位置。'}</Text>
      <Text className='ux-muted'>{en ? 'Set a target for a route you want to follow.' : '设置目标价，整理你正在关注的航线。'}</Text>
      <View className='ui-inline-notice'>{en ? 'Targets are saved on this device. Automatic price checks and notifications are not active yet.' : '目标价保存在当前设备。暂未开启自动查价与消息推送。'}</View>

      <View className='price-alert__form'>
        <Button className='price-alert__field' disabled={saving} onClick={() => setSelectorFor('origin')}>
          <Text className='price-alert__label'>{t('search.depart')}</Text>
          <Text className='price-alert__value'>{origin || (en ? 'Select airport' : '选择机场')}</Text><Icon name='chevron-right' />
        </Button>

        <Button className='price-alert__field' disabled={saving} onClick={() => setSelectorFor('destination')}>
          <Text className='price-alert__label'>{t('search.arrive')}</Text>
          <Text className='price-alert__value'>{destination || (en ? 'Select airport' : '选择机场')}</Text><Icon name='chevron-right' />
        </Button>

        <View className='price-alert__field price-alert__field--column'>
          <View className='price-alert__target-row'>
            <Text className='price-alert__label'>{en ? 'Target price · CNY' : '目标价 · 人民币'}</Text>
            <Text className='price-alert__target'>{formatPrice(targetPrice)}</Text>
          </View>
          <Slider
            min={500}
            max={Math.max(20000, currentPrice ?? 0)}
            step={100}
            value={targetPrice}
            disabled={saving}
            activeColor='#087f8c'
            backgroundColor='#dce8e9'
            blockSize={20}
            blockColor='#087f8c'
            onChanging={e => setTargetPrice(e.detail.value)}
            onChange={e => setTargetPrice(e.detail.value)}
          />
          <Text className='price-alert__hint'>{currentPrice ? (en ? `Search reference price: ${formatPrice(currentPrice)}` : `搜索结果参考价：${formatPrice(currentPrice)}`) : (en ? 'Choose the price that works for you. This is your target, not a live quote.' : '拖动设置你期望的价格；目标价不代表实时票价。')}</Text>
        </View>
      </View>

      {error ? <View className='ui-inline-notice ui-danger' role='alert'>{error}</View> : null}
      <Button className='ux-primary price-alert__cta' disabled={saving} onClick={handleSaveTarget}>{saving ? (en ? 'Saved' : '已保存') : (en ? 'Save target price' : '保存目标价')}</Button>
      {userStore.alerts.length ? <><SectionHeading title={en ? 'Saved on this device' : '本机已保存的目标价'} />{userStore.alerts.map(alert => <View className='price-alert__saved' key={alert.id}><View><Text className='ux-section-title'>{alert.origin} → {alert.destination}</Text><Text className='ux-caption'>{en ? 'Target price' : '目标价'} · {formatPrice(alert.targetPrice)}</Text></View><Icon name='bell' /></View>)}</> : null}
      </View>

      <AirportSelector
        visible={selectorFor !== ''}
        title={selectorFor === 'origin' ? t('search.depart') : t('search.arrive')}
        selected={selectorFor === 'origin' ? origin : destination}
        onSelect={iata => (selectorFor === 'origin' ? setOrigin(iata) : setDestination(iata))}
        onClose={() => setSelectorFor('')}
      />

      <LoginSheet visible={showLogin} onClose={() => setShowLogin(false)} onSuccess={handleSaveTarget} />
    </View>
  )
}

export default observer(PriceAlertPage)
