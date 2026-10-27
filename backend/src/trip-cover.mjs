// Keep the catalogue, saved-run view and overview on the same itinerary image.
// This reads only the trip itself; it never performs an image lookup.
export function existingTripCover(trip) {
  return trip.cover?.src ? trip.cover : (trip.days||[]).flatMap(day=>day.activities||[]).find(activity=>activity.media?.src)?.media || null
}
export async function storedTripCover(trip) { return existingTripCover(trip) }
