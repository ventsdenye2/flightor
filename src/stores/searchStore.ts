// src/stores/searchStore.ts — exact manual flight-search conditions
import { makeAutoObservable } from 'mobx'
import type { SearchParams, Interest, TransitCountryPreference, TransitCountryPreferences } from '../types/flight'
import { daysFromNow, toDateString } from '../utils/format'

export class SearchStore {
  // These are the two canonical airport codes submitted to the production API.
  origin = 'SZX'
  destination = 'LHR'
  /** Exact outbound date; production search does not scan a local date window. */
  departDate = daysFromNow(54)
  /** Optional exact return date; empty until round-trip is selected. */
  returnDate = ''
  tripType: 'oneway' | 'roundtrip' = 'oneway'
  budgetMin = 2000
  budgetMax = 10000
  transferPref: 'any' | 'direct' | 'transfer' = 'any'
  transitCountryPreferences: TransitCountryPreferences = {
    preferred: [],
    excluded: []
  }
  interests: Interest[] = ['food', 'culture']

  constructor() {
    makeAutoObservable(this)
  }

  setOrigin(iata: string) {
    this.origin = iata.trim().toUpperCase()
  }

  setDestination(iata: string) {
    this.destination = iata.trim().toUpperCase()
  }

  swapOD() {
    const t = this.origin
    this.origin = this.destination
    this.destination = t
  }

  setDepartDate(date: string) {
    const today = toDateString(new Date())
    this.departDate = date < today ? today : date
    if (this.returnDate && this.returnDate < this.departDate) this.returnDate = this.departDate
  }

  setReturnDate(date: string) {
    this.returnDate = date < this.departDate ? this.departDate : date
  }

  setTripType(type: 'oneway' | 'roundtrip') {
    this.tripType = type
    if (type === 'oneway') {
      this.returnDate = ''
    } else if (!this.returnDate) {
      // A round-trip picker needs a valid initial value; the user can choose the
      // exact return date before submitting. No stay-range is inferred or sent.
      const defaultReturn = new Date(`${this.departDate}T00:00:00`)
      defaultReturn.setDate(defaultReturn.getDate() + 7)
      this.returnDate = toDateString(defaultReturn)
    }
  }

  setBudget(min: number, max: number) {
    this.budgetMin = min
    this.budgetMax = max
  }

  setTransferPref(pref: 'any' | 'direct' | 'transfer') {
    this.transferPref = pref
  }

  setTransitCountryPreference(countryCode: string, preference: TransitCountryPreference | 'neutral') {
    const code = countryCode.toUpperCase()
    const next: TransitCountryPreferences = {
      preferred: this.transitCountryPreferences.preferred.filter(item => item !== code),
      excluded: this.transitCountryPreferences.excluded.filter(item => item !== code)
    }
    if (preference !== 'neutral') next[preference === 'preferred' ? 'preferred' : 'excluded'].push(code)
    this.transitCountryPreferences = next
  }

  toggleInterest(interest: Interest) {
    if (this.interests.includes(interest)) {
      this.interests = this.interests.filter(i => i !== interest)
    } else {
      this.interests = [...this.interests, interest]
    }
  }

  get params(): SearchParams {
    return {
      origin: this.origin,
      // Kept as singleton compatibility fields for existing result components.
      // Production flightService submits origin/destination only.
      originCandidates: [this.origin],
      destination: this.destination,
      destinationCandidates: [this.destination],
      departDate: this.departDate,
      ...(this.tripType === 'roundtrip' && this.returnDate ? { returnDate: this.returnDate } : {}),
      tripType: this.tripType,
      budgetRange: [this.budgetMin, this.budgetMax],
      transferPref: this.transferPref,
      transitCountryPreferences: {
        preferred: [...this.transitCountryPreferences.preferred],
        excluded: [...this.transitCountryPreferences.excluded]
      },
      interests: [...this.interests]
    }
  }
}

export const searchStore = new SearchStore()
