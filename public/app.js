const $ = (id) => document.getElementById(id);
const state = { currentJob: null, pollTimer: null, sessionTimer: null, config: null, session: null };
const levelNames = { EXACT: "完全匹配", HIGH: "高度疑似", POSSIBLE: "可能相关", NONE: "未匹配", INSUFFICIENT: "信息不足" };
const statusNames = { PENDING: "等待执行", RUNNING: "核查中", COMPLETED: "核查完成", FAILED: "核查失败" };

function toast(message) { const node = $("toast"); node.textContent = message; node.classList.remove("hidden"); setTimeout(() => node.classList.add("hidden"), 3600); }
function money(value) { return value == null ? "—" : new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 }).format(value); }
async function api(url, options) { const res = await fetch(url, options); const payload = await res.json().catch(() => ({})); if (!res.ok) throw new Error(payload.message || payload.error || `HTTP ${res.status}`); return payload; }
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function updateQueryAvailability() { $("submitBtn").disabled = Boolean(state.config?.requiresLogin && !state.session?.authenticated); }
function renderSession(session) {
  state.session = session;
  const dot = $("sessionDot"), loginBtn = $("loginBtn");
  $("sessionMessage").textContent = session.message || "—";
  dot.className = `session-dot ${session.authenticated ? "ok" : session.browserOpen ? "waiting" : ""}`;
  if (state.config?.zhongdengAdapter === "mock") loginBtn.classList.add("hidden");
  else { loginBtn.classList.remove("hidden"); loginBtn.textContent = session.authenticated ? "已登录" : session.browserOpen ? "打开登录窗口" : "登录中登网"; loginBtn.disabled = Boolean(session.authenticated); }
  const zdText = state.config?.zhongdengAdapter === "mock" ? "中登：Mock" : `中登：${session.authenticated ? "已登录" : "未登录"}`;
  $("adapterStatus").textContent = `${zdText} · 内部数据：${state.config?.internalAdapter || "—"}`;
  updateQueryAvailability();
}
async function refreshSession() { try { const payload = await api("/api/zhongdeng/session"); renderSession(payload.data); return payload.data; } catch (e) { $("sessionMessage").textContent = e.message; return null; } }
function stopSessionPoll() { if (state.sessionTimer) clearTimeout(state.sessionTimer); state.sessionTimer = null; }
function pollSession() { stopSessionPoll(); state.sessionTimer = setTimeout(async () => { const session = await refreshSession(); if (session && !session.authenticated && state.config?.requiresLogin) pollSession(); else stopSessionPoll(); }, 1200); }
async function loadConfig() {
  try {
    state.config = await api("/api/config");
    if (state.config.manualCaptcha) $("browserNote").classList.remove("hidden");
    if (state.config.internalAdapter === "mock") $("internalMockNote").classList.remove("hidden");
    const reason = $("reason"); if (Array.isArray(state.config.queryReasons) && state.config.queryReasons.length) reason.innerHTML = state.config.queryReasons.map((item) => `<option>${escapeHtml(item)}</option>`).join("");
    await refreshSession();
  } catch { $("adapterStatus").textContent = "服务连接异常"; $("sessionMessage").textContent = "无法读取服务配置"; }
}
function renderEvidence(record) {
  const evidence = record.match.evidence || [];
  const items = evidence.length ? evidence.map((e) => `<div class="evidence-item"><div class="row"><strong>${escapeHtml(e.field)}</strong><span class="weight">+${e.weight}</span></div><span>${escapeHtml(e.detail)}</span></div>`).join("") : `<div class="empty-state" style="padding:34px 12px"><h3>暂无可确认匹配证据</h3><p>建议人工查看原始登记/附件。</p></div>`;
  $("evidenceCard").innerHTML = `<div class="evidence-title"><div><h3>${escapeHtml(record.registrationNo)}</h3><p>${escapeHtml(record.guaranteeType || "未分类")}</p></div><span class="badge ${record.match.level}">${levelNames[record.match.level]}</span></div><div class="evidence-list">${items}</div><div class="meta-grid"><div class="meta-box"><span>合同号</span><strong>${escapeHtml(record.contractNos?.join("、") || "—")}</strong></div><div class="meta-box"><span>发票号</span><strong>${escapeHtml(record.invoiceNos?.join("、") || "—")}</strong></div><div class="meta-box"><span>登记金额</span><strong>${money(record.amount)}</strong></div><div class="meta-box"><span>担保权人</span><strong>${escapeHtml(record.securedParty || "—")}</strong></div></div>`;
}
function stopPoll() { if (state.pollTimer) clearTimeout(state.pollTimer); state.pollTimer = null; }
function schedulePoll(id) { stopPoll(); state.pollTimer = setTimeout(async () => { try { const payload = await api(`/api/checks/${id}`); renderJob(payload.data); await loadHistory(); } catch (e) { toast(e.message); } }, 900); }
function renderJob(job) {
  state.currentJob = job; $("dashboard").classList.remove("hidden"); $("resultCustomer").textContent = job.customerName;
  const dataHint = state.config?.internalAdapter === "mock" ? " · 内部合同/发票为 Mock" : "";
  $("resultMeta").textContent = `${job.reason} · ${new Date(job.createdAt).toLocaleString("zh-CN")}${dataHint}`;
  const status = $("jobStatus"); status.textContent = statusNames[job.status] || job.status; status.className = `job-status ${job.status.toLowerCase()}`;
  const s = job.summary || { total: job.records?.length || 0, exact: 0, high: 0, possible: 0, none: 0, insufficient: 0 };
  $("mTotal").textContent=s.total; $("mExact").textContent=s.exact; $("mHigh").textContent=s.high; $("mPossible").textContent=s.possible; $("mNone").textContent=s.none; $("mInsufficient").textContent=s.insufficient;
  const records = job.records || [], body = $("recordsBody");
  if (!records.length) {
    let text = "正在获取登记数据…";
    if (job.status === "RUNNING" && job.sourceMode === "browser") text = "已打开中登查询页：请在浏览器中输入查询校验码计算结果并点击“查询”…";
    if (job.status === "COMPLETED") text = "中登查询完成：未查询到正在公示的登记。";
    if (job.status === "FAILED") text = escapeHtml(job.errors?.join("；") || "核查失败");
    body.innerHTML = `<tr><td colspan="6" style="color:#8a93a4;padding:22px 9px">${text}</td></tr>`;
  } else {
    body.innerHTML = records.map((r, i) => `<tr data-index="${i}"><td><strong>${escapeHtml(r.registrationNo)}</strong></td><td>${escapeHtml(r.guaranteeType || "—")}</td><td>${escapeHtml(r.registrationDate || "—")}</td><td>${money(r.amount)}</td><td><span class="badge ${r.match.level}">${levelNames[r.match.level]}</span></td><td><strong>${r.match.score}</strong></td></tr>`).join("");
    body.querySelectorAll("tr[data-index]").forEach((row) => row.addEventListener("click", () => { body.querySelectorAll("tr").forEach((x) => x.classList.remove("active")); row.classList.add("active"); renderEvidence(records[Number(row.dataset.index)]); })); body.querySelector("tr[data-index]")?.click();
  }
  if (["PENDING", "RUNNING"].includes(job.status)) schedulePoll(job.id); else stopPoll();
}
async function loadHistory() {
  try { const jobs = (await api("/api/checks")).data || []; $("history").innerHTML = jobs.length ? jobs.slice(0,12).map((j) => `<div class="history-item" data-id="${j.id}"><strong>${escapeHtml(j.customerName)}</strong><small>${new Date(j.createdAt).toLocaleString("zh-CN")}</small><span>${j.summary ? `${j.summary.exact + j.summary.high} 条关注` : "处理中"}</span><span>${statusNames[j.status] || j.status}</span></div>`).join("") : `<div style="color:#8a93a4;font-size:12px;padding:18px 2px">暂无核查记录</div>`; $("history").querySelectorAll("[data-id]").forEach((node) => node.addEventListener("click", async () => { const detail = await api(`/api/checks/${node.dataset.id}`); renderJob(detail.data); window.scrollTo({ top: $("dashboard").offsetTop - 20, behavior: "smooth" }); })); } catch (e) { toast(e.message); }
}
$("loginBtn").addEventListener("click", async () => {
  const button = $("loginBtn"); button.disabled = true; button.textContent = "正在打开…";
  try { const payload = await api("/api/zhongdeng/login", { method: "POST" }); renderSession(payload.data); if (!payload.data.authenticated) { toast("已打开中登登录页，请在浏览器中完成校验码和短信动态码登录"); pollSession(); } } catch (e) { toast(e.message); } finally { if (!state.session?.authenticated) button.disabled = false; }
});
$("checkForm").addEventListener("submit", async (event) => {
  event.preventDefault(); if (state.config?.requiresLogin && !state.session?.authenticated) return toast("请先登录中登网");
  const button = $("submitBtn"); button.disabled = true; button.textContent = "正在创建核查…";
  try { const payload = await api("/api/checks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customerName: $("customerName").value, unifiedSocialCreditCode: $("uscc").value || undefined, reason: $("reason").value, needCertificate: $("needCertificate").checked }) }); renderJob(payload.data); await loadHistory(); window.scrollTo({ top: $("dashboard").offsetTop - 20, behavior: "smooth" }); if (state.config?.zhongdengAdapter === "browser") toast("已进入真实中登查询流程，请切换到浏览器输入查询校验码并点击查询"); } catch (e) { toast(e.message); } finally { updateQueryAvailability(); button.textContent = "开始核查"; }
});
$("refreshHistory").addEventListener("click", loadHistory);
await loadConfig(); await loadHistory();
