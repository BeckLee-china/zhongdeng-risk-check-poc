import assert from "node:assert/strict";
import test from "node:test";
import { extractBusinessFields, matchRegistration, type Registration, type InternalDocument } from "../src/server.js";

test("提取合同、发票、金额、日期",()=>{
  const x=extractBusinessFields("合同编号：HT2026018 发票号码：03492133 合同金额：4,860,000.00 日期：2026年03月18日");
  assert.deepEqual(x.contractNos,["HT2026018"]);
  assert.deepEqual(x.invoiceNos,["03492133"]);
  assert.ok(x.amounts.includes(4860000));
  assert.ok(x.dates.includes("2026-03-18"));
});

test("合同号强标识命中",()=>{
  const reg:Registration={id:"r",registrationNo:"1",debtorName:"青岛测试有限公司",contractNos:["HT-2026-018"],invoiceNos:[],amount:100,description:"智能闸口项目",attachments:[]};
  const docs:InternalDocument[]=[{id:"d",type:"CONTRACT",documentNo:"HT2026018",contractNo:"HT2026018",customerName:"青岛测试有限公司",amount:100,description:"智能闸口项目"}];
  const r=matchRegistration(reg,docs);
  assert.equal(r.level,"EXACT");
  assert.ok(r.score>=90);
});
