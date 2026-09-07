import { goalArtifactRefSchema, goalLocationHandleSchema, goalWorkingSetSchema, type GoalArtifactRef, type GoalLocationHandle, type GoalWorkingSet } from './types.js'

function uniqueById<T extends { id: string }>(values: readonly T[]): T[] {
  const result: T[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value.id)) continue
    seen.add(value.id)
    result.push(value)
  }
  return result
}

export function addArtifactRef(workingSet: GoalWorkingSet, ref: GoalArtifactRef): GoalWorkingSet {
  const next = goalWorkingSetSchema.parse({
    artifactRefs: uniqueById([...workingSet.artifactRefs, goalArtifactRefSchema.parse(ref)]),
    locationHandles: workingSet.locationHandles
  })
  return structuredClone(next)
}

export function addLocationHandle(workingSet: GoalWorkingSet, handle: GoalLocationHandle): GoalWorkingSet {
  const next = goalWorkingSetSchema.parse({
    artifactRefs: workingSet.artifactRefs,
    locationHandles: uniqueById([...workingSet.locationHandles, goalLocationHandleSchema.parse(handle)])
  })
  return structuredClone(next)
}

export function mergeWorkingSet(base: GoalWorkingSet, additions: Partial<GoalWorkingSet>): GoalWorkingSet {
  return goalWorkingSetSchema.parse({
    artifactRefs: uniqueById([...(base.artifactRefs ?? []), ...(additions.artifactRefs ?? [])]),
    locationHandles: uniqueById([...(base.locationHandles ?? []), ...(additions.locationHandles ?? [])])
  })
}
