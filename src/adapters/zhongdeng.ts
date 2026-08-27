import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { AttachmentRef, CreateRiskCheckInput, ZhongdengRegistration } from "../core/types.js";

export interface ZhongdengAdapter {
  readonly mode: string;
  queryCustomer(input: CreateRiskCheckInput): Promise<ZhongdengRegistration[]>;
  close?(): Promise<void>;
}

export class MockZhongdengAdapter implements ZhongdengAdapter {
  readonly mode = "mock";
  async queryCustomer(input: CreateRiskCheckInput): Promise<ZhongdengRegistration[]> {
    await new Promise((resolve) => setTimeout(resolve, 450));
    return [
      { id: "zd-1", registrationNo: "202600001818", guaranteeType: "应收账款质押", registrationDate: "2026-03-18", securedParty: "青岛某商业银行股份有限公司", debtorName: input.customerName, unifiedSocialCreditCode: input.unifiedSocialCreditCode, amount: 4_860_000, contractNos: ["HT2026018"], invoiceNos: ["03492133", "03492134"], description: "智能闸口改造项目应收账款，合同编号HT2026018，含设备采购及实施服务。", attachments: [] },
      { id: "zd-2", registrationNo: "202600003031", guaranteeType: "保理", registrationDate: "2026-05-06", securedParty: "山东某商业保理有限公司", debtorName: input.customerName, unifiedSocialCreditCode: input.unifiedSocialCreditCode, amount: 1_180_000, contractNos: [], invoiceNos: [], description: "港区智能闸口系统设备采购及软件实施服务相关应收账款。", attachments: [] },
      { id: "zd-3", registrationNo: "202600004212", guaranteeType: "融资租赁", registrationDate: "2026-06-09", securedParty: "某金融租赁股份有限公司", debtorName: input.customerName, amount: 9_800_000, contractNos: ["LEASE-2026-0088"], invoiceNos: [], description: "装卸设备融资租赁。", attachments: [] },
      { id: "zd-4", registrationNo: "202600005515", guaranteeType: "其他动产和权利担保", registrationDate: "2026-07-11", securedParty: "某资产管理有限公司", debtorName: input.customerName, contractNos: [], invoiceNos: [], attachments: [] },
    ];
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Browser mode requires ${name}`);
  return value;
}

function parseAmount(text?: string): number | undefined {
  if (!text) return undefined;
  const value = Number(text.replace(/[,，￥¥\s]/g, "").match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(value) ? value : undefined;
}

export class BrowserZhongdengAdapter implements ZhongdengAdapter {
  readonly mode = "browser";
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private readonly timeoutMs = Number(process.env.ZD_TIMEOUT_MS || 300_000);

  private async ensureSession(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    this.browser = await chromium.launch({ headless: false });
    this.context = await this.browser.newContext({ acceptDownloads: true });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.timeoutMs);
    await this.page.goto(process.env.ZD_LOGIN_URL || "https://www.zhongdengwang.org.cn/", { waitUntil: "domcontentloaded" });
    if (process.env.ZD_USERNAME_SELECTOR && process.env.ZD_USERNAME) await this.page.locator(process.env.ZD_USERNAME_SELECTOR).fill(process.env.ZD_USERNAME);
    if (process.env.ZD_PASSWORD_SELECTOR && process.env.ZD_PASSWORD) await this.page.locator(process.env.ZD_PASSWORD_SELECTOR).fill(process.env.ZD_PASSWORD);
    console.log("[zhongdeng] 请人工输入验证码并完成登录；本项目不会绕过验证码。");
    await this.page.locator(required("ZD_LOGIN_SUCCESS_SELECTOR")).waitFor({ state: "visible", timeout: this.timeoutMs });
    return this.page;
  }

  async queryCustomer(input: CreateRiskCheckInput): Promise<ZhongdengRegistration[]> {
    const page = await this.ensureSession();
    const rowSelector = required("ZD_RESULT_ROW_SELECTOR");
    const regNoSelector = required("ZD_REG_NO_SELECTOR");
    await page.goto(required("ZD_QUERY_URL"), { waitUntil: "domcontentloaded" });
    await page.locator(required("ZD_CUSTOMER_NAME_SELECTOR")).fill(input.customerName);
    if (process.env.ZD_QUERY_REASON_SELECTOR) await page.locator(process.env.ZD_QUERY_REASON_SELECTOR).fill(input.reason || "业务合作前风险核查").catch(() => undefined);
    console.log(`[zhongdeng] 已预填“${input.customerName}”，请人工输入查询验证码并提交。`);
    await page.locator(process.env.ZD_RESULT_READY_SELECTOR || rowSelector).first().waitFor({ state: "visible", timeout: this.timeoutMs });

    const rows = page.locator(rowSelector);
    const records: ZhongdengRegistration[] = [];
    for (let index = 0; index < await rows.count(); index += 1) {
      const row = rows.nth(index);
      const text = async (selector?: string) => selector ? row.locator(selector).first().innerText().catch(() => undefined) : undefined;
      const registrationNo = (await text(regNoSelector))?.trim();
      if (!registrationNo) continue;
      const attachments: AttachmentRef[] = [];
      if (process.env.ZD_ATTACHMENT_LINK_SELECTOR && this.context) {
        const links = row.locator(process.env.ZD_ATTACHMENT_LINK_SELECTOR);
        for (let j = 0; j < await links.count(); j += 1) {
          const href = await links.nth(j).getAttribute("href");
          if (!href) continue;
          const sourceUrl = new URL(href, page.url()).toString();
          try {
            const response = await this.context.request.get(sourceUrl, { timeout: this.timeoutMs });
            if (!response.ok()) continue;
            const rawName = basename(new URL(sourceUrl).pathname) || `attachment-${j + 1}`;
            const name = rawName.replace(/[\\/:*?"<>|]/g, "_");
            const dir = join(process.env.ATTACHMENT_DIR || "./storage/attachments", registrationNo);
            await mkdir(dir, { recursive: true });
            const path = join(dir, name);
            await writeFile(path, await response.body());
            attachments.push({ id: `${registrationNo}-${j + 1}`, name, path, sourceUrl, mimeType: response.headers()["content-type"] });
          } catch (error) { console.warn("[zhongdeng] attachment download failed", error); }
        }
      }
      records.push({
        id: `zd-${registrationNo}`,
        registrationNo,
        guaranteeType: (await text(process.env.ZD_GUARANTEE_TYPE_SELECTOR))?.trim(),
        registrationDate: (await text(process.env.ZD_REG_DATE_SELECTOR))?.trim(),
        securedParty: (await text(process.env.ZD_SECURED_PARTY_SELECTOR))?.trim(),
        debtorName: input.customerName,
        unifiedSocialCreditCode: input.unifiedSocialCreditCode,
        amount: parseAmount(await text(process.env.ZD_AMOUNT_SELECTOR)),
        contractNos: [], invoiceNos: [],
        description: (await text(process.env.ZD_DESCRIPTION_SELECTOR))?.trim(),
        attachments,
      });
    }
    return records;
  }

  async close() { await this.context?.close().catch(() => undefined); await this.browser?.close().catch(() => undefined); }
}

export function createZhongdengAdapter(): ZhongdengAdapter {
  const mode = (process.env.ZHONGDENG_ADAPTER || "mock").toLowerCase();
  if (mode === "browser") return new BrowserZhongdengAdapter();
  if (mode === "mock") return new MockZhongdengAdapter();
  throw new Error(`Unsupported ZHONGDENG_ADAPTER: ${mode}`);
}
