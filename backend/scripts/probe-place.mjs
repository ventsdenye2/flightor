import { defaultPlaceResolver } from '../src/place-resolver.mjs'
const resolver = defaultPlaceResolver()
const input = { name: '查理大桥', query: 'Charles Bridge', city: 'Prague' }
console.log(JSON.stringify({ enterpriseConfigured: Boolean(process.env.WIKIMEDIA_ENTERPRISE_ACCESS_TOKEN), localPlaces: resolver.index?.manifest.places }))
for (const operation of ['resolve', 'media']) {
  const start = Date.now()
  try {
    const result = await resolver[operation](input)
    console.log(operation, JSON.stringify(operation === 'resolve' ? { status: result.status, method: result.method, qid: result.place?.qid, latitude: result.place?.latitude, longitude: result.place?.longitude } : result), 'elapsedMs', Date.now() - start)
  }
  catch (error) { console.log(operation, 'failed', error.message, error.cause?.message) }
}
if (process.env.WIKIMEDIA_ENTERPRISE_ACCESS_TOKEN) {
  try {
    const articles = await resolver.http.json('https://api.enterprise.wikimedia.com/v2/structured-contents/Charles%20Bridge', {
      method: 'POST', headers: { authorization: 'Bearer ' + process.env.WIKIMEDIA_ENTERPRISE_ACCESS_TOKEN },
      body: JSON.stringify({ filters: [{ field: 'is_part_of.identifier', value: 'enwiki' }] }), cache: false })
    console.log('enterprise', JSON.stringify(Array.isArray(articles) ? articles.map(article => ({ name: article.name, qid: article.main_entity?.identifier, image: article.image?.content_url, project: article.is_part_of?.identifier })) : { unexpectedResponse: true }))
  } catch (error) { console.log('enterprise failed', error.message, error.cause?.message) }
}
console.log('http', JSON.stringify(resolver.http.metrics))
process.exitCode = 0
