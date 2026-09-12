// Admission control: reserves survive unknown billing. This is not a provider-enforced account cap.
export const validCost = cost => typeof cost==='number' && Number.isFinite(cost) && cost>=0;
const budgetError=code=>Object.assign(new Error(code),{code});
const validCount = count => Number.isSafeInteger(count) && count >= 0;

// Validate the entire accounting snapshot before changing an active Budget.
// Older snapshots may omit reviewedRejections; they grant no reviewed calls.
export function validateLedger(saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('INVALID_LEDGER');
  const reviewedRejections = saved.reviewedRejections === undefined ? 0 : saved.reviewedRejections;
  if (!validCost(saved.limitUsd) || saved.limitUsd === 0
    || ![saved.knownOpenRouterUsd, saved.reservedUnknownUsd].every(validCost)
    || ![saved.unknownCalls, reviewedRejections, saved.serpApiRequests].every(validCount)
    || reviewedRejections > saved.unknownCalls
    || (saved.maxSerpApiRequests !== undefined && !validCount(saved.maxSerpApiRequests))
    || (saved.serpApiCostUsd !== undefined && saved.serpApiCostUsd !== null && !validCost(saved.serpApiCostUsd))) {
    throw new Error('INVALID_LEDGER');
  }
  return { ...saved, reviewedRejections };
}

export class Budget {
  constructor(limitUsd, reservationUsd = 0.25, maxSearches = 96) {
    if (![limitUsd,reservationUsd].every(x=>Number.isFinite(x)&&x>0) || !validCount(maxSearches)) throw new Error('INVALID_BUDGET');
    this.limitUsd=limitUsd; this.reservationUsd=reservationUsd; this.maxSearches=maxSearches;
    this.knownUsd=0; this.heldUsd=0; this.unknownCalls=0; this.reviewedRejections=0; this.searches=0; this.sequence=0; this.pending=new Set();
  }
  assertAdmission() {
    if(this.unknownCalls>this.reviewedRejections)throw budgetError('BILLING_UNKNOWN_STOP');
    if (this.knownUsd+this.heldUsd+this.reservationUsd > this.limitUsd+1e-9) throw budgetError('BUDGET_EXHAUSTED');
  }
  reserve() {
    this.assertAdmission();
    const id=++this.sequence; this.pending.add(id); this.heldUsd+=this.reservationUsd; return id;
  }
  settle(id, cost, rejectedBeforeGeneration=false) {
    if (!this.pending.delete(id)) throw new Error('UNKNOWN_RESERVATION');
    if (!validCost(cost)) {this.unknownCalls++;if(rejectedBeforeGeneration)this.reviewedRejections++; return;}
    this.heldUsd-=this.reservationUsd; this.knownUsd+=cost;
  }
  reserveSearch() {
    // Searches precede synthesis in the current component. Recheck shared
    // accounting before every external search, including concurrent workers.
    this.assertAdmission();
    if (this.searches>=this.maxSearches) throw budgetError('SEARCH_BUDGET_EXHAUSTED');
    this.searches++;
  }
  restore(saved) {
    const ledger = validateLedger(saved);
    if (ledger.limitUsd!==this.limitUsd) throw new Error('LEDGER_LIMIT_MISMATCH');
    if (this.pending.size) throw new Error('LEDGER_RESTORE_WITH_PENDING');
    this.knownUsd=ledger.knownOpenRouterUsd;this.heldUsd=ledger.reservedUnknownUsd;
    this.unknownCalls=ledger.unknownCalls;this.searches=ledger.serpApiRequests;
    this.reviewedRejections=ledger.reviewedRejections;
  }
  snapshot() { return {limitUsd:this.limitUsd,knownOpenRouterUsd:this.knownUsd,reservedUnknownUsd:this.heldUsd,unknownCalls:this.unknownCalls,reviewedRejections:this.reviewedRejections,
    serpApiRequests:this.searches,serpApiCostUsd:null,maxSerpApiRequests:this.maxSearches,
    capType:'local_admission_reservation_not_provider_hard_cap'}; }
}
