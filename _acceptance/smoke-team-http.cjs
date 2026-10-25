/**
 * cam 域 HTTP 端到端冒烟（真实 HTTP，不是 service 单测）
 * 验证：创建团队 → X-Space-Id 切空间 → 团队上下文生效 → 非成员空间被拒 403
 */
const BASE = "http://127.0.0.1:3000/v1";

async function call(method, path, body, token, spaceId) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (spaceId) headers["x-space-id"] = spaceId;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, ...json };
}

async function login(phone) {
  const sms = await call("POST", "/auth/sms-code", { phone });
  const code = sms.data?.debug_code;
  const login = await call("POST", "/auth/login", { phone, code, age_confirmed: true });
  return {
    token: login.data?.access_token,
    spaceId: String(login.data?.space_id ?? ""),
    userId: String(login.data?.user?.id ?? ""),
  };
}

(async () => {
  const stamp = String(Date.now()).slice(-8);
  const a = await login(`1${stamp}01`);
  const b = await login(`1${stamp}02`);
  console.log("userA", a.userId, "personalSpace", a.spaceId);

  // 1) 创建团队
  const created = await call("POST", "/cam/team", { name: "冒烟测试团队" }, a.token);
  const teamSpaceId = created.data?.space_id;
  console.log("create team ->", created.code, teamSpaceId);
  if (!teamSpaceId) { console.error("FAIL: create team", JSON.stringify(created)); process.exit(1); }

  // 2) 不带 X-Space-Id：仍是个人空间
  const personal = await call("GET", "/cam/team/info", undefined, a.token);
  console.log("info (no header) type=", personal.data?.type, "seats=", `${personal.data?.used_seats}/${personal.data?.max_seats}`);

  // 3) 带团队 X-Space-Id：切到团队上下文
  const teamInfo = await call("GET", "/cam/team/info", undefined, a.token, teamSpaceId);
  console.log("info (X-Space-Id=team) type=", teamInfo.data?.type, "name=", teamInfo.data?.name, "pool=", teamInfo.data?.credit_total);

  // 4) 权限探测：owner ⇒ privileged
  const perm = await call("GET", "/cam/permission/user", undefined, a.token, teamSpaceId);
  console.log("permission role_code=", perm.data?.role_code, "privileged=", perm.data?.privileged);

  // 5) 我的团队列表含团队与个人空间
  const mine = await call("GET", "/cam/teams/mine", undefined, a.token);
  console.log("myTeams=", (mine.data?.list ?? []).map((t) => `${t.name}(type${t.type})`).join(", "));

  // 6) 非成员（userB）尝试用 A 的团队空间 → 必须 403
  const intruder = await call("GET", "/cam/team/info", undefined, b.token, teamSpaceId);
  console.log("userB in A's team ->", intruder.status, intruder.code, intruder.msg);

  // 7) 团队余额为 0 时分配 → 745701
  const alloc = await call("POST", "/cam/team/points-allocation", { user_id: a.userId, amount: 10 }, a.token, teamSpaceId);
  console.log("allocate with 0 pool ->", alloc.status, alloc.code, alloc.msg);

  // 8) 批量添加成员（B 用 user_id 加入；再造一个未注册手机号验证逐条拒绝）
  const batch = await call(
    "POST",
    "/cam/team/member/batch",
    { members: [{ user_id: b.userId, role_code: "animator" }, { phone: "13900000009" }] },
    a.token,
    teamSpaceId,
  );
  console.log("batch add ->", batch.code, `added=${batch.data?.added} failed=${batch.data?.failed}`);

  // 9) 批量改状态 + 换组
  const grp = await call("POST", "/cam/team/group", { name: "冒烟动画组" }, a.token, teamSpaceId);
  const groupId = grp.data?.id;
  const st = await call(
    "POST",
    "/cam/team/member/batch/status",
    { user_ids: [b.userId], status: 2 },
    a.token,
    teamSpaceId,
  );
  const cg = await call(
    "POST",
    "/cam/team/member/change-group",
    { user_ids: [b.userId], group_id: groupId },
    a.token,
    teamSpaceId,
  );
  console.log("batch status/change-group ->", st.code, cg.code);

  // 10) CSV 导出（直接看 content-type 与前几行）
  const csvRes = await fetch(`${BASE}/cam/team/member/export`, {
    headers: { authorization: `Bearer ${a.token}`, "x-space-id": teamSpaceId },
  });
  const csvText = await csvRes.text();
  const csvOk = csvRes.ok && csvText.includes("role_code") && csvText.split("\n").length >= 2;
  console.log("csv export ->", csvRes.status, csvRes.headers.get("content-type"), `lines=${csvText.split("\n").length}`);

  // 11) 被停用的成员不能进团队（守卫校验 status===1）
  const bDisabled = await call("GET", "/cam/team/info", undefined, b.token, teamSpaceId);
  console.log("userB while disabled ->", bDisabled.code, "(期望 403101)");

  // 12) 重新启用后可正常进入
  await call("POST", "/cam/team/member/batch/status", { user_ids: [b.userId], status: 1 }, a.token, teamSpaceId);
  const bInTeam = await call("GET", "/cam/team/info", undefined, b.token, teamSpaceId);
  console.log("userB after re-enable ->", bInTeam.code, bInTeam.data?.name);

  const pass =
    created.code === 0 &&
    personal.data?.type === 1 &&
    teamInfo.data?.type === 2 &&
    perm.data?.privileged === true &&
    (mine.data?.list ?? []).some((t) => t.type === 2) &&
    // 业务错误按项目约定走 envelope（HTTP 200 + code），不是 HTTP 403
    intruder.code === 403101 &&
    alloc.code === 745701 &&
    batch.code === 0 &&
    batch.data?.added === 1 &&
    batch.data?.failed === 1 &&
    st.code === 0 &&
    cg.code === 0 &&
    csvOk &&
    bDisabled.code === 403101 &&
    bInTeam.code === 0;
  console.log(pass ? "\n✅ ALL PASS" : "\n❌ FAIL");
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
