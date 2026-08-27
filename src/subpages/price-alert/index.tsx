// subpages/price-alert — 价格提醒设置（分包）
import { useEffect, useState } from 'react'
import { View, Text, Slider } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import AirportSelector from '../../components/search/AirportSelector'
import LoginSheet from '../../components/common/LoginSheet'
import { userStore } from '../../stores/userStore'
import { t, localeStore } from '../../i18n'
import { formatPrice } from '../../utils/format'
import './index.scss'

function PriceAlertPage() {
  const router = useRouter()
  const [origin, setOrigin] = useState(router.params?.origin ?? 'PVG')
  const [destination, setDestination] = useState(router.params?.destination ?? 'LHR')
  const currentPrice = Number(router.params?.current ?? 5000)
  const [targetPrice, setTargetPrice] = useState(Math.round(currentPrice * 0.85))
  const [selectorFor, setSelectorFor] = useState<'origin' | 'destination' | ''>('')
  const [showLogin, setShowLogin] = useState(false)
  const locale = localeStore.locale

  useEffect(() => {
    Taro.setNavigationBarTitle({ title: t('nav.priceAlert') })
  }, [locale])

  const handleSubscribe = async () => {
    // 盯价推送需绑定用户身份（openid），未登录先引导登录
    if (!userStore.isLoggedIn) {
      setShowLogin(true)
      return
    }
    // 订阅消息授权（模板 ID 上线前在公众平台申请后替换）
    try {
      // @ts-ignore requestSubscribeMessage 需真机验证
      await Taro.requestSubscribeMessage({ tmplIds: ['PRICE_ALERT_TMPL_ID'] })
    } catch {
      // 开发者工具/未配置模板时忽略授权失败，仍保留本地提醒记录
    }
    userStore.addAlert({ origin, destination, targetPrice })
    Taro.showToast({ title: t('pa.created'), icon: 'success' })
    setTimeout(() => Taro.navigateBack(), 1200)
  }

  return (
    <View className='price-alert'>
      <Text className='price-alert__title'>{t('pa.title')}</Text>
      <Text className='price-alert__desc'>{t('pa.desc')}</Text>

      <View className='price-alert__form'>
        <View className='price-alert__field' onClick={() => setSelectorFor('origin')}>
          <Text className='price-alert__label'>{t('search.depart')}</Text>
          <Text className='font-code price-alert__value'>{origin}</Text>
        </View>

        <View className='price-alert__field' onClick={() => setSelectorFor('destination')}>
          <Text className='price-alert__label'>{t('search.arrive')}</Text>
          <Text className='font-code price-alert__value'>{destination}</Text>
        </View>

        <View className='price-alert__field price-alert__field--column'>
          <View className='price-alert__target-row'>
            <Text className='price-alert__label'>{t('pa.target')}</Text>
            <Text className='font-code price-alert__target'>{formatPrice(targetPrice)}</Text>
          </View>
          <Slider
            min={500}
            max={Math.max(20000, currentPrice)}
            step={100}
            value={targetPrice}
            activeColor='#0a84ff'
            backgroundColor='#3a3a3c'
            blockSize={20}
            blockColor='#0a84ff'
            onChanging={e => setTargetPrice(e.detail.value)}
          />
          <Text className='price-alert__hint'>{t('pa.hint', { p: formatPrice(currentPrice) })}</Text>
        </View>
      </View>

      <View className='price-alert__cta' hoverClass='tap-dim' onClick={handleSubscribe}>
        <Text>{t('pa.cta')}</Text>
      </View>

      <Text className='price-alert__note'>{t('pa.note')}</Text>

      <AirportSelector
        visible={selectorFor !== ''}
        title={selectorFor === 'origin' ? t('search.depart') : t('search.arrive')}
        selected={selectorFor === 'origin' ? origin : destination}
        onSelect={iata => (selectorFor === 'origin' ? setOrigin(iata) : setDestination(iata))}
        onClose={() => setSelectorFor('')}
      />

      {/* 登录弹层：登录成功后自动继续创建盯价 */}
      <LoginSheet visible={showLogin} onClose={() => setShowLogin(false)} onSuccess={handleSubscribe} />
    </View>
  )
}

export default observer(PriceAlertPage)
