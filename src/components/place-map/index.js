// A string crosses Taro's generated template; native arrays stay in this component.
// This avoids WXS coercion of Map's structured properties in DevTools.
Component({
  properties: { payload: { type: String, value: '', observer: 'updatePoints' } },
  data: { latitude: 0, longitude: 0, markers: [], lines: [], bounds: [] },
  lifetimes: { ready() { this.mapContextReady = true; this.fitBounds() } },
  methods: {
    updatePoints(value) {
      try {
        const { markers, lines, bounds } = JSON.parse(value)
        if (!markers.length) return
        this.setData({latitude:markers[0].latitude,longitude:markers[0].longitude,markers,lines,bounds},()=>this.fitBounds())
      } catch (_) { this.triggerEvent('mapfailure') }
    },
    selectMarker(event) { this.triggerEvent('selectplace', { markerId: event.detail.markerId }) },
    fitBounds() {
      if (!this.mapContextReady || !this.data.bounds.length) return
      const signature = JSON.stringify(this.data.bounds)
      if (signature === this.boundsSignature) return
      this.boundsSignature = signature
      wx.createMapContext('places',this).includePoints({points:this.data.bounds,padding:[28,28,28,28],fail:()=>this.triggerEvent('mapfailure')})
    },
    mapReady() { this.triggerEvent('mapready') },
    mapError() { this.triggerEvent('mapfailure') }
  }
})
