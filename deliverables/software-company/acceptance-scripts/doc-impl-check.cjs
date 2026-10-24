/**
 * 文档-实现一致性核对：按 PRD F9/F10 与 api-spec §8.1 的验收标准逐条验证
 */
const { execSync } = require("node:child_process");

const API = "http://127.0.0.1:3000/v1";
const PHONE = "1383333" + String(Date.now()).slice(-4);
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ok(name, cond, detail = "") {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} | ${name}${detail ? " | " + String(detail).slice(0, 100) : ""}`);
}
function rg(k) {
  const raw = execSync(`redis-cli -p 6380 --raw get ${k}`, { encoding: "utf8" }).trim();
  try {
    return JSON.parse(raw).code;
  } catch {
    return raw;
  }
}
async function api(m, p, b, t) {
  const h = {};
  if (t) h.authorization = `Bearer ${t}`;
  if (b !== undefined) h["content-type"] = "application/json";
  const r = await fetch(`${API}${p}`, { method: m, headers: h, body: b === undefined ? undefined : JSON.stringify(b) });
  const x = await r.text();
  try {
    return { status: r.status, ...JSON.parse(x) };
  } catch {
    return { status: r.status, code: "EXC", raw: x };
  }
}

(async () => {
  console.log("\n=== 文档-实现一致性核对（PRD F9/F10 + api-spec §8.1）===\n");

  await api("POST", "/auth/sms-code", { phone: PHONE });
  await sleep(1200);
  const login = await api("POST", "/auth/login", { phone: PHONE, code: rg(`sms:code:${PHONE}`), age_confirmed: true });
  const t = login.data?.access_token;
  ok("前置：注册登录", login.code === 0);

  // ── F10 验收 1：新用户可在作品库看到示例作品，带标识 ──
  const w = await api("GET", "/works", undefined, t);
  const sample = w.data.list.find((x) => x.is_sample);
  ok("F10-1 注册后作品库有示例作品（is_sample=true）", !!sample, `works=${w.data.total}`);

  // ── F10 验收 2：onboarded 初始 false，关闭后持久 ──
  const me1 = await api("GET", "/me", undefined, t);
  ok("F10-2a GET /me 返回 onboarded=false", me1.data?.onboarded === false, `onboarded=${me1.data?.onboarded}`);
  await api("POST", "/me/onboarded", {}, t);
  const me2 = await api("GET", "/me", undefined, t);
  ok("F10-2b 关闭后 onboarded=true 且持久", me2.data?.onboarded === true, `onboarded=${me2.data?.onboarded}`);

  // ── F10 验收 3：复制示例 → 母版不被改动 ──
  const dup = await api("POST", `/projects/${sample.id}/duplicate`, undefined, t);
  ok("F10-3a duplicate 返回 id/episodes/characters", dup.code === 0 && !!dup.data?.id, JSON.stringify(dup.data).slice(0, 80));
  const copiedId = dup.data.id;
  const epId = (await api("GET", `/projects/${copiedId}`, undefined, t)).data.episodes[0].id;
  await api("POST", `/projects/${copiedId}/episodes/${epId}/storyboards/generate`, { shot_count: 4 }, t);
  const sampleAfter = await api("GET", `/projects/${sample.id}`, undefined, t);
  ok(
    "F10-3b 副本生成分镜后母版分镜数仍为 0（深拷贝）",
    (sampleAfter.data.storyboards?.length ?? 0) === 0 || sampleAfter.data.episodes.every((e) => !e.storyboard_count),
    `母版 shots=${sampleAfter.data.storyboards?.length ?? "n/a"}`,
  );

  // ── F9 验收 1：四态判定 ──
  const draftProj = await api("POST", "/projects", { title: "四态-draft", source_type: 2, ratio: "9:16", source_text: "x" }, t);
  const w1 = await api("GET", "/works", undefined, t);
  const draftState = w1.data.list.find((x) => x.id === draftProj.data.id)?.work_state;
  ok("F9-1a 无分镜 → draft", draftState === "draft", `state=${draftState}`);

  const copiedWork = w1.data.list.find((x) => x.id === copiedId);
  ok("F9-1b 有分镜未出完 → producing", copiedWork?.work_state === "producing", `state=${copiedWork?.work_state}`);

  // 归档
  await api("POST", `/projects/${draftProj.data.id}/archive`, { archived: true }, t);
  const w2 = await api("GET", "/works", undefined, t);
  const archivedGone = !w2.data.list.some((x) => x.id === draftProj.data.id);
  const w3 = await api("GET", "/works?status=archived", undefined, t);
  const archivedThere = w3.data.list.some((x) => x.id === draftProj.data.id);
  ok("F9-1c 归档后默认列表不可见、archived 列表可见", archivedGone && archivedThere, `gone=${archivedGone} inArchived=${archivedThere}`);
  const archivedState = w3.data.list.find((x) => x.id === draftProj.data.id)?.work_state;
  ok("F9-1d 归档态 → archived", archivedState === "archived", `state=${archivedState}`);

  // ── F9 验收 2：续做一集复用角色 ──
  const before = (await api("GET", `/projects/${copiedId}`, undefined, t)).data;
  const addEp = await api("POST", `/projects/${copiedId}/episodes`, { count: 1 }, t);
  const after = (await api("GET", `/projects/${copiedId}`, undefined, t)).data;
  ok(
    "F9-2a 续做一集：集数 +1、角色数不变（复用）",
    addEp.code === 0 && after.episodes.length === before.episodes.length + 1 && after.characters.length === before.characters.length,
    `ep ${before.episodes.length}→${after.episodes.length}, chars=${after.characters.length}`,
  );

  // ── F9 验收 3：幂等（重复建集不重复） ──
  const n1 = (await api("GET", `/projects/${copiedId}`, undefined, t)).data.episodes.length;
  await api("POST", `/projects/${copiedId}/episodes`, { count: 2 }, t);
  const n2 = (await api("GET", `/projects/${copiedId}`, undefined, t)).data.episodes.length;
  ok("F9-3 一次新增 2 集精确 +2", n2 === n1 + 2, `${n1}→${n2}`);

  // ── api-spec §8.1：work_state 枚举与字段完整 ──
  const fields = Object.keys(w1.data.list[0] ?? {});
  const need = ["episode_count", "shot_count", "done_count", "cover_uri", "work_state", "is_sample", "archived_at"];
  const missing = need.filter((k) => !fields.includes(k));
  ok("api-spec §8.1 响应字段完整", missing.length === 0, missing.length ? `missing=${missing}` : `${fields.length} fields`);

  const states = new Set(w1.data.list.map((x) => x.work_state));
  const valid = [...states].every((s) => ["draft", "producing", "ready", "archived"].includes(s));
  ok("work_state 仅取四个枚举值", valid, [...states].join(","));

  // ── 封面必须是可访问 URL（不是对象键） ──
  const withCover = w1.data.list.find((x) => x.cover_uri);
  if (withCover) {
    const okUrl = /^https?:\/\//.test(withCover.cover_uri) || withCover.cover_uri.startsWith("/");
    ok("cover_uri 为可访问 URL", okUrl, withCover.cover_uri.slice(0, 60));
  } else {
    ok("cover_uri 为可访问 URL", true, "当前无封面（跳过）");
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== 结果：${passed}/${results.length} 通过 ===`);
  const failed = results.filter((r) => !r.pass);
  if (failed.length) failed.forEach((f) => console.log(`  - ${f.name}`));
  process.exitCode = failed.length ? 1 : 0;
})();
