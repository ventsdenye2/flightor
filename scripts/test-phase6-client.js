import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')
let passed = 0
let failed = 0

function check(name, condition) {
  if (condition) {
    passed += 1
    console.log(`  PASS ${name}`)
  } else {
    failed += 1
    console.log(`  FAIL ${name}`)
  }
}

const config = read('src', 'app.config.ts')
const plan = read('src', 'pages', 'plan', 'index.tsx')
const planner = read('src', 'features', 'ui-experience', 'PlannerPage.tsx')
const explorer = read('src', 'pages', 'search', 'index.tsx')
const discovery = read('src', 'pages', 'explore', 'index.tsx')
const home = read('src', 'pages', 'index', 'index.tsx')
const productionNav = read('src', 'components', 'navigation', 'ProductionTabBar.tsx')
const hubDetail = read('src', 'subpages', 'hub-detail', 'index.tsx')
const flightService = read('src', 'services', 'flightService.ts')
const flightStore = read('src', 'stores', 'flightStore.ts')
const searchStore = read('src', 'stores', 'searchStore.ts')
const chatStore = read('src', 'stores', 'chatStore.ts')
const userStore = read('src', 'stores', 'userStore.ts')
const authService = read('src', 'services', 'authService.ts')
const backendRoute = read('backend', 'src', 'routes', 'flight-searches.ts')

const tabPaths = [...config.matchAll(/pagePath:\s*'([^']+)'/g)].map(match => match[1])
check('primary tabs are Plan, Explore, Trips, Profile', JSON.stringify(tabPaths) === JSON.stringify([
  'pages/plan/index', 'pages/explore/index', 'pages/trips/index', 'pages/profile/index'
]))
check('custom tab bar maps exactly to the four production tabs and swaps active icons', ['plan', 'explore', 'trips', 'profile'].every(id => productionNav.includes(`{ id: '${id}'`)) && productionNav.includes('activeIcon') && productionNav.includes('active === tab.id ? tab.activeIcon : tab.icon') && productionNav.includes('Taro.switchTab'))
check('Plan derives its pending trip from server Trip Context', plan.includes('chatStore.tripContextSummary?.destinations.required') && plan.includes('chatStore.tripContextSummary?.travelDays'))
check('Plan has one Agent-backed Planner authority', plan.includes('<PlannerPage') && plan.includes('onSubmitPrompt=') && plan.includes('chatStore.send(message, locale)') && !plan.includes('AgentChat') && !plan.includes('planTrip(') && !/from ['"][^'"]*flightStore/.test(plan))
check('Plan clears a stale load error before accepting a new Artifact result', plan.indexOf("setProductionError('')") < plan.indexOf('loadProductionTrip(productionRef.id') && plan.includes("setProductionResult({ key: resultKey, trip: value.presentation }); setProductionError('')"))
check('Planner hides placeholder samples and unsupported cancellation', planner.includes('const hasReferenceTrip = Boolean(') && planner.includes('const visibleSuggestions = hasReferenceTrip ? suggestions : suggestions.filter(item => item.prompt)') && planner.includes('(!production || onCancelProduction)'))
check('legacy UnderstandingPanel is removed', !plan.includes('UnderstandingPanel') && !plan.includes("../../mocks/airports"))
check('Plan opens the latest route or travel guide ArtifactRef', plan.includes('lastTurn?.artifactRefs') && plan.includes("ref.type === 'travel_guide'") && plan.includes("ref.type === 'route'") && plan.includes('loadProductionTrip(productionRef.id'))
check('manual search prepares the same cloud Trip/Conversation', flightStore.includes('chatStore.prepareCloudSession') && flightService.includes('tripId: session.tripId') && flightService.includes('conversationId: session.conversationId'))
check('manual search stores and fetches an Artifact by ID', flightService.includes("url: '/v1/flight-searches'") && flightService.includes('artifactService.fetchArtifact'))
check('manual search retries safely with an idempotency key', flightService.includes("header: { 'Idempotency-Key'") && backendRoute.includes('requiredIdempotencyKey') && backendRoute.includes('idempotency.run'))
check('backend manual path is authenticated and owner scoped', backendRoute.includes('authenticateRequest') && backendRoute.includes('conversation.tripId !== trip.id'))
check('backend manual and Agent paths share the fare service', backendRoute.includes('executeFlightSearch') && read('backend', 'src', 'agent', 'tools', 'core.ts').includes('executeFlightSearch'))
check('Flight Explorer can reopen an Artifact URL', explorer.includes('router.params.artifactId') && explorer.includes('flightStore.loadArtifact'))
check('Flight Explorer shows failure before empty results and offers retry', explorer.indexOf('flightStore.error ?') < explorer.indexOf('options.length === 0') && explorer.includes('retryLastSearch'))
check('Hub detail opens the non-tab flight search with navigateTo', hubDetail.includes("Taro.navigateTo({ url: '/pages/index/index' })") && !hubDetail.includes("Taro.switchTab({ url: '/pages/index/index' })"))
check('late flight responses and logout state are invalidated', flightStore.includes('requestGeneration') && flightStore.includes('isCurrent(') && flightStore.includes('registerUserSessionClearHandler') && userStore.includes('clearUserSessionState(ownerId)'))
check('late login cannot restore credentials after logout', userStore.includes('authGeneration') && userStore.includes('requestId !== this.authGeneration') && userStore.includes('clearAuthTokens()') && authService.includes('persistTokens !== false'))
check('Flight Explorer consults the renderer registry before adapting payloads', flightStore.includes('resolveArtifactRenderer(artifact)'))
check('conversation turns keep only refs created by that response', chatStore.includes('const turnArtifactRefs = result.artifactRefs.map') && chatStore.includes('artifactRefs: turnArtifactRefs'))
check('manual production search uses one exact airport pair and optional exact return date', !/mocks\/airports/.test(searchStore) && searchStore.includes('returnDate') && !searchStore.includes('stayRange:') && !searchStore.includes('originExtras'))
check('Phase 6 production entry points do not import mock catalogs', [plan, explorer, discovery, home, searchStore].every(source => !/from ['"][^'"]*mocks\//.test(source)))

console.log(`\nPhase 6 client contract: ${passed}/${passed + failed} passed`)
if (failed > 0) process.exitCode = 1
