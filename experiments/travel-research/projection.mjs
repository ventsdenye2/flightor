/**
 * Project an already validated research artifact without upgrading its evidence.
 * A component artifact has no conversational disposition. Its first destination
 * supplies the scalar index; the complete destinations list remains authoritative
 * for findings that cover multiple cities. Unknown IDs remain explicitly null.
 */
export function normalizeCurrentArtifact(artifact, testCase) {
  const findings = artifact.findings.map(finding => {
    const index = testCase.brief.destinations.findIndex(
      destination => destination.id === finding.destinations[0]?.id
    );
    return {
      destinationIndex: index < 0 ? null : index,
      destinations: structuredClone(finding.destinations),
      title: finding.title,
      summary: finding.summary,
      category: finding.category,
      sourceUrls: finding.sources.map(source => source.url),
      citationLinked: true,
      verification: finding.verification.status,
      warnings: [...finding.warnings],
      sources: structuredClone(finding.sources)
    };
  });
  return {
    valid: true,
    disposition: null,
    findings,
    uncertainties: [
      ...artifact.warnings,
      ...findings.flatMap(finding => finding.warnings.map(
        warning => `候选「${finding.title}」：${warning}`
      ))
    ]
  };
}

// Drop execution labels from structured review data, retaining evidence fields
// (including unverified, unlinkedUrls, source snippets and per-finding warnings).
// Source URLs and substantive response text are preserved, not rewritten to hide
// information that the human reviewer needs to assess the underlying claims.
function reviewCopy(value) {
  if (Array.isArray(value)) return value.map(reviewCopy);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !['model', 'arm', 'trace'].includes(key))
      .map(([key, item]) => [key, reviewCopy(item)]));
  }
  return value;
}

/** Re-project raw artifacts so previously lossy row.result snapshots are ignored. */
export function reviewProjection(row, testCase) {
  const result = row.currentSystem?.artifact
    ? normalizeCurrentArtifact(row.currentSystem.artifact, testCase)
    : row.result;
  return {
    sampleId: row.id,
    case: reviewCopy(testCase),
    content: row.content ?? null,
    findings: result?.findings ? reviewCopy(result.findings) : null,
    uncertainties: reviewCopy(result?.uncertainties ?? []),
    citations: row.citations ? reviewCopy(row.citations) : null,
    status: row.status
  };
}
