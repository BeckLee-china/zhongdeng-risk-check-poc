import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RiskCheckJob } from "../core/types.js";

export class FileStore {
  readonly root: string;
  readonly jobsDir: string;
  readonly auditDir: string;
  constructor(root = process.env.DATA_DIR || "./data") {
    this.root = root;
    this.jobsDir = join(root, "jobs");
    this.auditDir = join(root, "audit");
  }
  async init() { await mkdir(this.jobsDir, { recursive: true }); await mkdir(this.auditDir, { recursive: true }); }
  private async atomicWrite(path: string, value: unknown) {
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
    await rename(tmp, path);
  }
  async saveJob(job: RiskCheckJob) { await this.init(); await this.atomicWrite(join(this.jobsDir, `${job.id}.json`), job); }
  async getJob(id: string): Promise<RiskCheckJob | null> {
    try { return JSON.parse(await readFile(join(this.jobsDir, `${id}.json`), "utf8")) as RiskCheckJob; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }
  async listJobs(): Promise<RiskCheckJob[]> {
    await this.init();
    const names = (await readdir(this.jobsDir)).filter((name) => name.endsWith(".json"));
    const jobs = await Promise.all(names.map((name) => this.getJob(name.replace(/\.json$/, ""))));
    return jobs.filter((job): job is RiskCheckJob => Boolean(job)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async appendAudit(event: Record<string, unknown>) {
    await this.init();
    await this.atomicWrite(join(this.auditDir, `${Date.now()}-${crypto.randomUUID()}.json`), event);
  }
}
