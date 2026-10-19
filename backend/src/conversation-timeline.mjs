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
  if (anchor) anchor.trip = trip
}
