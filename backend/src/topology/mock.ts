import {
  topologyQueryInputSchema,
  topologyQueryResultSchema,
  type TopologyQueryResult,
  type TopologyRepository
} from './repository.js'

export class MockTopologyRepository implements TopologyRepository {
  readonly calls: unknown[] = []
  constructor(private readonly result: TopologyQueryResult | Error) {}

  async findCandidates(input: Parameters<TopologyRepository['findCandidates']>[0]): Promise<TopologyQueryResult> {
    const parsed = topologyQueryInputSchema.parse(input)
    this.calls.push(structuredClone(parsed))
    if (this.result instanceof Error) throw this.result
    return topologyQueryResultSchema.parse(structuredClone(this.result))
  }
}
