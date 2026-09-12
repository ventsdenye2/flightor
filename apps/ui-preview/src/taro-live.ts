import { useEffect, useSyncExternalStore } from 'react'

// Browser transport for the existing production stores. No sample responses,
// injected bearer tokens, or simulated WeChat identity are used here.
const routeEvent = 'flightor-route'
const subscribe = (fn: () => void) => { window.addEventListener(routeEvent, fn); window.addEventListener('popstate', fn); return () => { window.removeEventListener(routeEvent, fn); window.removeEventListener('popstate', fn) } }
export const useLiveRoute = () => useSyncExternalStore(subscribe, () => location.hash.slice(1) || '/pages/plan/index')
export function useRouter() { const route = useLiveRoute(); return { path: route.split('?')[0], params: Object.fromEntries(new URLSearchParams(route.split('?')[1] || '')) } }
export function useDidShow(callback: () => void) { const route = useLiveRoute(); useEffect(callback, [route]) }
export function useReady(callback: () => void) { useEffect(callback, []) }
export function useDidHide() {}
const navigate = async ({ url }: { url: string }) => { history.pushState(null, '', `/live.html#${url}`); window.dispatchEvent(new Event(routeEvent)) }
const notify = async ({ title }: { title: string }) => { window.dispatchEvent(new CustomEvent('flightor-notice', { detail: title })) }
const Taro = {
  ENV_TYPE: { WEB: 'WEB', WEAPP: 'WEAPP' }, getEnv: () => 'WEB',
  getStorageSync: (key: string) => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? '' } catch { return '' } },
  setStorageSync: (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value)),
  removeStorageSync: (key: string) => localStorage.removeItem(key),
  async request(options: { url: string; method?: string; data?: unknown; header?: Record<string, string>; timeout?: number }) {
    const url = new URL(options.url)
    if (url.origin !== FLIGHTOR_API_BASE_URL) throw new Error('Local validation only permits the configured backend')
    const method = options.method || 'GET'
    if (method === 'GET' && options.data && typeof options.data === 'object') for (const [key, value] of Object.entries(options.data)) if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
    const response = await fetch(url, { method, headers: options.header, ...(method === 'GET' ? {} : { body: JSON.stringify(options.data) }), signal: AbortSignal.timeout(options.timeout || 60000) })
    return { statusCode: response.status, data: await response.json(), header: Object.fromEntries(response.headers) }
  },
  navigateTo: navigate, redirectTo: navigate, switchTab: navigate,
  navigateBack: async () => history.back(),
  setNavigationBarTitle: async ({ title }: { title: string }) => { document.title = `${title} · FlightOR 本地验证` },
  setTabBarItem: async () => {},
  showToast: notify, showLoading: notify, hideLoading: async () => {},
  showModal: async ({ title, content }: { title: string; content: string }) => { const confirm = window.confirm(`${title}\n${content}`); return { confirm, cancel: !confirm } },
  setClipboardData: async ({ data }: { data: string }) => navigator.clipboard.writeText(data),
  login: async () => { throw new Error('浏览器请使用本地测试登录；微信登录需要小程序运行环境。') },
  getSystemInfoSync: () => ({ pixelRatio: devicePixelRatio, windowWidth: innerWidth, windowHeight: innerHeight, statusBarHeight: 0 }),
  nextTick: (fn: () => void) => queueMicrotask(fn),
}
export default Taro
