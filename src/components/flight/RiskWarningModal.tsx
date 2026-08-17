// src/components/flight/RiskWarningModal.tsx — 自行中转风险确认弹窗
import { useEffect, useState } from 'react'
import { View, Text, Checkbox, CheckboxGroup } from '@tarojs/components'
import { observer } from 'mobx-react-lite'
import type { RiskItem, VisaStatus } from '../../types/common'
import { t } from '../../i18n'
import './RiskWarningModal.scss'

interface RiskWarningModalProps {
  visible: boolean
  onConfirm: () => void
  onCancel: () => void
  risks: RiskItem[]
  hub: string
  visaStatus: VisaStatus
}

const VISA_CLS: Record<VisaStatus, string> = {
  free: 'is-free',
  conditional: 'is-conditional',
  required: 'is-required'
}

function RiskWarningModal({ visible, onConfirm, onCancel, risks, hub, visaStatus }: RiskWarningModalProps) {
  const [checked, setChecked] = useState(false)
  const [disclaimerOpen, setDisclaimerOpen] = useState(false)

  // 每次重新打开时重置确认状态，避免上次勾选残留
  useEffect(() => {
    if (visible) {
      setChecked(false)
      setDisclaimerOpen(false)
    }
  }, [visible])

  if (!visible) return null

  return (
    <View className='risk-modal' catchMove>
      <View className='risk-modal__mask' onClick={onCancel} />
      <View className='risk-modal__sheet'>
        <View className='risk-modal__header'>
          <Text className='risk-modal__title'>{t('risk.title')}</Text>
          <Text className='risk-modal__subtitle'>
            {t('risk.transferAt', { hub })} ·{' '}
            <Text className={`risk-modal__visa ${VISA_CLS[visaStatus]}`}>{t(`risk.visa.${visaStatus}`)}</Text>
          </Text>
        </View>

        <View className='risk-modal__list'>
          {risks.map(r => (
            <View key={r.title} className={`risk-modal__item is-${r.severity}`}>
              <Text className='risk-modal__item-icon'>{r.icon}</Text>
              <View className='risk-modal__item-body'>
                <Text className='risk-modal__item-title'>{r.title}</Text>
                <Text className='risk-modal__item-desc'>{r.description}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* 免责声明折叠区 */}
        <View className='risk-modal__disclaimer'>
          <View className='risk-modal__disclaimer-toggle' onClick={() => setDisclaimerOpen(!disclaimerOpen)}>
            <Text>{t('risk.disclaimer')} {disclaimerOpen ? '▴' : '▾'}</Text>
          </View>
          {disclaimerOpen && <Text className='risk-modal__disclaimer-text'>{t('risk.disclaimerText')}</Text>}
        </View>

        <CheckboxGroup onChange={e => setChecked((e.detail.value as string[]).length > 0)}>
          <View className='risk-modal__check'>
            <Checkbox value='agree' checked={checked} color='#0a84ff' />
            <Text className='risk-modal__check-text'>{t('risk.check')}</Text>
          </View>
        </CheckboxGroup>

        <View className='risk-modal__actions'>
          <View className='risk-modal__btn risk-modal__btn--cancel' hoverClass='tap-dim' onClick={onCancel}>
            <Text>{t('risk.cancel')}</Text>
          </View>
          <View
            className={`risk-modal__btn risk-modal__btn--confirm ${checked ? '' : 'is-disabled'}`}
            hoverClass={checked ? 'tap-dim' : 'none'}
            onClick={() => checked && onConfirm()}
          >
            <Text>{t('risk.confirm')}</Text>
          </View>
        </View>
      </View>
    </View>
  )
}

export default observer(RiskWarningModal)
