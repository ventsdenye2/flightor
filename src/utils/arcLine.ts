// src/utils/arcLine.ts — 大圆航线弧线坐标计算
// 用于微信 map 组件 polyline.points 模拟航线弧线

export interface LatLng {
  latitude: number
  longitude: number
}

const toRad = (deg: number) => (deg * Math.PI) / 180
const toDeg = (rad: number) => (rad * 180) / Math.PI

/**
 * 大圆航线插值：在起终点之间取 n 个中间点（球面线性插值 slerp）
 * 返回包含起终点的坐标数组，可直接用于 polyline.points
 */
export function greatCirclePoints(from: LatLng, to: LatLng, n = 32): LatLng[] {
  const lat1 = toRad(from.latitude)
  const lon1 = toRad(from.longitude)
  const lat2 = toRad(to.latitude)
  const lon2 = toRad(to.longitude)

  // 球面夹角
  const d = 2 * Math.asin(
    Math.sqrt(
      Math.sin((lat2 - lat1) / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2
    )
  )
  if (d === 0) return [from, to]

  const pts: LatLng[] = []
  for (let i = 0; i <= n; i++) {
    const f = i / n
    const A = Math.sin((1 - f) * d) / Math.sin(d)
    const B = Math.sin(f * d) / Math.sin(d)
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2)
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2)
    const z = A * Math.sin(lat1) + B * Math.sin(lat2)
    pts.push({
      latitude: toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))),
      longitude: toDeg(Math.atan2(y, x))
    })
  }
  return pts
}

/** 多点串联的大圆航线（经停多个 Hub） */
export function multiLegArc(points: LatLng[], nPerLeg = 24): LatLng[] {
  const out: LatLng[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const leg = greatCirclePoints(points[i], points[i + 1], nPerLeg)
    if (i > 0) leg.shift() // 去重连接点
    out.push(...leg)
  }
  return out
}

/** 取多点地理中心（用于地图初始 center） */
export function centerOf(points: LatLng[]): LatLng {
  const lat = points.reduce((s, p) => s + p.latitude, 0) / points.length
  const lng = points.reduce((s, p) => s + p.longitude, 0) / points.length
  return { latitude: lat, longitude: lng }
}
