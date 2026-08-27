import type { InternalDocument } from "../core/types.js";

export interface InternalDataAdapter {
  readonly mode: string;
  findByCustomer(customerName: string, unifiedSocialCreditCode?: string): Promise<InternalDocument[]>;
}

export class MockInternalDataAdapter implements InternalDataAdapter {
  readonly mode = "mock";
  async findByCustomer(customerName: string, unifiedSocialCreditCode?: string): Promise<InternalDocument[]> {
    return [
      { id: "int-contract-1", type: "CONTRACT", documentNo: "HT2026018", contractNo: "HT2026018", customerName, unifiedSocialCreditCode, amount: 4_860_000, date: "2026-03-18", counterparty: "青岛某商业银行股份有限公司", description: "智能闸口改造项目设备采购及实施服务" },
      { id: "int-invoice-1", type: "INVOICE", documentNo: "03492133", invoiceNo: "03492133", contractNo: "HT2026018", customerName, unifiedSocialCreditCode, amount: 2_430_000, date: "2026-03-18", description: "智能闸口改造项目设备采购及实施服务" },
      { id: "int-invoice-2", type: "INVOICE", documentNo: "03492134", invoiceNo: "03492134", contractNo: "HT2026018", customerName, unifiedSocialCreditCode, amount: 2_430_000, date: "2026-03-18", description: "智能闸口改造项目设备采购及实施服务" },
      { id: "int-contract-2", type: "CONTRACT", documentNo: "HT2026031", contractNo: "HT2026031", customerName, unifiedSocialCreditCode, amount: 1_180_000, date: "2026-05-02", counterparty: "山东某商业保理有限公司", description: "港区智能闸口系统设备采购及软件实施服务" },
    ];
  }
}

export class HttpInternalDataAdapter implements InternalDataAdapter {
  readonly mode = "http";
  async findByCustomer(customerName: string, unifiedSocialCreditCode?: string): Promise<InternalDocument[]> {
    const base = process.env.INTERNAL_API_BASE;
    if (!base) throw new Error("INTERNAL_API_BASE is required when INTERNAL_ADAPTER=http");
    const url = new URL("documents", base.endsWith("/") ? base : `${base}/`);
    url.searchParams.set("customerName", customerName);
    if (unifiedSocialCreditCode) url.searchParams.set("unifiedSocialCreditCode", unifiedSocialCreditCode);
    const headers: Record<string, string> = { accept: "application/json" };
    if (process.env.INTERNAL_API_TOKEN) headers.authorization = `Bearer ${process.env.INTERNAL_API_TOKEN}`;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Internal API failed: ${response.status} ${response.statusText}`);
    const payload = await response.json();
    if (Array.isArray(payload)) return payload as InternalDocument[];
    if (payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)) return (payload as { data: InternalDocument[] }).data;
    throw new Error("Internal API response must be an array or { data: [] }");
  }
}

export function createInternalAdapter(): InternalDataAdapter {
  const mode = (process.env.INTERNAL_ADAPTER || "mock").toLowerCase();
  if (mode === "http") return new HttpInternalDataAdapter();
  if (mode === "mock") return new MockInternalDataAdapter();
  throw new Error(`Unsupported INTERNAL_ADAPTER: ${mode}`);
}
