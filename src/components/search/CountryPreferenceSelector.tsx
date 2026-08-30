import { useState } from 'react'
import { View, Text, Input, ScrollView } from '@tarojs/components'
import { observer } from 'mobx-react-lite'
import { TRANSFER_COUNTRIES, countryName, findCountry, searchCountries, type Country } from '../../mocks/countries'
import type { TransitCountryPreference, TransitCountryPreferences } from '../../types/flight'
import { localeStore, t } from '../../i18n'
import './CountryPreferenceSelector.scss'

interface CountryPreferenceSelectorProps {
  visible: boolean
  preferences: TransitCountryPreferences
  onChange: (countryCode: string, preference: TransitCountryPreference | 'neutral') => void
  onClose: () => void
}

const OPTIONS: Array<{ value: TransitCountryPreference | 'neutral'; label: string }> = [
  { value: 'neutral', label: 'countryPref.neutral' },
  { value: 'preferred', label: 'countryPref.preferred' },
  { value: 'excluded', label: 'countryPref.excluded' }
]

function preferenceOf(code: string, preferences: TransitCountryPreferences): TransitCountryPreference | 'neutral' {
  if (preferences.preferred.includes(code)) return 'preferred'
  if (preferences.excluded.includes(code)) return 'excluded'
  return 'neutral'
}

function airportSummary(country: Country): string {
  const codes = country.airports.map(airport => airport.iata)
  const visible = codes.slice(0, 4).join(' · ')
  return codes.length > 4 ? `${visible} +${codes.length - 4}` : visible
}

function CountryPreferenceSelector({ visible, preferences, onChange, onClose }: CountryPreferenceSelectorProps) {
  const [query, setQuery] = useState('')
  const locale = localeStore.locale
  if (!visible) return null

  const isSearching = query.trim().length > 0
  const countries = isSearching ? searchCountries(query) : TRANSFER_COUNTRIES
  const selectedCountries = [...preferences.preferred, ...preferences.excluded]
    .map(code => findCountry(code))
    .filter((country): country is Country => Boolean(country))
  const handleClose = () => {
    setQuery('')
    onClose()
  }

  return (
    <View className='country-pref-selector' catchMove>
      <View className='country-pref-selector__mask' onClick={handleClose} />
      <View className='country-pref-selector__sheet'>
        <View className='country-pref-selector__header'>
          <View>
            <Text className='country-pref-selector__title'>{t('countryPref.title')}</Text>
            <Text className='country-pref-selector__subtitle'>{t('countryPref.subtitle')}</Text>
          </View>
          <View className='country-pref-selector__close' hoverClass='tap-dim' onClick={handleClose}>
            <Text>✕</Text>
          </View>
        </View>

        <View className='country-pref-selector__search'>
          <Text className='country-pref-selector__search-icon'>⌕</Text>
          <Input
            className='country-pref-selector__input'
            value={query}
            placeholder={t('countryPref.searchPlaceholder')}
            placeholderClass='country-pref-selector__placeholder'
            confirmType='search'
            onInput={event => setQuery(event.detail.value)}
          />
          {query.length > 0 && (
            <View className='country-pref-selector__clear' hoverClass='tap-dim' onClick={() => setQuery('')}>
              <Text>✕</Text>
            </View>
          )}
        </View>

        {selectedCountries.length > 0 && (
          <View className='country-pref-selector__selected'>
            <Text className='country-pref-selector__section-title'>{t('countryPref.selected')}</Text>
            <View className='country-pref-selector__selected-chips'>
              {selectedCountries.map(country => {
                const preference = preferenceOf(country.code, preferences)
                return (
                  <View key={country.code} className={`country-pref-selector__selected-chip is-${preference}`}>
                    <Text>{preference === 'preferred' ? '↑ ' : '× '}{countryName(country, locale)}</Text>
                  </View>
                )
              })}
            </View>
          </View>
        )}

        <Text className='country-pref-selector__section-title'>
          {isSearching ? t('countryPref.results') : t('countryPref.hot')}
        </Text>

        <ScrollView className='country-pref-selector__list' scrollY enhanced showScrollbar={false}>
          {countries.map(country => {
            const selected = preferenceOf(country.code, preferences)
            return (
              <View key={country.code} className='country-pref-selector__row'>
                <View className='country-pref-selector__country'>
                  <Text className='country-pref-selector__country-name'>{countryName(country, locale)}</Text>
                  <Text className='country-pref-selector__airports'>
                    {airportSummary(country)}
                  </Text>
                </View>
                <View className='country-pref-selector__options'>
                  {OPTIONS.map(option => (
                    <View
                      key={option.value}
                      className={`country-pref-selector__option is-${option.value} ${selected === option.value ? 'is-active' : ''}`}
                      hoverClass='tap-dim'
                      onClick={() => onChange(country.code, option.value)}
                    >
                      <Text>{t(option.label)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )
          })}
          {countries.length === 0 && (
            <View className='country-pref-selector__empty'>
              <Text>{t('countryPref.noResults')}</Text>
            </View>
          )}
          <View className='country-pref-selector__pad' />
        </ScrollView>
      </View>
    </View>
  )
}

export default observer(CountryPreferenceSelector)
