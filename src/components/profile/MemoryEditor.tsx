import { useEffect, useRef, useState } from 'react'
import { View, Text, Textarea, Switch, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getCloudMemory, saveCloudMemory, setCloudMemoryEnabled, type CloudMemory } from '../../services/workspaceService'

export function MemoryEditor({ legacyCities }: { legacyCities: string[] }) {
  const [memory, setMemory] = useState<CloudMemory | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = useRef(true)
  const bytes = Array.from(draft).reduce((n, char) => n + (char.codePointAt(0)! > 0xffff ? 4 : char.charCodeAt(0) > 0x7ff ? 3 : char.charCodeAt(0) > 0x7f ? 2 : 1), 0)
  async function load() {
    if (busy) return
    setBusy(true); setError('')
    try { const value = await getCloudMemory(); if (active.current) { setMemory(value); setDraft(value.markdown) } }
    catch (e) { if (active.current) setError(e instanceof Error ? e.message : '读取失败') }
    finally { if (active.current) setBusy(false) }
  }
  useEffect(() => { active.current = true; void load(); return () => { active.current = false } }, [])
  async function save(markdown = draft) {
    if (!memory || busy) return
    setBusy(true); setError('')
    try { const value = await saveCloudMemory(markdown, memory.version); if (active.current) { setMemory(value); setDraft(value.markdown); Taro.showToast({ title: '已保存到云端', icon: 'success' }) } }
    catch (e) { if (active.current) setError(e instanceof Error ? e.message : '保存失败，草稿仍保留') }
    finally { if (active.current) setBusy(false) }
  }
  async function toggle(enabled: boolean) {
    if (!memory || busy) return
    setBusy(true); setError('')
    try { const value = await setCloudMemoryEnabled(enabled, memory.version); if (active.current) setMemory(value) }
    catch (e) { if (active.current) setError(e instanceof Error ? e.message : '更新失败') }
    finally { if (active.current) setBusy(false) }
  }
  async function reload() {
    if (memory && draft !== memory.markdown) {
      const response = await Taro.showModal({ title: '重新读取云端偏好', content: '当前未保存的草稿会被替换。你可以先复制草稿。' })
      if (!response.confirm || !active.current) return
    }
    await load()
  }
  return <View className='profile-cloud__section'>
    <View className='profile-cloud__row'><Text className='profile-cloud__heading'>我的旅行偏好</Text><Switch checked={memory?.enabled ?? false} disabled={!memory || busy} onChange={e => toggle(e.detail.value)} /></View>
    <Text className='profile-cloud__muted'>开启后，新的规划会参考这些长期偏好。本次旅行的要求始终优先。关闭不会删除内容。</Text>
    <Textarea className='profile-cloud__editor' value={draft} maxlength={8192} disabled={!memory || busy} onInput={e => setDraft(e.detail.value)} placeholder={'# 我的旅行偏好\n\n常用出发地、喜欢的城市、兴趣与旅行节奏…'} />
    <Text className={bytes > 8192 ? 'profile-cloud__error' : 'profile-cloud__muted'}>{bytes} / 8192 字节 · {memory ? `版本 ${memory.version}` : '尚未加载'}</Text>
    {error && <Text className='profile-cloud__error'>{error}。如其他设备已修改，请先复制草稿，再重新读取并合并。</Text>}
    <View className='profile-cloud__actions'><Button disabled={!memory || busy || bytes > 8192 || draft === memory.markdown} onClick={() => save()}>保存偏好</Button><Button disabled={busy} onClick={reload}>重新读取</Button><Button disabled={!draft} onClick={() => Taro.setClipboardData({ data: draft })}>复制草稿</Button></View>
    {legacyCities.length > 0 && <View className='profile-cloud__link' onClick={() => !busy && setDraft(value => `${value.trim()}\n\n## 想去的机场或城市\n${legacyCities.filter(code => /^[A-Z]{3}$/.test(code)).map(code => `- ${code}`).join('\n')}`.trim())}>将本机 TOGO 清单加入草稿</View>}
    {memory?.markdown && <View className='profile-cloud__link profile-cloud__error' onClick={async () => { if (busy) return; const result = await Taro.showModal({ title: '清空旅行偏好', content: '清空云端 Markdown 内容？此操作会同步到其他设备。' }); if (result.confirm && active.current) await save('') }}>清空云端偏好</View>}
  </View>
}
