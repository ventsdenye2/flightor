export function attachFlightOptions(conversation, options, messageId) {
  if (!options) return
  const anchor = conversation.messages.find(message => message.flightOptions?.searchId === options.searchId)
    || conversation.messages.find(message => message.id === messageId && message.role === 'assistant')
  if (!anchor) return
  anchor.flightOptions ??= options
  if (conversation.flightOptions?.searchId !== options.searchId) {
    delete conversation.selectedFlight
    delete conversation.flightSelectionLocked
  }
  conversation.flightOptions = options
}
export function updateFlightChoice(conversation, selection, locked = false) {
  conversation.selectedFlight = selection
  conversation.flightSelectionLocked = locked
  const anchor = conversation.messages.find(message => message.flightOptions?.searchId === conversation.flightOptions?.searchId)
  if (anchor) { anchor.selectedFlight = selection; anchor.flightSelectionLocked = locked }
}
export function attachTrip(conversation, trip, messageId) {
  if (!trip) return
  const anchor = conversation.messages.find(message => message.id === messageId && message.role === 'assistant')
  if (anchor) {
    trip.context = { conversationId: conversation.id, messageId: anchor.id, runId: trip.id.replace(/^live-/,''), tripId:trip.id }
    anchor.trip = trip
  }
}

export function resolveTripContext(conversation, context) {
  if (!context) return null
  if (context.conversationId !== conversation.id) throw Error('调整行程不属于当前对话')
  const anchor = conversation.messages.find(message => message.id === context.messageId && message.role === 'assistant' && message.trip?.id.replace(/^live-/,'') === context.runId && (!context.tripId || message.trip.id === context.tripId))
  if (!anchor) throw Error('调整行程的消息锚点不存在')
  const trip = anchor.trip
  return { id: trip.id, title: trip.title, destination: trip.destination, dates: trip.dates, travelers: trip.travelers,
    route: trip.route, flights: trip.flights, days: (trip.days || []).map(day => ({ id: day.id, title: day.title,
      activities: day.activities.map(activity => ({ id: activity.id, name: activity.name, time: activity.time, until: activity.until, area: activity.area, summary: activity.summary })) })) }
}
