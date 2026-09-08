// src/components/common/LoginSheet.tsx — 登录弹层（iOS 底部抽屉）
// 使用微信官方能力：button open-type="chooseAvatar" + input type="nickname"
import { useEffect, useRef, useState } from 'react'
import { View, Text, Image, Button, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { userStore } from '../../stores/userStore'
import { persistAvatar } from '../../services/authService'
import { t } from '../../i18n'
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
  const attempt = useRef(0)
  useEffect(() => { if (!visible) attempt.current += 1 }, [visible])

  if (!visible) return null

  const handleClose = () => { attempt.current += 1; onClose() }

  const handleChooseAvatar = async e => {
    const temp = e.detail.avatarUrl as string
    if (!temp) return
    setAvatarUrl(await persistAvatar(temp))
  }

  const handleConfirm = async () => {
    if (userStore.isLoggingIn) return
    const requestId = ++attempt.current
    try {
      const loggedIn = await userStore.login({
        nickname: nickname.trim(),
        avatarUrl
      })
      if (!loggedIn || requestId !== attempt.current) return
      Taro.showToast({ title: t('login.success'), icon: 'success' })
      onClose()
      onSuccess?.()
    } catch {
      if (requestId === attempt.current) Taro.showToast({ title: t('login.fail'), icon: 'none' })
    }
  }

  return (
    <View className='login-sheet'>
      <View className='login-sheet__mask' onClick={handleClose} />
      <View className='login-sheet__panel'>
        <View className='login-sheet__header'>
          <Text className='login-sheet__title'>{t('login.title')}</Text>
          <Text className='login-sheet__close' onClick={handleClose}>✕</Text>
        </View>
        <Text className='login-sheet__desc'>{t('login.desc')}</Text>

        {/* 头像：微信官方选择器（可用微信头像） */}
        <Button className='login-sheet__avatar-btn' openType='chooseAvatar' onChooseAvatar={handleChooseAvatar}>
          {avatarUrl ? (
            <Image className='login-sheet__avatar' src={avatarUrl} mode='aspectFill' />
          ) : (
            <View className='login-sheet__avatar login-sheet__avatar--empty'>
              <Text>✈</Text>
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

        <View
          className={`login-sheet__confirm ${userStore.isLoggingIn ? 'is-loading' : ''}`}
          hoverClass='tap-dim'
          onClick={handleConfirm}
        >
          <Text>{userStore.isLoggingIn ? t('login.loading') : t('login.confirm')}</Text>
        </View>
        <Text className='login-sheet__privacy'>{t('login.privacy')}</Text>
      </View>
    </View>
  )
}

export default observer(LoginSheet)
