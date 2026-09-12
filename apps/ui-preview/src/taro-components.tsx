import React from 'react'
import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

type TaroA11y = { ariaRole?: string; ariaLabel?: string }
function DialogView(props: React.HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('button:not(:disabled), input, textarea, [tabindex="0"]')?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  return <div ref={ref} {...props} onKeyDown={event => {
    props.onKeyDown?.(event)
    if (event.key === 'Escape') ref.current?.querySelector<HTMLButtonElement>('.ux-sheet-close')?.click()
    if (event.key !== 'Tab') return
    const controls = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') || []).filter(node => node.getClientRects().length)
    const first = controls[0], last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }} />
}
export const View = ({ ariaRole, ariaLabel, ...props }: React.HTMLAttributes<HTMLDivElement> & TaroA11y) => props.role === 'dialog' || ariaRole === 'dialog' ? <DialogView role={ariaRole} aria-label={ariaLabel} {...props} /> : <div role={ariaRole} aria-label={ariaLabel} {...props} />
export const Text = ({ ariaRole, ariaLabel, ...props }: React.HTMLAttributes<HTMLSpanElement> & TaroA11y) => <span role={ariaRole} aria-label={ariaLabel} {...props} />
export const Canvas = ({ canvasId, type: _type, ...props }: React.CanvasHTMLAttributes<HTMLCanvasElement> & { canvasId?: string; type?: string }) => <canvas id={canvasId} {...props} />
export function ScrollView({ scrollY, scrollX, scrollIntoView, scrollWithAnimation: _animate, ...props }: React.HTMLAttributes<HTMLDivElement> & { scrollY?: boolean; scrollX?: boolean; scrollIntoView?: string; scrollWithAnimation?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (scrollIntoView) document.getElementById(scrollIntoView)?.scrollIntoView({ block: 'nearest' }) }, [scrollIntoView])
  return <div ref={ref} {...props} style={{ overflowY: scrollY ? 'auto' : undefined, overflowX: scrollX ? 'auto' : undefined, ...props.style }} />
}
export const Switch = ({ checked, onChange }: { checked?: boolean; onChange?: (event: { detail: { value: boolean } }) => void }) => <input type='checkbox' role='switch' checked={checked} onChange={event => onChange?.({ detail: { value: event.target.checked } })} />
export const Button = ({ ariaLabel, type = 'button', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & TaroA11y) => <button type={type} aria-label={ariaLabel} {...props} />
export const Image = ({ mode, src, ariaLabel, style, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { mode?: string; ariaLabel?: string }) => <img src={src?.startsWith('/assets/') ? src.replace(/^\/assets\//, '/') : src} aria-label={ariaLabel} {...props} style={{ objectFit: mode === 'aspectFit' ? 'contain' : 'cover', ...style }} />

type InputEvent = { detail: { value: string } }
type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onInput' | 'type'> & TaroA11y & { type?: string; maxlength?: number; onInput?: (event: InputEvent) => unknown; onConfirm?: (event: InputEvent) => unknown; confirmType?: string; focus?: boolean }
export function Input({ ariaLabel, ariaRole, type = 'text', maxlength, onInput, onConfirm, confirmType: _confirmType, focus, ...props }: InputProps) {
  return <input {...props} aria-label={ariaLabel} role={ariaRole} type={type === 'digit' ? 'text' : type} inputMode={type === 'digit' ? 'decimal' : undefined} maxLength={maxlength} autoFocus={focus} onChange={event => { onInput?.({ detail: { value: event.target.value } }); props.onChange?.(event) }} onKeyDown={event => { props.onKeyDown?.(event); if (event.key === 'Enter' && !event.nativeEvent.isComposing) onConfirm?.({ detail: { value: event.currentTarget.value } }) }} />
}
type TextareaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onInput'> & TaroA11y & { maxlength?: number; autoHeight?: boolean; showConfirmBar?: boolean; confirmType?: string; focus?: boolean; onInput?: (event: InputEvent) => unknown; onConfirm?: (event: InputEvent) => unknown }
export function Textarea({ ariaLabel, ariaRole, maxlength, autoHeight: _autoHeight, showConfirmBar: _showConfirmBar, confirmType: _confirmType, focus, onInput, onConfirm: _onConfirm, ...props }: TextareaProps) {
  return <textarea {...props} aria-label={ariaLabel} role={ariaRole} maxLength={maxlength} autoFocus={focus} onChange={event => { onInput?.({ detail: { value: event.target.value } }); props.onChange?.(event) }} />
}
type Marker = { id: number; latitude: number; longitude: number; title?: string; iconPath?: string; callout?: { content?: string } }
type MapProps = React.HTMLAttributes<HTMLDivElement> & { latitude?: number; longitude?: number; scale?: number; markers?: Marker[]; includePoints?: Array<{ latitude: number; longitude: number }>; polyline?: Array<{ points: Array<{ latitude: number; longitude: number }>; color?: string; width?: number; dottedLine?: boolean }>; onMarkerTap?: (event: { detail: { markerId: number } }) => void }

export function Map({ children, latitude = 38.7223, longitude = -9.1393, scale = 12, markers = [], includePoints = [], polyline = [], onMarkerTap, onError: _nativeMapError, ...props }: MapProps) {
  const host = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const [tileError, setTileError] = React.useState(false)
  const failedTiles = useRef(new Set<string>())
  useEffect(() => {
    if (!host.current || mapRef.current) return
    const map = L.map(host.current, { zoomControl: true, attributionControl: true }).setView([latitude, longitude], scale)
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19, maxNativeZoom: 19 })
    const tileKey = (event: L.TileEvent) => event.coords ? `${event.coords.z}/${event.coords.x}/${event.coords.y}` : event.tile.src
    tiles.on('tileerror', event => { failedTiles.current.add(tileKey(event)); setTileError(true) })
    tiles.on('tileload', event => { failedTiles.current.delete(tileKey(event)); setTileError(failedTiles.current.size > 0) })
    tiles.on('tileunload', event => { failedTiles.current.delete(tileKey(event)); setTileError(failedTiles.current.size > 0) })
    tiles.addTo(map)
    mapRef.current = map
    // The map sits in a responsive card. Leaflet measures the container once
    // during construction, so refresh after the browser has laid out the card.
    const frame = window.requestAnimationFrame(() => map.invalidateSize())
    const resizeObserver = new ResizeObserver(entries => { if (entries.some(entry => entry.contentRect.width > 0 && entry.contentRect.height > 0)) map.invalidateSize() })
    resizeObserver.observe(host.current)
    return () => { window.cancelAnimationFrame(frame); resizeObserver.disconnect(); tiles.off(); failedTiles.current.clear(); map.remove(); mapRef.current = null }
  }, [])
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.setView([latitude, longitude], scale)
    const layer = L.layerGroup().addTo(map)
    markers.forEach((marker) => {
      const label = marker.callout?.content || marker.title || String(marker.id)
      const pinText = document.createElement('span'); pinText.textContent = String(marker.id)
      const iconMarkup = document.createElement('div'); iconMarkup.appendChild(pinText)
      const icon = L.divIcon({ className: 'ui-map-pin', html: iconMarkup.innerHTML, iconSize: [30, 30], iconAnchor: [15, 15] })
      const pin = L.marker([marker.latitude, marker.longitude], { icon, title: marker.title || label, alt: marker.title || label }).addTo(layer)
      const tooltip = document.createElement('span'); tooltip.textContent = label
      pin.bindTooltip(tooltip, { permanent: false, direction: 'top', className: 'ui-map-label' })
      pin.on('click', () => onMarkerTap?.({ detail: { markerId: marker.id } }))
    })
    polyline.forEach((line) => L.polyline(line.points.map((point) => [point.latitude, point.longitude] as [number, number]), { color: line.color || '#176d70', weight: line.width || 3, dashArray: line.dottedLine ? '8 8' : undefined }).addTo(layer))
    if (includePoints.length > 1) map.fitBounds(L.latLngBounds(includePoints.map((point) => [point.latitude, point.longitude] as [number, number])), { padding: [18, 18], maxZoom: 16 })
    return () => { layer.remove() }
  }, [latitude, longitude, scale, markers, includePoints, polyline, onMarkerTap])
  return <div ref={host} {...props}>{tileError ? <div className='ui-map-status' role='status'>底图暂不可用，仍可通过下方日程查看</div> : null}{children}</div>
}
