// src/components/common/LoginSheet.tsx — 登录弹层（iOS 底部抽屉）
// 使用微信官方能力：button open-type="chooseAvatar" + input type="nickname"
import { useEffect, useRef, useState } from 'react'
import { View, Text, Image, Button, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { userStore } from '../../stores/userStore'
import { LOCAL_LOGIN_AVAILABLE, persistAvatar } from '../../services/authService'
import { loginErrorKey } from '../../utils/authErrors'
import { t } from '../../i18n'
import { Icon } from '../../features/ui-experience/VisualMedia'
import { setProductionTabBarHidden } from '../navigation/ProductionTabBar'
import './LoginSheet.scss'

interface LoginSheetProps {
  visible: boolean
  onClose: () => void
  /** 登录成功回调（如继续被打断的操作） */
  onSuccess?: () => void
}

function LoginSheet({ visible, onClose, onSuccess }: LoginSheetProps) {
  const [avatarUrl, setAvatarUrl] = useState('')
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState('')
  const attempt = useRef(0)
  useEffect(() => { if (!visible) { attempt.current += 1; setError('') } }, [visible])
  useEffect(() => {
    if (!visible) return
    setProductionTabBarHidden(true)
    void Taro.hideTabBar({ animation: false }).catch(() => {})
    return () => {
      setProductionTabBarHidden(false)
      void Taro.showTabBar({ animation: false }).catch(() => {})
    }
  }, [visible])

  if (!visible) return null

  const handleClose = () => { attempt.current += 1; onClose() }

  const handleChooseAvatar = async e => {
    const temp = e.detail.avatarUrl as string
    if (!temp) return
    setAvatarUrl(await persistAvatar(temp))
  }

  const handleConfirm = async (method: 'wechat' | 'local' = 'wechat') => {
    if (userStore.isLoggingIn) return
    const requestId = ++attempt.current
    setError('')
    try {
      const loggedIn = await userStore.login({
        nickname: nickname.trim(),
        avatarUrl
      }, { method })
      if (!loggedIn || requestId !== attempt.current) return
      Taro.showToast({ title: t(method === 'local' ? 'login.localSuccess' : 'login.success'), icon: 'success' })
      onClose()
      onSuccess?.()
    } catch (failure) {
      if (requestId === attempt.current) setError(t(loginErrorKey(failure)))
    }
  }

  return (
    <View className='login-sheet'>
      <View className='login-sheet__mask' onClick={handleClose} />
      <View className='login-sheet__panel'>
        <View className='login-sheet__header'>
          <Text className='login-sheet__title'>{t('login.title')}</Text>
          <Button className='login-sheet__close' ariaLabel={t('login.close')} onClick={handleClose}><Icon name='close' /></Button>
        </View>
        <Text className='login-sheet__desc'>{t('login.desc')}</Text>

        {/* 头像：微信官方选择器（可用微信头像） */}
        <Button className='login-sheet__avatar-btn' openType='chooseAvatar' onChooseAvatar={handleChooseAvatar}>
          {avatarUrl ? (
            <Image className='login-sheet__avatar' src={avatarUrl} mode='aspectFill' />
          ) : (
            <View className='login-sheet__avatar login-sheet__avatar--empty'>
              <Icon name='plane' />
            </View>
          )}
          <Text className='login-sheet__avatar-tip'>{t('login.avatar')}</Text>
        </Button>

        {/* 昵称：type=nickname 键盘带微信昵称快捷填入 */}
        <View className='login-sheet__field'>
          <Text className='login-sheet__label'>{t('login.nickname')}</Text>
          <Input
            className='login-sheet__input'
            type='nickname'
            placeholder={t('login.nicknamePh')}
            placeholderClass='login-sheet__placeholder'
            maxlength={20}
            value={nickname}
            onInput={e => setNickname(e.detail.value)}
          />
        </View>

        {error && <Text className='login-sheet__error'>{error}</Text>}
        <Button
          className={`login-sheet__confirm ${userStore.isLoggingIn ? 'is-loading' : ''}`}
          hoverClass='tap-dim'
          disabled={userStore.isLoggingIn}
          onClick={() => handleConfirm()}
        >
          <Text>{userStore.isLoggingIn ? t('login.loading') : t('login.confirm')}</Text>
        </Button>
        {LOCAL_LOGIN_AVAILABLE && <View className='login-sheet__local'>
          <Button className='login-sheet__local-button' hoverClass='tap-dim' disabled={userStore.isLoggingIn} onClick={() => handleConfirm('local')}>
            <Text>{t('login.localConfirm')}</Text>
          </Button>
          <Text className='login-sheet__local-note'>{t('login.localDesc')}</Text>
        </View>}
        <Text className='login-sheet__privacy'>{t('login.privacy')}</Text>
      </View>
    </View>
  )
}

export default observer(LoginSheet)
