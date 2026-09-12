import { performance } from 'node:perf_hooks';
import { parseResearch } from './contracts.mjs';

const envelopeFields = new Set(['disposition', 'findings', 'uncertainties']);
const findingFields = new Set(['destinationIndex', 'category', 'title', 'summary', 'sourceUrls']);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pointerSegment = key => key.replaceAll('~', '~0').replaceAll('/', '~1');

function finalFencedJson(content) {
  // Accept a single standalone fence at the end, never choose among blocks.
  if ((content.match(/```/g) ?? []).length !== 2) return null;
  const match = /(?:^|\r?\n)[ \t]*```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```[ \t]*$/i.exec(content);
  if (!match) return null;
  // Discard prose only. A prefix containing JSON delimiters is ambiguous and
  // remains invalid rather than selecting a later value or scanning braces.
  if (/[{}\[\]]/.test(content.slice(0, match.index))) return null;
  return match[1];
}

function singleJsonSuffix(content) {
  // Inspect only the first opening brace. The entire remaining suffix must
  // parse once; never retry at another brace or select among JSON values.
  const start = content.indexOf('{');
  if (start < 1) return null;
  const prefix = content.slice(0, start);
  if (!prefix.trim() || /[{}\[\]`]/.test(prefix)) return null;
  try {
    const parsed = JSON.parse(content.slice(start));
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function projectObject(value, allowed, parentPath, droppedPaths) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => {
    if (allowed.has(key)) return true;
    droppedPaths.push(`${parentPath}/${pointerSegment(key)}`);
    return false;
  }));
}

/**
 * Offline structural normalization only; no factual correction or model call.
 * raw always uses the unmodified content and existing parseResearch contract.
 * Transform paths are JSON Pointers to discarded fields (whole subtrees).
 * Known field values, missing fields, array size and ordering are untouched.
 */
export function normalizeResearchResponse(content, testCase, citations = []) {
  const started = performance.now();
  const raw = parseResearch(content, testCase, citations);
  const transforms = [];
  const finish = normalized => ({ raw, normalized, transforms, elapsedMs: performance.now() - started });
  if (raw.valid || typeof content !== 'string') return finish(structuredClone(raw));

  let candidate = content.trim();
  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    const extracted = finalFencedJson(candidate);
    if (extracted === null) {
      parsed = singleJsonSuffix(candidate);
      if (parsed === null) return finish(structuredClone(raw));
      transforms.push({ type: 'extract_single_json_suffix' });
    } else {
      candidate = extracted;
      transforms.push({ type: 'extract_final_fenced_json' });
      try {
        parsed = JSON.parse(candidate);
      } catch {
        return finish(parseResearch(candidate, testCase, citations));
      }
    }
  }

  const paths = [];
  if (isObject(parsed)) {
    parsed = projectObject(parsed, envelopeFields, '', paths);
    if (Array.isArray(parsed.findings)) {
      parsed.findings = parsed.findings.map((finding, index) => isObject(finding)
        ? projectObject(finding, findingFields, `/findings/${index}`, paths)
        : finding);
    }
  }
  if (paths.length) transforms.push({ type: 'drop_unknown_fields', paths });
  return finish(parseResearch(JSON.stringify(parsed), testCase, citations));
}
