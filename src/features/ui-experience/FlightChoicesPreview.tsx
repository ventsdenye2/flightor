import { useState } from 'react'
import { View } from '@tarojs/components'
import { FlightChoices } from './FlightChoices'
import type { FlightSearchDataset } from './flightSamples'
import type { FlightOptions, FlightSelection } from './flightOptions'
import { PageHeader } from './SharedUI'

export function FlightChoicesPreview({ dataset, onBack }: { dataset: FlightSearchDataset; onBack: () => void }) {
  const [selected, setSelected] = useState<FlightSelection | null>(null)
  const result: FlightOptions = {
    searchId: 'design-preview', source: 'FlightOR 设计样例', sourceUrl: null, observedAt: '', status: 'sample',
    origin: dataset.origin, destination: dataset.destination, originName: dataset.originName || dataset.origin, destinationName: dataset.destinationName || dataset.destination, date: dataset.date, adults: dataset.travelers || 1, cabin: 'economy',
    options: dataset.flights.map(flight => ({
      id: flight.id, airlines: [flight.airline], amount: flight.price, currency: 'CNY', departureAirport: dataset.origin, arrivalAirport: dataset.destination,
      departureLocal: flight.departure ? `${dataset.date}T${flight.departure}` : null,
      arrivalLocal: flight.arrival ? `${flight.nextDay ? new Date(Date.parse(dataset.date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10) : dataset.date}T${flight.arrival}` : null,
      durationMinutes: flight.minutes, stopCount: flight.stops, segments: flight.legs.map(leg => ({ airline: leg.carrier, flightNumber: '', origin: leg.from, destination: leg.to, departureLocal: leg.depart, arrivalLocal: leg.arrive, durationMinutes: null })),
      connections: flight.via ? [{ city: flight.via, durationMinutes: null, selfTransfer: flight.selfTransfer, airportChange: null, collectAndRecheckBaggage: null }] : [], baggage: null
    }))
  }
  return <View className='ux-app'><PageHeader title='航班选项设计' onBack={onBack} /><View className='ux-scroll' style={{ padding: '0 18px 24px' }}><FlightChoices result={result} selected={selected} sample onSelect={option => setSelected(option ? { searchId: result.searchId, candidateId: option.id } : null)} /></View></View>
}
