import type { CheckSummary, MatchedRegistration } from "./types.js";

export function summarize(records: MatchedRegistration[]): CheckSummary {
  const summary: CheckSummary = { total: records.length, exact: 0, high: 0, possible: 0, none: 0, insufficient: 0 };
  for (const record of records) {
    switch (record.match.level) {
      case "EXACT": summary.exact += 1; break;
      case "HIGH": summary.high += 1; break;
      case "POSSIBLE": summary.possible += 1; break;
      case "NONE": summary.none += 1; break;
      case "INSUFFICIENT": summary.insufficient += 1; break;
    }
  }
  return summary;
}
