import {describe,it,expect} from 'vitest'
import {placeFailureDetail} from './diagnostics.js'
describe('place failure diagnostics',()=>{
 it('retains available cause and explicitly missing fields without credentials',()=>{
  const error=new Error('fetch failed https://example.test/?key=private token=private',{cause:{code:'UND_ERR_CONNECT_TIMEOUT'}})
  const result=placeFailureDetail(error)
  expect(result.causeCode).toBe('UND_ERR_CONNECT_TIMEOUT')
  expect(result.errCode).toBeNull()
  expect(JSON.stringify(result)).not.toContain('private')
  expect(placeFailureDetail(null)).toEqual({name:null,errMsg:null,errCode:null,causeCode:null})
 })
})
