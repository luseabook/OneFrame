import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  APPLE_ISSUER,
  AppleIdTokenError,
  resetAppleJwksCache,
  verifyAppleIdToken,
  type AppleJwks,
} from "../src/modules/auth/apple-id-token";

/**
 * Apple id_token 校验单测 —— **完全不联网**。
 *
 * 每条负例只改一个变量（alg/签名/kid/iss/aud/exp/iat/nonce），这样失败时能直接看出
 * 是哪一道校验放过了它。密钥对在测试内现生成，JWKS 用 stub 注入，
 * 因此这些用例在任何环境（含 CI 无外网）都能跑，也不需要 Apple 开发者账号。
 */

const CLIENT_ID = "com.oneframe.web";
const KID_RSA = "test-kid-rsa";
const KID_EC = "test-kid-ec";

const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });

function jwkOf(key: typeof rsa.publicKey, kid: string, kty: "RSA" | "EC", alg: string): Record<string, unknown> {
  return { ...(key.export({ format: "jwk" }) as Record<string, unknown>), kid, kty, alg, use: "sig" };
}

const JWKS: AppleJwks = {
  keys: [jwkOf(rsa.publicKey, KID_RSA, "RSA", "RS256"), jwkOf(ec.publicKey, KID_EC, "EC", "ES256")],
};

const NOW_MS = 1_700_000_000_000;
const NOW_S = Math.floor(NOW_MS / 1000);

function b64(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

interface TokenOpts {
  header?: Record<string, unknown>;
  claims?: Record<string, unknown>;
  /** 用哪把私钥签（默认 RSA）；传 null 表示保持签名串原样（用于构造"签名被改"） */
  signing?: "rsa" | "ec" | null;
  alg?: "RS256" | "ES256";
}

function makeToken(o: TokenOpts = {}): string {
  const alg = o.alg ?? "RS256";
  const header = o.header ?? { alg, kid: alg === "ES256" ? KID_EC : KID_RSA, typ: "JWT" };
  const claims = o.claims ?? {
    iss: APPLE_ISSUER,
    aud: CLIENT_ID,
    sub: "001234.apple-subject",
    email: "user@privaterelay.appleid.com",
    email_verified: true,
    iat: NOW_S,
    exp: NOW_S + 600,
  };
  const input = `${b64(header)}.${b64(claims)}`;
  // 注意：null 是"故意不签"的显式取值，不能用 `??` 兜底（null ?? x 会取 x，测试会变成"签对了"）
  const which = o.signing === undefined ? (alg === "ES256" ? "ec" : "rsa") : o.signing;
  if (which === null) return `${input}.${Buffer.from("bogus-signature-bytes").toString("base64url")}`;
  const signature =
    which === "ec"
      ? cryptoSign("sha256", Buffer.from(input), { key: ec.privateKey, dsaEncoding: "ieee-p1363" })
      : cryptoSign("RSA-SHA256", Buffer.from(input), rsa.privateKey);
  return `${input}.${signature.toString("base64url")}`;
}

/** stub JWKS：记录调用次数，用于验证缓存/kid 未命中时的强制刷新 */
function stubJwks(jwks: AppleJwks = JWKS): { provider: () => Promise<AppleJwks>; calls: () => number } {
  let calls = 0;
  return {
    provider: async () => {
      calls += 1;
      return jwks;
    },
    calls: () => calls,
  };
}

const now = (): number => NOW_MS;

async function expectReason(token: string, reason: string, extra: Record<string, unknown> = {}): Promise<void> {
  const stub = stubJwks();
  await expect(verifyAppleIdToken(token, { clientId: CLIENT_ID, jwks: stub.provider, now, ...extra })).rejects.toThrow(
    AppleIdTokenError,
  );
  const stub2 = stubJwks();
  await verifyAppleIdToken(token, { clientId: CLIENT_ID, jwks: stub2.provider, now, ...extra }).catch(
    (err: AppleIdTokenError) => {
      expect(err.reason).toBe(reason);
    },
  );
}

beforeEach(() => resetAppleJwksCache());

describe("verifyAppleIdToken —— 正例", () => {
  it("RS256 合法 token：返回 sub/email，且只拉一次 JWKS", async () => {
    const stub = stubJwks();
    const claims = await verifyAppleIdToken(makeToken(), { clientId: CLIENT_ID, jwks: stub.provider, now });
    expect(claims.sub).toBe("001234.apple-subject");
    expect(claims.email).toBe("user@privaterelay.appleid.com");
    expect(claims.email_verified).toBe(true);
    expect(claims.iss).toBe(APPLE_ISSUER);
    expect(stub.calls()).toBe(1);
  });

  it("ES256 合法 token（P-256 + ieee-p1363 签名）同样通过", async () => {
    const stub = stubJwks();
    const claims = await verifyAppleIdToken(makeToken({ alg: "ES256" }), {
      clientId: CLIENT_ID,
      jwks: stub.provider,
      now,
    });
    expect(claims.sub).toBe("001234.apple-subject");
  });

  it("aud 为数组时只要包含本 client_id 即通过（Apple 多受众场景）", async () => {
    const token = makeToken({ claims: { iss: APPLE_ISSUER, aud: ["other.client", CLIENT_ID], sub: "s1", exp: NOW_S + 60 } });
    const stub = stubJwks();
    const claims = await verifyAppleIdToken(token, { clientId: CLIENT_ID, jwks: stub.provider, now });
    expect(claims.sub).toBe("s1");
  });

  it("时钟漂移 60s 内仍接受（exp 刚好等于 now）", async () => {
    const token = makeToken({ claims: { iss: APPLE_ISSUER, aud: CLIENT_ID, sub: "s2", exp: NOW_S } });
    const stub = stubJwks();
    await expect(verifyAppleIdToken(token, { clientId: CLIENT_ID, jwks: stub.provider, now })).resolves.toBeTruthy();
  });
});

describe("verifyAppleIdToken —— 负例（每例只破坏一个条件）", () => {
  it("alg=none：直接拒（不允许无签名）", async () => {
    // alg=none 的 token 通常第三段为空；这里连签名段一起给，验证"白名单"而不是"分段长度"
    const token = `${b64({ alg: "none", kid: KID_RSA })}.${b64({ iss: APPLE_ISSUER, aud: CLIENT_ID, sub: "s", exp: NOW_S + 60 })}.`;
    await expect(verifyAppleIdToken(token, { clientId: CLIENT_ID, jwks: stubJwks().provider, now })).rejects.toMatchObject(
      { reason: "malformed" },
    );
    await expectReason(
      `${b64({ alg: "none", kid: KID_RSA })}.${b64({ iss: APPLE_ISSUER, aud: CLIENT_ID, sub: "s", exp: NOW_S + 60 })}.${b64("x")}`,
      "bad_alg",
    );
  });

  it("alg=HS256（拿公钥当 HMAC 密钥的经典攻击）被白名单拒掉", async () => {
    await expectReason(
      `${b64({ alg: "HS256", kid: KID_RSA })}.${b64({ iss: APPLE_ISSUER, aud: CLIENT_ID, sub: "s", exp: NOW_S + 60 })}.${b64("sig")}`,
      "bad_alg",
    );
  });

  it("缺 kid → missing_kid（无法定位验签公钥）", async () => {
    const token = makeToken({ header: { alg: "RS256", typ: "JWT" } });
    await expectReason(token, "missing_kid");
  });

  it("kid 不存在 → unknown_kid", async () => {
    const token = makeToken({ header: { alg: "RS256", kid: "not-in-jwks" } });
    await expectReason(token, "unknown_kid");
  });

  it("签名被替换 → bad_signature（claims 完全不变也必须拒）", async () => {
    const token = makeToken({ signing: null });
    await expectReason(token, "bad_signature");
  });

  it("用另一把密钥签（EC 私钥签 RS256 头）→ bad_signature", async () => {
    const header = { alg: "RS256", kid: KID_RSA };
    const claims = { iss: APPLE_ISSUER, aud: CLIENT_ID, sub: "s", exp: NOW_S + 60 };
    const input = `${b64(header)}.${b64(claims)}`;
    const sig = cryptoSign("sha256", Buffer.from(input), { key: ec.privateKey, dsaEncoding: "ieee-p1363" });
    await expectReason(`${input}.${sig.toString("base64url")}`, "bad_signature");
  });

  it("iss 不是 Apple → bad_issuer", async () => {
    const token = makeToken({ claims: { iss: "https://evil.example", aud: CLIENT_ID, sub: "s", exp: NOW_S + 60 } });
    await expectReason(token, "bad_issuer");
  });

  it("aud 是别的 client_id → bad_audience", async () => {
    const token = makeToken({ claims: { iss: APPLE_ISSUER, aud: "com.other.app", sub: "s", exp: NOW_S + 60 } });
    await expectReason(token, "bad_audience");
  });

  it("未配置 client_id → bad_audience（不能通配放行）", async () => {
    const stub = stubJwks();
    await expect(verifyAppleIdToken(makeToken(), { clientId: "", jwks: stub.provider, now })).rejects.toMatchObject({
      reason: "bad_audience",
    });
  });

  it("已过期（超出 60s 漂移容忍）→ expired", async () => {
    const token = makeToken({ claims: { iss: APPLE_ISSUER, aud: CLIENT_ID, sub: "s", exp: NOW_S - 120 } });
    await expectReason(token, "expired");
  });

  it("exp 缺失 → malformed", async () => {
    const token = makeToken({ claims: { iss: APPLE_ISSUER, aud: CLIENT_ID, sub: "s" } });
    await expectReason(token, "malformed");
  });

  it("iat 在未来（超过容忍）→ issued_in_future", async () => {
    const token = makeToken({ claims: { iss: APPLE_ISSUER, aud: CLIENT_ID, sub: "s", iat: NOW_S + 600, exp: NOW_S + 900 } });
    await expectReason(token, "issued_in_future");
  });

  it("分段数不对 / 非 base64 JSON → malformed", async () => {
    for (const bad of ["", "abc", "a.b", "a.b.c.d", `${b64({ alg: "RS256" })}.!!!.${b64("s")}`]) {
      await expect(verifyAppleIdToken(bad, { clientId: CLIENT_ID, jwks: stubJwks().provider, now })).rejects.toMatchObject({
        reason: "malformed",
      });
    }
  });

  it("nonce 不匹配（传了 expectedNonce 时）→ bad_nonce", async () => {
    const token = makeToken({ claims: { iss: APPLE_ISSUER, aud: CLIENT_ID, sub: "s", exp: NOW_S + 60, nonce: "n-real" } });
    await expectReason(token, "bad_nonce", { expectedNonce: "n-expected" });
  });

  it("JWKS 拉取失败 → jwks_unavailable（不静默放行）", async () => {
    const token = makeToken();
    await expect(
      verifyAppleIdToken(token, {
        clientId: CLIENT_ID,
        now,
        jwks: async () => {
          throw new AppleIdTokenError("jwks_unavailable", "network down");
        },
      }),
    ).rejects.toMatchObject({ reason: "jwks_unavailable" });
  });
});
