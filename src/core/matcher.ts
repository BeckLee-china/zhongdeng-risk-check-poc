import type { InternalDocument, MatchEvidence, MatchLevel, MatchResult, ZhongdengRegistration } from "./types.js";
import { almostEqualAmount, dateDistanceDays, diceSimilarity, normalizeIdentifier, normalizeText, sameIdentifier } from "../lib/text.js";

function addEvidence(list: MatchEvidence[], field: string, weight: number, detail: string, internalDocumentId?: string) {
  list.push({ field, weight, detail, internalDocumentId });
}

function classify(score: number, hasUsefulData: boolean, hasStrongIdentifier: boolean): MatchLevel {
  if (!hasUsefulData) return "INSUFFICIENT";
  if (hasStrongIdentifier || score >= 90) return "EXACT";
  if (score >= 70) return "HIGH";
  if (score >= 40) return "POSSIBLE";
  return "NONE";
}

export function matchRegistration(registration: ZhongdengRegistration, documents: InternalDocument[]): MatchResult {
  let bestScore = 0;
  let bestStrongIdentifier = false;
  let bestEvidence: MatchEvidence[] = [];
  let bestDocumentIds: string[] = [];

  for (const doc of documents) {
    let score = 0;
    let strongIdentifier = false;
    const evidence: MatchEvidence[] = [];

    if (registration.contractNos.some((no) => sameIdentifier(no, doc.contractNo))) {
      score += 55;
      strongIdentifier = true;
      addEvidence(evidence, "contractNo", 55, `合同编号一致：${doc.contractNo}`, doc.id);
    }
    if (registration.invoiceNos.some((no) => sameIdentifier(no, doc.invoiceNo))) {
      score += 60;
      strongIdentifier = true;
      addEvidence(evidence, "invoiceNo", 60, `发票号码一致：${doc.invoiceNo}`, doc.id);
    }
    if (registration.unifiedSocialCreditCode && doc.unifiedSocialCreditCode && sameIdentifier(registration.unifiedSocialCreditCode, doc.unifiedSocialCreditCode)) {
      score += 20;
      addEvidence(evidence, "uscc", 20, "统一社会信用代码一致", doc.id);
    } else if (normalizeText(registration.debtorName) === normalizeText(doc.customerName)) {
      score += 15;
      addEvidence(evidence, "customerName", 15, "客户法定名称一致", doc.id);
    }
    if (almostEqualAmount(registration.amount, doc.amount)) {
      score += 15;
      addEvidence(evidence, "amount", 15, `金额一致：${registration.amount}`, doc.id);
    }
    const dateDays = dateDistanceDays(registration.registrationDate, doc.date);
    if (dateDays != null && dateDays <= 7) {
      score += 5;
      addEvidence(evidence, "date", 5, `日期相差 ${Math.round(dateDays)} 天`, doc.id);
    }
    const descriptionSimilarity = diceSimilarity(registration.description, doc.description);
    if (descriptionSimilarity >= 0.72) {
      const weight = descriptionSimilarity >= 0.9 ? 15 : 10;
      score += weight;
      addEvidence(evidence, "description", weight, `业务描述相似度 ${(descriptionSimilarity * 100).toFixed(0)}%`, doc.id);
    }
    const partySimilarity = diceSimilarity(registration.securedParty, doc.counterparty);
    if (partySimilarity >= 0.85) {
      score += 10;
      addEvidence(evidence, "counterparty", 10, "交易对方/权利人名称高度相似", doc.id);
    }

    score = Math.min(100, score);
    if (score > bestScore) {
      bestScore = score;
      bestStrongIdentifier = strongIdentifier;
      bestEvidence = evidence;
      bestDocumentIds = [doc.id];
    } else if (score === bestScore && score > 0) {
      bestDocumentIds.push(doc.id);
    }
  }

  const hasUsefulData = Boolean(registration.contractNos.length || registration.invoiceNos.length || registration.amount != null || registration.description || registration.securedParty);
  return {
    level: classify(bestScore, hasUsefulData, bestStrongIdentifier),
    score: bestScore,
    matchedDocumentIds: [...new Set(bestDocumentIds)],
    evidence: bestEvidence,
  };
}

export function normalizeRegistrationIdentifiers(registration: ZhongdengRegistration): ZhongdengRegistration {
  return {
    ...registration,
    contractNos: [...new Set(registration.contractNos.map(normalizeIdentifier).filter(Boolean))],
    invoiceNos: [...new Set(registration.invoiceNos.map(normalizeIdentifier).filter(Boolean))],
  };
}
