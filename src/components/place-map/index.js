const {diagnosticDetail}=require('./diagnostic-detail')
Component({
  properties: { payload: { type: String, value: '', observer: 'updatePoints' } },
  data: { latitude: 0, longitude: 0, scale:13, markers: [], lines: [], bounds: [] },
  lifetimes: {
    ready() { this.mapContextReady=true;this.observe('created');this.fitBounds() },
    detached() { this.mapContextReady=false;clearTimeout(this.boundsTimer);clearTimeout(this.boundsDeadline) },
  },
  methods: {
    observe(stage,value=null,status='observed') {
      const event={stage,status,basemap:'unknown',...diagnosticDetail(value)}
      this.mapDiagnostics=this.mapDiagnostics||[];this.mapDiagnostics.push(event)
      if(this.mapDiagnostics.length>50)this.mapDiagnostics.shift()
      this.triggerEvent('mapdiagnostic',event)
    },
    getDiagnostics() { return this.mapDiagnostics||[] },
    updatePoints(value) {
      try {
        const { markers, lines, bounds } = JSON.parse(value)
        if (!markers.length) return
        this.setData({latitude:markers[0].latitude,longitude:markers[0].longitude,scale:13,markers,lines,bounds},()=>this.fitBounds())
      } catch (error) { this.observe('payload',error,'failed');this.triggerEvent('mapfailure',diagnosticDetail(error)) }
    },
    selectMarker(event) { this.observe('marker_interaction',event);this.triggerEvent('selectplace', { markerId: event.detail.markerId }) },
    fitBounds() {
      if (!this.mapContextReady || !this.data.bounds.length) return
      const signature = JSON.stringify(this.data.bounds)
      if (signature === this.boundsSignature) return
      if(this.boundsAttempt?.signature!==signature){clearTimeout(this.boundsTimer);clearTimeout(this.boundsDeadline);this.boundsAttempt={signature,count:0,pending:false}}
      const attempt=this.boundsAttempt
      if(attempt.pending||attempt.count>=2)return
      attempt.pending=true;attempt.count++
      this.observe('includePoints.start',{attempt:attempt.count},'pending')
      const call=attempt.count
      let settled=false
      const current=()=>this.mapContextReady&&this.boundsAttempt===attempt&&attempt.count===call&&!settled
      const fail=error=>{
        if(!current())return
        settled=true;clearTimeout(this.boundsDeadline)
        attempt.pending=false;this.observe('includePoints.fail',error,'failed')
        this.setData({latitude:this.data.markers[0]?.latitude??this.data.latitude,longitude:this.data.markers[0]?.longitude??this.data.longitude,scale:13})
        if(attempt.count<2)this.boundsTimer=setTimeout(()=>{if(this.mapContextReady&&this.boundsAttempt===attempt)this.fitBounds()},400)
      }
      this.boundsDeadline=setTimeout(()=>fail({errMsg:'includePoints callback timeout',errCode:null}),3000)
      try {wx.createMapContext('places',this).includePoints({points:this.data.bounds,padding:[28,28,28,28],
        success:detail=>{if(current()){settled=true;clearTimeout(this.boundsDeadline);attempt.pending=false;this.boundsSignature=signature;this.observe('includePoints.success',detail,'succeeded')}},fail})
      }catch(error){fail(error)}
    },
    mapReady(event) { this.observe('updated',event);this.triggerEvent('mapready',diagnosticDetail(event)) },
    mapAuth(event) { this.observe('auth',event) },
    mapAbility(event) { this.observe('ability',event) },
    mapAbilityFailed(event) { this.observe('ability',event,'failed') },
    mapError(event) { this.observe('native_error',event,'failed');this.triggerEvent('mapfailure',diagnosticDetail(event)) }
  }
})
