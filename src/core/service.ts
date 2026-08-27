import { randomUUID } from "node:crypto";
import type { InternalDataAdapter } from "../adapters/internal.js";
import type { ZhongdengAdapter } from "../adapters/zhongdeng.js";
import type { CreateRiskCheckInput, MatchedRegistration, RiskCheckJob } from "./types.js";
import { matchRegistration, normalizeRegistrationIdentifiers } from "./matcher.js";
import { summarize } from "./summary.js";
import { enrichRegistrationFromAttachments } from "../documents/parser.js";
import { FileStore } from "../storage/file-store.js";

export class RiskCheckService {
  constructor(private readonly store: FileStore, private readonly zhongdeng: ZhongdengAdapter, private readonly internal: InternalDataAdapter) {}

  async create(input: CreateRiskCheckInput, actor = "poc-user"): Promise<RiskCheckJob> {
    const customerName = input.customerName.trim();
    if (customerName.length < 2) throw new Error("customerName is required");
    const now = new Date().toISOString();
    const job: RiskCheckJob = {
      id: randomUUID(), customerName, unifiedSocialCreditCode: input.unifiedSocialCreditCode?.trim() || undefined,
      reason: input.reason?.trim() || "业务合作前风险核查", status: "PENDING", sourceMode: this.zhongdeng.mode,
      createdAt: now, records: [], errors: [],
    };
    await this.store.saveJob(job);
    await this.store.appendAudit({ type: "risk-check-created", actor, jobId: job.id, customerName, reason: job.reason, sourceMode: job.sourceMode, timestamp: now });
    void this.run(job.id, { ...input, customerName }).catch((error) => console.error("[risk-check] background run failed", error));
    return job;
  }

  async run(jobId: string, input: CreateRiskCheckInput): Promise<void> {
    const job = await this.store.getJob(jobId); if (!job) throw new Error(`Job not found: ${jobId}`);
    job.status = "RUNNING"; job.startedAt = new Date().toISOString(); await this.store.saveJob(job);
    try {
      const [registrations, documents] = await Promise.all([
        this.zhongdeng.queryCustomer(input),
        this.internal.findByCustomer(input.customerName, input.unifiedSocialCreditCode),
      ]);
      const enriched = await Promise.all(registrations.map(enrichRegistrationFromAttachments));
      const matched: MatchedRegistration[] = enriched.map((raw) => {
        const registration = normalizeRegistrationIdentifiers(raw);
        return { ...registration, match: matchRegistration(registration, documents) };
      });
      job.records = matched; job.summary = summarize(matched); job.status = "COMPLETED"; job.completedAt = new Date().toISOString();
      await this.store.saveJob(job);
      await this.store.appendAudit({ type: "risk-check-completed", jobId, customerName: job.customerName, resultSummary: job.summary, timestamp: job.completedAt });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      job.status = "FAILED"; job.errors.push(message); job.completedAt = new Date().toISOString(); await this.store.saveJob(job);
      await this.store.appendAudit({ type: "risk-check-failed", jobId, customerName: job.customerName, error: message, timestamp: job.completedAt });
      throw error;
    }
  }

  get(id: string) { return this.store.getJob(id); }
  list() { return this.store.listJobs(); }
}
