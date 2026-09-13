const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8')

const artifactCard = read('src/components/artifacts/ArtifactCard.tsx')
const artifactStyles = read('src/components/artifacts/ArtifactCard.scss')
const flightSearch = read('src/components/artifacts/FlightSearchCard.tsx')
const routeWorkspace = read('src/components/route/RouteWorkspace.tsx')
const routeStyles = read('src/components/route/RouteWorkspace.scss')
const flightDetail = read('src/components/route/FlightDetail.tsx')
const researchWorkspace = read('src/components/route/ResearchWorkspace.tsx')

const visibleEnglish = /FLIGHT SEARCH|Flight search results|Open flight explorer|Route details unavailable|Airline not provided|Showing 3|No offer details|YOUR ROUTE|FLIGHT DETAILS|TRAVEL NOTES|Artifact ·/

assert.doesNotMatch([artifactCard, flightSearch, routeWorkspace, flightDetail, researchWorkspace].join('\n'), visibleEnglish)
assert.match(artifactCard, /<Button className='artifact-card__action'/)
assert.match(artifactCard, /ariaLabel=\{actionLabel\}/)
assert.doesNotMatch(artifactCard, /<View className='artifact-card__action'/)
assert.match(artifactStyles, /min-height:\s*88rpx/)
assert.match(artifactStyles, /&__action--pressed/)

for (const source of [routeWorkspace, researchWorkspace]) {
  assert.doesNotMatch(source, /<View[^>]+className=(?:'|\{`)[^>]*route-workspace__action/)
  assert.match(source, /hoverClass='route-workspace__control--pressed'/)
}
assert.match(routeWorkspace, /<Button key=\{r\.id\}[^>]+aria-pressed=/)
assert.match(routeWorkspace, /<Button className=\{`route-workspace__leg[^>]+ariaLabel=/)
assert.match(routeStyles, /postcss-pxtransform disable/)
assert.match(routeStyles, /min-height:\s*44px/)

assert.match(researchWorkspace, /try\s*\{[\s\S]*setClipboardData/)
assert.match(researchWorkspace, /catch\s*\{[\s\S]*复制失败，请稍后重试/)
assert.match(researchWorkspace, /verificationStatusLabel/)
assert.match(researchWorkspace, /复制第 \$\{index \+ 1\} 个资料链接/)

console.log('Route UI polish regression: 18 assertions passed')
