/**
 * 端到端全链路验收（API 层）
 * 覆盖：注册 → 示例作品 → 大纲 → 角色 → 定妆 → 分镜 → 批量投递 → 出片 → 转存 → 导出
 *       → 作品库聚合 → 二次创作 → 分享 → 举报 → 积分不变式
 */
const { execSync } = require("node:child_process");

const API = "http://127.0.0.1:3000/v1";
const PHONE = "1380000" + String(Date.now()).slice(-4);
const results = [];

function ok(name, cond, detail = "") {
  results.push({ name, pass: !!cond, detail: String(detail).slice(0, 120) });
  console.log(`${cond ? "PASS" : "FAIL"} | ${name}${detail ? " | " + String(detail).slice(0, 100) : ""}`);
}

function redisGet(key) {
  const raw = execSync(`redis-cli -p 6380 --raw get ${key}`, { encoding: "utf8" }).trim();
  try {
    return JSON.parse(raw).code;
  } catch {
    return raw;
  }
}

async function api(method, path, body, token) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { status: res.status, ...JSON.parse(text) };
  } catch {
    return { status: res.status, code: "EXC", raw: text };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitTask(taskId, token, maxMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const t = await api("GET", `/tasks/${taskId}`, undefined, token);
    if (t.code === 0 && [3, 4, 5, 7].includes(t.data.status)) return t.data;
    await sleep(900);
  }
  return null;
}

(async () => {
  console.log(`\n=== E2E 全链路验收 (phone=${PHONE}) ===\n`);

  // ── 1. 注册 ──
  await api("POST", "/auth/sms-code", { phone: PHONE });
  await sleep(1200);
  const code = redisGet(`sms:code:${PHONE}`);
  const login = await api("POST", "/auth/login", { phone: PHONE, code, age_confirmed: true });
  const token = login.data?.access_token;
  ok("1. 新用户注册登录", login.code === 0 && !!token, `code=${login.code}`);

  // ── 2. 新用户赠 80 积分 ──
  const me1 = await api("GET", "/me", undefined, token);
  ok("2. 注册赠送 80 积分", me1.data?.credits?.balance === 80, `balance=${me1.data?.credits?.balance}`);
  ok("2b. 新手引导未关闭", me1.data?.onboarded === false, `onboarded=${me1.data?.onboarded}`);

  // ── 3. 示例作品自动创建 ──
  const works1 = await api("GET", "/works", undefined, token);
  const sample = works1.data?.list?.find((w) => w.is_sample);
  ok("3. 示例作品自动生成", !!sample, `works=${works1.data?.total} sample=${!!sample}`);
  ok(
    "3b. 示例作品含 2 集大纲",
    sample?.episode_count === 2,
    `ep=${sample?.episode_count}`,
  );

  // ── 4. 关闭新手引导（幂等） ──
  const ob1 = await api("POST", "/me/onboarded", {}, token);
  await api("POST", "/me/onboarded", {}, token);
  const me2 = await api("GET", "/me", undefined, token);
  ok("4. 新手引导已关闭且幂等", ob1.code === 0 && me2.data?.onboarded === true, `onboarded=${me2.data?.onboarded}`);

  // ── 5. 新建项目（真链路） ──
  const proj = await api(
    "POST",
    "/projects",
    { title: "E2E 验收剧", source_type: 2, ratio: "9:16", source_text: "一个人在雨夜寻找失踪多年的父亲。" },
    token,
  );
  const projectId = proj.data?.id;
  ok("5. 新建项目", proj.code === 0 && !!projectId, `id=${projectId}`);

  // ── 6. 生成大纲 ──
  const outline = await api("POST", `/projects/${projectId}/outline/generate`, {}, token);
  ok("6. 生成分集大纲", outline.code === 0 && outline.data?.length >= 2, `episodes=${outline.data?.length}`);

  // ── 7. 确认大纲 ──
  const eps = outline.data.map((e) => ({ ep_no: e.ep_no, title: e.title, synopsis: e.synopsis }));
  const saveOutline = await api("PUT", `/projects/${projectId}/outline`, { episodes: eps }, token);
  ok("7. 确认大纲", saveOutline.code === 0, `code=${saveOutline.code}`);

  // ── 8. 生成角色 ──
  const chars = await api("POST", `/projects/${projectId}/characters/generate`, { count: 3 }, token);
  const charId = chars.data?.[0]?.id;
  ok("8. 生成角色", chars.code === 0 && chars.data?.length >= 2, `characters=${chars.data?.length}`);

  // ── 9. 生成定妆图 → 定稿 ──
  const portrait = await api("POST", `/projects/${projectId}/characters/${charId}/portrait`, { count: 2 }, token);
  const portraitTask = await waitTask(portrait.data?.task_id, token, 90000);
  ok("9. 定妆图任务完成", portraitTask?.status === 3, `status=${portraitTask?.status}`);

  const finalize = await api("POST", `/projects/${projectId}/characters/${charId}/finalize`, { task_id: portrait.data?.task_id, index: 0 }, token);
  ok("9b. 角色定稿", finalize.code === 0, `code=${finalize.code} msg=${finalize.msg ?? ""}`);

  // ── 10. 生成分镜 ──
  const epId = outline.data[0].id;
  const boards = await api("POST", `/projects/${projectId}/episodes/${epId}/storyboards/generate`, { shot_count: 6 }, token);
  ok("10. 生成分镜", boards.code === 0 && boards.data?.length >= 4, `shots=${boards.data?.length}`);

  // 取已定稿角色的定妆图 URI（universal_reference 必须带参考图）
  const projDetail = await api("GET", `/projects/${projectId}`, undefined, token);
  const finalized = (projDetail.data?.characters ?? []).filter((c) => c.portrait_url || c.portrait_asset_id);
  const refUri = finalized[0]?.portrait_url ?? projDetail.data?.characters?.[0]?.portrait_url ?? "";
  ok("10b. 角色定妆图可用于参考", !!refUri, `ref=${String(refUri).slice(0, 40)}`);

  // ── 11. 批量报价 ──
  const batchQuote = await api(
    "POST",
    "/credits/quote/batch",
    {
      items: boards.data.slice(0, 4).map((s) => ({
        mode: "universal_reference",
        model: "wan-3.0",
        scene: "storyboard_reference_video",
        input: { prompt: s.video_prompt ?? "镜头", reference_uris: [refUri] },
        options: { ratio: "9:16", resolution: "720p", duration: 5, count: 1 },
      })),
    },
    token,
  );
  ok("11. 批量报价", batchQuote.code === 0 && batchQuote.data?.total_credits > 0, `total=${batchQuote.data?.total_credits}`);

  // ── 12. 批量投递 ──
  const dispatch = await api(
    "POST",
    `/projects/${projectId}/episodes/${epId}/storyboards/generate-videos`,
    { model: "wan-3.0", budget_credits_max: 200, shot_ids: boards.data.slice(0, 4).map((s) => s.id) },
    token,
  );
  const submitted = dispatch.data?.items?.filter((i) => i.submitted) ?? [];
  if (!submitted.length) console.log("  dispatch raw:", JSON.stringify(dispatch).slice(0, 400));
  ok("12. 批量投递（部分/全部成功）", dispatch.code === 0 && submitted.length > 0, `submitted=${submitted.length}/${dispatch.data?.items?.length}`);

  // ── 13. 等待出片 ──
  let doneCount = 0;
  for (const item of submitted) {
    const t = await waitTask(item.task_id, token, 90000);
    if (t?.status === 3) doneCount++;
  }
  ok("13. 镜头出片成功", doneCount > 0, `done=${doneCount}/${submitted.length}`);

  // ── 14. 作品库聚合反映进度 ──
  const works2 = await api("GET", "/works", undefined, token);
  const e2eWork = works2.data?.list?.find((w) => w.id === projectId);
  ok("14. 作品库反映制作进度", e2eWork?.done_count > 0, `state=${e2eWork?.work_state} done=${e2eWork?.done_count}/${e2eWork?.shot_count}`);

  // ── 15. 结果转存资产 ──
  const firstTask = submitted[0]?.task_id;
  if (!firstTask) { console.log("\n=== 中断：投递未产生任务 ==="); process.exit(1); }
  const fromTask = await api("POST", "/assets/from-task", { task_id: firstTask, index: 0 }, token);
  ok("15. 结果转存资产", fromTask.code === 0, `assetId=${fromTask.data?.id}`);

  // ── 16. 资产标签筛选 ──
  const patchAsset = await api("PATCH", `/assets/${fromTask.data?.id}`, { tags: ["#E2E角色"] }, token);
  const tagList = await api("GET", `/assets?tag=${encodeURIComponent("#E2E角色")}`, undefined, token);
  ok("16. 资产打标签并可检索", patchAsset.code === 0 && tagList.data?.total >= 1, `total=${tagList.data?.total}`);

  // ── 17. 导出 zip ──
  const exp = await api("POST", `/projects/${projectId}/episodes/${epId}/exports`, {}, token);
  ok("17. 提交导出任务", exp.code === 0, `code=${exp.code} msg=${exp.msg ?? ""}`);

  // ── 18. 二次创作：新增一集 ──
  const addEp = await api("POST", `/projects/${projectId}/episodes`, { count: 1 }, token);
  ok("18. 二次创作新增一集", addEp.code === 0 && addEp.data?.created?.length === 1, `created=${addEp.data?.created?.length}`);

  // ── 19. 分享链路 ──
  const share = await api("POST", `/tasks/${firstTask}/share`, { expires_in_days: 7 }, token);
  const shareToken = share.data?.token;
  const pub = await api("GET", `/share/${shareToken}`);
  ok("19. 生成分享并公开可读", share.code === 0 && pub.code === 0 && pub.data?.task_id === firstTask, `token=${!!shareToken}`);

  // ── 20. 举报 → 撤销后不可访问 ──
  const report = await api("POST", `/share/${shareToken}/report`, { reason: "illegal", detail: "E2E 验收举报" });
  const revoke = await api("DELETE", `/tasks/${firstTask}/share`, undefined, token);
  const pub2 = await api("GET", `/share/${shareToken}`);
  ok("20. 举报留痕 + 撤销后 400102", report.code === 0 && revoke.code === 0 && pub2.code === 400102, `after=${pub2.code}`);

  // ── 21. 积分不变式（balance == Σdelta） ──
  const flows = await api("GET", "/credits/flows?page=1&page_size=100", undefined, token);
  const sum = flows.data.list.reduce((a, f) => a + f.delta, 0);
  const sumFrozen = flows.data.list.reduce((a, f) => a + f.frozen_delta, 0);
  const me3 = await api("GET", "/me", undefined, token);
  ok(
    "21. 积分 ledger 不变式",
    sum === me3.data.credits.balance && sumFrozen === me3.data.credits.frozen,
    `Σdelta=${sum} balance=${me3.data.credits.balance} | Σfrozen=${sumFrozen} frozen=${me3.data.credits.frozen}`,
  );

  // ── 22. 归档 / 恢复 ──
  const arch = await api("POST", `/projects/${projectId}/archive`, { archived: true }, token);
  const worksArchived = await api("GET", "/works?status=archived", undefined, token);
  const rest = await api("POST", `/projects/${projectId}/archive`, { archived: false }, token);
  ok(
    "22. 作品归档与恢复",
    arch.code === 0 && worksArchived.data?.list?.some((w) => w.id === projectId) && rest.code === 0,
    `archived=${arch.data?.archived} restored=${!rest.data?.archived}`,
  );

  // ── 23. 复制示例作品 ──
  const dup = await api("POST", `/projects/${sample.id}/duplicate`, undefined, token);
  ok("23. 复制示例作品", dup.code === 0 && dup.data?.episodes === 2, `eps=${dup.data?.episodes}`);

  // ── 24. 跨空间隔离 ──
  const otherPhone = "1380001" + String(Date.now()).slice(-4);
  await api("POST", "/auth/sms-code", { phone: otherPhone });
  await sleep(1200);
  const code2 = redisGet(`sms:code:${otherPhone}`);
  const login2 = await api("POST", "/auth/login", { phone: otherPhone, code: code2, age_confirmed: true });
  const token2 = login2.data?.access_token;
  const crossGet = await api("GET", `/projects/${projectId}`, undefined, token2);
  ok("24. 跨空间隔离 400102", crossGet.code === 400102, `code=${crossGet.code}`);

  // ── 汇总 ──
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== 结果：${passed}/${results.length} 通过 ===`);
  const failed = results.filter((r) => !r.pass);
  if (failed.length) {
    console.log("\n失败项：");
    failed.forEach((f) => console.log(`  - ${f.name} | ${f.detail}`));
  }
  process.exitCode = failed.length ? 1 : 0;
})();
