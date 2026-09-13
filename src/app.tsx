import { PropsWithChildren } from 'react'
import './app.scss'

function App({ children }: PropsWithChildren<any>) {
  console.info('[FlightOR build]', {
    sha: FLIGHTOR_BUILD_SHA,
    dirty: FLIGHTOR_BUILD_DIRTY,
    sourceFingerprint: FLIGHTOR_BUILD_FINGERPRINT,
    builtAt: FLIGHTOR_BUILD_TIME,
    mode: FLIGHTOR_BUILD_MODE,
    apiBaseUrl: FLIGHTOR_API_BASE_URL
  })
  return children
}

export default App
