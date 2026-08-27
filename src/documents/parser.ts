import { extname } from "node:path";
import { readFile } from "node:fs/promises";
import pdfParse from "pdf-parse";
import * as XLSX from "xlsx";
import type { ParsedBusinessFields, ZhongdengRegistration } from "../core/types.js";

function uniq<T>(items: T[]): T[] { return [...new Set(items)]; }

export function extractBusinessFields(text: string): ParsedBusinessFields {
  const contractNos: string[] = [], invoiceNos: string[] = [], amounts: number[] = [], dates: string[] = [], customerNames: string[] = [], descriptions: string[] = [];
  for (const pattern of [/(?:合同|协议)(?:编号|号码|号)?\s*[：:]?\s*([A-Z0-9][A-Z0-9._\-/]{4,40})/gi, /\b(HT[A-Z0-9._\-/]{4,40})\b/gi]) {
    for (const match of text.matchAll(pattern)) if (match[1]) contractNos.push(match[1].toUpperCase());
  }
  for (const pattern of [/(?:发票)(?:编号|号码|号)?\s*[：:]?\s*([0-9A-Z]{6,30})/gi, /(?:票号)\s*[：:]?\s*([0-9A-Z]{6,30})/gi]) {
    for (const match of text.matchAll(pattern)) if (match[1]) invoiceNos.push(match[1].toUpperCase());
  }
  for (const match of text.matchAll(/(?:金额|价税合计|合同金额|应收账款金额)\s*[：:]?\s*[￥¥]?\s*([0-9][0-9,，]*(?:\.\d{1,2})?)/g)) {
    const value = Number(match[1]?.replace(/[,，\s]/g, "")); if (Number.isFinite(value)) amounts.push(value);
  }
  for (const match of text.matchAll(/\b(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?\b/g)) if (match[1] && match[2] && match[3]) dates.push(`${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`);
  for (const match of text.matchAll(/(?:客户|债务人|买方|付款方|购货方)(?:名称)?\s*[：:]\s*([^\n\r，,；;]{4,60})/g)) if (match[1]) customerNames.push(match[1].trim());
  const compact = text.replace(/\s+/g, " ").trim(); if (compact) descriptions.push(compact.slice(0, 800));
  return { contractNos: uniq(contractNos), invoiceNos: uniq(invoiceNos), amounts: uniq(amounts), dates: uniq(dates), customerNames: uniq(customerNames), descriptions, rawText: text.slice(0, 20_000) };
}

async function ocr(buffer: Buffer, mimeType: string): Promise<string | null> {
  const endpoint = process.env.OCR_HTTP_ENDPOINT; if (!endpoint) return null;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.OCR_HTTP_TOKEN) headers.authorization = `Bearer ${process.env.OCR_HTTP_TOKEN}`;
  const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ mimeType, dataBase64: buffer.toString("base64") }), signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`OCR endpoint failed: ${response.status}`);
  return ((await response.json()) as { text?: string }).text ?? null;
}

export async function parseAttachment(path: string, mimeType = ""): Promise<ParsedBusinessFields> {
  const ext = extname(path).toLowerCase(), buffer = await readFile(path);
  if ([".txt", ".csv", ".json", ".md", ".html", ".htm"].includes(ext)) return extractBusinessFields(buffer.toString("utf8"));
  if ([".xlsx", ".xls"].includes(ext)) {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    return extractBusinessFields(workbook.SheetNames.map((name) => workbook.Sheets[name] ? XLSX.utils.sheet_to_csv(workbook.Sheets[name]) : "").join("\n"));
  }
  if (ext === ".pdf" || mimeType === "application/pdf") return extractBusinessFields((await pdfParse(buffer)).text || "");
  if ([".png", ".jpg", ".jpeg", ".webp", ".bmp"].includes(ext) || mimeType.startsWith("image/")) {
    const text = await ocr(buffer, mimeType || "application/octet-stream");
    return text ? extractBusinessFields(text) : { contractNos: [], invoiceNos: [], amounts: [], dates: [], customerNames: [], descriptions: [], needsOcr: true };
  }
  return extractBusinessFields(buffer.toString("utf8"));
}

export async function enrichRegistrationFromAttachments(registration: ZhongdengRegistration): Promise<ZhongdengRegistration> {
  const attachments = [];
  for (const attachment of registration.attachments) {
    let parsed = attachment.parsed;
    if (!parsed && attachment.path) { try { parsed = await parseAttachment(attachment.path, attachment.mimeType); } catch (error) { console.warn(`[document-parser] ${attachment.name}`, error); } }
    attachments.push({ ...attachment, parsed });
    if (parsed) {
      registration.contractNos.push(...parsed.contractNos);
      registration.invoiceNos.push(...parsed.invoiceNos);
      registration.amount ??= parsed.amounts[0];
      registration.description ||= parsed.descriptions[0];
    }
  }
  return { ...registration, contractNos: uniq(registration.contractNos), invoiceNos: uniq(registration.invoiceNos), attachments };
}
