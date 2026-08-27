import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import * as XLSX from "xlsx";
import type { CreateRiskCheckInput, ZhongdengRegistration } from "../core/types.js";

export type ZhongdengSessionState = "mock" | "not_opened" | "login_required" | "authenticated";

export interface ZhongdengSessionStatus {
  supported: boolean;
  state: ZhongdengSessionState;
  authenticated: boolean;
  browserOpen: boolean;
  url?: string;
  message: string;
}

export interface ZhongdengAdapter {
  readonly mode: string;
  queryCustomer(input: CreateRiskCheckInput): Promise<ZhongdengRegistration[]>;
  getSessionStatus?(): Promise<ZhongdengSessionStatus>;
  startLogin?(): Promise<ZhongdengSessionStatus>;
  close?(): Promise<void>;
}

export class MockZhongdengAdapter implements ZhongdengAdapter {
  readonly mode = "mock";

  async getSessionStatus(): Promise<ZhongdengSessionStatus> {
    return { supported: false, state: "mock", authenticated: true, browserOpen: false, message: "开发 Mock 模式，不访问中登网" };
  }

  async startLogin(): Promise<ZhongdengSessionStatus> { return this.getSessionStatus(); }

  async queryCustomer(input: CreateRiskCheckInput): Promise<ZhongdengRegistration[]> {
    await new Promise((resolve) => setTimeout(resolve, 450));
    return [
      { id: "zd-1", registrationNo: "202600001818", guaranteeType: "应收账款质押", registrationDate: "2026-03-18", securedParty: "青岛某商业银行股份有限公司", debtorName: input.customerName, unifiedSocialCreditCode: input.unifiedSocialCreditCode, amount: 4_860_000, contractNos: ["HT2026018"], invoiceNos: ["03492133", "03492134"], description: "智能闸口改造项目应收账款，合同编号HT2026018。", attachments: [] },
    ];
  }
}

function parseAmount(text?: string): number | undefined {
  if (!text) return undefined;
  const value = Number(text.replace(/[,，￥¥\s]/g, "").match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(value) ? value : undefined;
}

function normalizeHeader(value: unknown): string {
  return String(value ?? "").replace(/[\s：:（）()]/g, "").toLowerCase();
}

function findValue(raw: Record<string, unknown>, aliases: string[]): string | undefined {
  const normalizedAliases = aliases.map(normalizeHeader);
  for (const [key, value] of Object.entries(raw)) {
    const normalizedKey = normalizeHeader(key);
    if (normalizedAliases.some((alias) => normalizedKey.includes(alias))) {
      const text = String(value ?? "").trim();
      if (text) return text;
    }
  }
  return undefined;
}

export function parseQueryCount(text: string): number | undefined {
  const match = text.match(/共查询到登记\s*(\d+)\s*笔/);
  return match?.[1] ? Number(match[1]) : undefined;
}

export function parseRegistrationWorkbook(buffer: Buffer, input: CreateRiskCheckInput): ZhongdengRegistration[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const records: ZhongdengRegistration[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
    const headerIndex = rows.findIndex((row) => Array.isArray(row) && row.some((cell) => /登记.*编号|证明.*编号/.test(String(cell))));
    if (headerIndex < 0) continue;
    const headers = (rows[headerIndex] || []).map((cell) => String(cell ?? "").trim());
    for (const row of rows.slice(headerIndex + 1)) {
      if (!Array.isArray(row) || !row.some((cell) => String(cell ?? "").trim())) continue;
      const raw: Record<string, unknown> = {};
      headers.forEach((header, index) => { if (header) raw[header] = row[index]; });
      const registrationNo = findValue(raw, ["登记证明编号", "登记编号", "证明编号"]);
      if (!registrationNo) continue;
      const amountText = findValue(raw, ["金额", "担保金额", "融资金额"]);
      records.push({
        id: `zd-${registrationNo}`,
        registrationNo,
        guaranteeType: findValue(raw, ["登记类型", "担保类型", "业务类型", "登记种类"]),
        registrationDate: findValue(raw, ["登记时间", "登记日期"]),
        securedParty: findValue(raw, ["担保权人", "质权人", "债权人"]),
        debtorName: findValue(raw, ["担保人", "出质人", "承租人"]) || input.customerName,
        unifiedSocialCreditCode: input.unifiedSocialCreditCode,
        amount: parseAmount(amountText),
        contractNos: [],
        invoiceNos: [],
        description: findValue(raw, ["担保财产描述", "财产描述", "担保财产概况", "财产概况"]),
        attachments: [],
        raw,
      });
    }
  }
  return records;
}

function officialReason(value?: string): string {
  const options = ["交易前调查", "交易中监测", "交易后管理", "破产事务管理", "业务纠纷", "其他合法目的"];
  return value && options.includes(value) ? value : "交易前调查";
}

async function inputAfterLabel(page: Page, label: string): Promise<Locator> {
  const exact = page.getByText(label, { exact: true }).first();
  if (await exact.count()) return exact.locator("xpath=following::input[1]");
  return page.getByText(label, { exact: false }).first().locator("xpath=following::input[1]");
}

export class BrowserZhongdengAdapter implements ZhongdengAdapter {
  readonly mode = "browser";
  private context?: BrowserContext;
  private page?: Page;
  private opening?: Promise<Page>;
  private readonly timeoutMs = Number(process.env.ZD_TIMEOUT_MS || 600_000);
  private readonly loginUrl = process.env.ZD_LOGIN_URL || "https://www.zhongdengwang.org.cn/";
  private readonly queryUrl = process.env.ZD_QUERY_URL || "https://www.zhongdengwang.org.cn/out/?#/query/guarantor/";
  private readonly profileDir = process.env.ZD_PROFILE_DIR || "./data/zhongdeng-profile";

  private async launchBrowser(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    if (this.opening) return this.opening;
    this.opening = (async () => {
      await mkdir(this.profileDir, { recursive: true });
      const channel = process.env.ZD_BROWSER_CHANNEL?.trim() || undefined;
      const options = { headless: false, acceptDownloads: true, channel, viewport: null as null };
      try {
        this.context = await chromium.launchPersistentContext(this.profileDir, options);
      } catch (error) {
        if (!channel) throw error;
        console.warn(`[zhongdeng] 无法启动浏览器 channel=${channel}，回退到 Playwright Chromium。`);
        this.context = await chromium.launchPersistentContext(this.profileDir, { ...options, channel: undefined });
      }
      this.context.setDefaultTimeout(this.timeoutMs);
      this.context.on("page", (page) => { this.page = page; });
      this.page = this.context.pages()[0] || await this.context.newPage();
      return this.page;
    })();
    try { return await this.opening; } finally { this.opening = undefined; }
  }

  private async isAuthenticated(page: Page): Promise<boolean> {
    if (page.isClosed() || !page.url().includes("/out/")) return false;
    const logout = await page.getByText("退出", { exact: true }).last().isVisible().catch(() => false);
    const queryEntry = await page.getByText("查询入口", { exact: true }).last().isVisible().catch(() => false);
    return logout || queryEntry;
  }

  async getSessionStatus(): Promise<ZhongdengSessionStatus> {
    if (!this.page || this.page.isClosed()) {
      return { supported: true, state: "not_opened", authenticated: false, browserOpen: false, message: "尚未打开中登登录浏览器" };
    }
    const authenticated = await this.isAuthenticated(this.page);
    return {
      supported: true,
      state: authenticated ? "authenticated" : "login_required",
      authenticated,
      browserOpen: true,
      url: this.page.url(),
      message: authenticated ? "中登网已登录，可以发起真实查询" : "请在浏览器中完成账号、校验码和短信动态码登录",
    };
  }

  async startLogin(): Promise<ZhongdengSessionStatus> {
    const page = await this.launchBrowser();
    if (!(await this.isAuthenticated(page))) await page.goto(this.loginUrl, { waitUntil: "domcontentloaded" });
    await page.bringToFront();
    console.log("[zhongdeng] 请在打开的浏览器中人工完成登录。登录校验码与短信动态码不会被自动识别或绕过。");
    return this.getSessionStatus();
  }

  private async selectReason(page: Page, reason: string): Promise<void> {
    const selector = process.env.ZD_QUERY_REASON_SELECTOR;
    if (selector) await page.locator(selector).click();
    else await (await inputAfterLabel(page, "查询原因")).click();
    await page.getByText(reason, { exact: true }).last().click();
  }

  private async selectNeedCertificate(page: Page, needCertificate: boolean): Promise<void> {
    const selector = process.env.ZD_NEED_CERTIFICATE_SELECTOR;
    if (selector) { await page.locator(selector).click(); return; }
    const label = page.getByText("是否需要查询证明", { exact: false }).first();
    const value = needCertificate ? "是" : "否";
    const option = label.locator(`xpath=following::label[normalize-space(.)='${value}'][1]`);
    if (await option.count()) await option.click();
  }

  private async parseHtmlTables(page: Page, input: CreateRiskCheckInput): Promise<ZhongdengRegistration[]> {
    const records: ZhongdengRegistration[] = [];
    const tables = page.locator("table");
    for (let index = 0; index < await tables.count(); index += 1) {
      const table = tables.nth(index);
      const headers = await table.locator("th").allInnerTexts().catch(() => [] as string[]);
      if (!headers.some((value) => /登记.*编号|证明.*编号/.test(value))) continue;
      const rows = table.locator("tbody tr");
      for (let rowIndex = 0; rowIndex < await rows.count(); rowIndex += 1) {
        const values = await rows.nth(rowIndex).locator("td").allInnerTexts();
        const raw: Record<string, unknown> = {};
        headers.forEach((header, cellIndex) => { raw[header.trim()] = values[cellIndex]?.trim(); });
        const registrationNo = findValue(raw, ["登记证明编号", "登记编号", "证明编号"]);
        if (!registrationNo) continue;
        records.push({
          id: `zd-${registrationNo}`,
          registrationNo,
          guaranteeType: findValue(raw, ["登记类型", "担保类型", "业务类型"]),
          registrationDate: findValue(raw, ["登记时间", "登记日期"]),
          securedParty: findValue(raw, ["担保权人", "质权人", "债权人"]),
          debtorName: input.customerName,
          unifiedSocialCreditCode: input.unifiedSocialCreditCode,
          amount: parseAmount(findValue(raw, ["金额", "担保金额", "融资金额"])),
          contractNos: [], invoiceNos: [],
          description: findValue(raw, ["担保财产描述", "财产描述", "担保财产概况"]),
          attachments: [], raw,
        });
      }
    }
    return records;
  }

  private async downloadRegistrationList(page: Page, input: CreateRiskCheckInput): Promise<ZhongdengRegistration[]> {
    const link = page.getByText("登记信息列表", { exact: false }).first();
    if (!(await link.isVisible().catch(() => false))) return [];
    try {
      const downloadPromise = page.waitForEvent("download", { timeout: 15_000 });
      await link.click();
      const download = await downloadPromise;
      const dir = process.env.ZD_RESULT_DOWNLOAD_DIR || "./storage/query-results";
      await mkdir(dir, { recursive: true });
      const suggested = download.suggestedFilename().replace(/[\\/:*?"<>|]/g, "_");
      const path = join(dir, `${Date.now()}-${suggested || "登记信息列表.xlsx"}`);
      await download.saveAs(path);
      return parseRegistrationWorkbook(await readFile(path), input);
    } catch (error) {
      console.warn("[zhongdeng] 登记信息列表下载/解析失败，尝试直接解析页面表格。", error);
      return [];
    }
  }

  async queryCustomer(input: CreateRiskCheckInput): Promise<ZhongdengRegistration[]> {
    const page = await this.launchBrowser();
    if (!(await this.isAuthenticated(page))) {
      await page.bringToFront();
      throw new Error("中登网尚未登录，请先点击“登录中登网”并完成人工登录");
    }

    await page.goto(this.queryUrl, { waitUntil: "domcontentloaded" });
    await page.getByText("按担保人查询", { exact: true }).first().waitFor({ state: "visible" });

    const customerInput = process.env.ZD_CUSTOMER_NAME_SELECTOR ? page.locator(process.env.ZD_CUSTOMER_NAME_SELECTOR) : await inputAfterLabel(page, "机构名称");
    await customerInput.fill(input.customerName);
    await this.selectReason(page, officialReason(input.reason));
    await this.selectNeedCertificate(page, input.needCertificate !== false);

    const captchaInput = process.env.ZD_QUERY_CAPTCHA_SELECTOR ? page.locator(process.env.ZD_QUERY_CAPTCHA_SELECTOR) : await inputAfterLabel(page, "校验码");
    await captchaInput.fill("").catch(() => undefined);
    await captchaInput.focus().catch(() => undefined);
    await page.bringToFront();
    console.log(`[zhongdeng] 已预填“${input.customerName}”。请人工输入查询校验码计算结果并点击“查询”。`);

    const resultReadySelector = process.env.ZD_RESULT_READY_SELECTOR;
    if (resultReadySelector) await page.locator(resultReadySelector).waitFor({ state: "visible", timeout: this.timeoutMs });
    else await page.waitForFunction(() => document.body.innerText.includes("查询结果统计"), undefined, { timeout: this.timeoutMs });

    const bodyText = await page.locator("body").innerText();
    const count = parseQueryCount(bodyText);
    if (count === 0) return [];
    if (count == null) throw new Error("已进入中登查询结果页，但未识别到登记总数，请保存页面截图用于适配");

    let records = await this.downloadRegistrationList(page, input);
    if (!records.length) records = await this.parseHtmlTables(page, input);
    if (!records.length) throw new Error(`中登查询到 ${count} 笔登记，但当前版本还未识别到登记明细。请提供一张“查询到记录”的结果页截图以继续适配。`);
    return records;
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => undefined);
    this.context = undefined;
    this.page = undefined;
  }
}

export function createZhongdengAdapter(): ZhongdengAdapter {
  const mode = (process.env.ZHONGDENG_ADAPTER || "browser").toLowerCase();
  if (mode === "browser") return new BrowserZhongdengAdapter();
  if (mode === "mock") return new MockZhongdengAdapter();
  throw new Error(`Unsupported ZHONGDENG_ADAPTER: ${mode}`);
}
