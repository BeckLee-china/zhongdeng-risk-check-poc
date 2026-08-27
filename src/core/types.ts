export type MatchLevel = "EXACT" | "HIGH" | "POSSIBLE" | "NONE" | "INSUFFICIENT";
export type JobStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export interface AttachmentRef {
  id: string;
  name: string;
  mimeType?: string;
  path?: string;
  sourceUrl?: string;
  parsed?: ParsedBusinessFields;
}

export interface ParsedBusinessFields {
  contractNos: string[];
  invoiceNos: string[];
  amounts: number[];
  dates: string[];
  customerNames: string[];
  descriptions: string[];
  rawText?: string;
  needsOcr?: boolean;
}

export interface ZhongdengRegistration {
  id: string;
  registrationNo: string;
  guaranteeType?: string;
  registrationDate?: string;
  securedParty?: string;
  debtorName: string;
  unifiedSocialCreditCode?: string;
  amount?: number;
  contractNos: string[];
  invoiceNos: string[];
  description?: string;
  attachments: AttachmentRef[];
  sourceUrl?: string;
  raw?: Record<string, unknown>;
}

export interface InternalDocument {
  id: string;
  type: "CONTRACT" | "INVOICE" | "OTHER";
  documentNo: string;
  customerName: string;
  unifiedSocialCreditCode?: string;
  contractNo?: string;
  invoiceNo?: string;
  amount?: number;
  date?: string;
  counterparty?: string;
  description?: string;
  sourceUrl?: string;
}

export interface MatchEvidence {
  field: string;
  weight: number;
  detail: string;
  internalDocumentId?: string;
}

export interface MatchResult {
  level: MatchLevel;
  score: number;
  matchedDocumentIds: string[];
  evidence: MatchEvidence[];
}

export interface MatchedRegistration extends ZhongdengRegistration {
  match: MatchResult;
}

export interface CheckSummary {
  total: number;
  exact: number;
  high: number;
  possible: number;
  none: number;
  insufficient: number;
}

export interface RiskCheckJob {
  id: string;
  customerName: string;
  unifiedSocialCreditCode?: string;
  reason: string;
  status: JobStatus;
  sourceMode: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  summary?: CheckSummary;
  records: MatchedRegistration[];
  errors: string[];
}

export interface CreateRiskCheckInput {
  customerName: string;
  unifiedSocialCreditCode?: string;
  reason?: string;
  needCertificate?: boolean;
}
