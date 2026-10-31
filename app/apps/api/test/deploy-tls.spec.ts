import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 生产入口 TLS 守卫（第 107 批）。
 *
 * 背景：`docker-compose.prod.yml` 此前只发布 `8080:80`，nginx 只写 `listen 80`，
 * TLS 全靠"外层 LB/CDN 终止"这一句口头约定 —— 但仓库里既没有 LB 配置，也没有地方
 * 证明证书装在哪。结果是：**照仓库部署，业务是明文 HTTP；HSTS 只能保持注释。**
 *
 * 这类缺陷没法靠 typecheck / lint / build 发现（YAML 与 nginx 配置都是合法文本），
 * 而本机**没有 Docker**，`docker compose config` / `up` 也跑不了。所以最小可复跑的守卫
 * 只能做静态断言：compose 的端口/挂载/必填变量、模板里 80 与 443 两个 server 的分工、
 * 证书路径、HSTS 是否真的启用、以及"跳转目标不能拿 Host 头拼"。
 *
 * **仍然未验证**：真实 TLS 握手、证书链完整性、ACME 续期。这些必须在部署机上
 * `docker compose up` 一次并留存日志（deployment.md §3 的 PR-01 关闭条件）。
 */
const APP_ROOT = join(__dirname, "..", "..", "..");
const REPO_ROOT = join(APP_ROOT, "..");

const COMPOSE = join(APP_ROOT, "docker-compose.prod.yml");
const TEMPLATE = join(APP_ROOT, "deploy", "nginx.conf.template");
const OLD_NGINX_CONF = join(APP_ROOT, "deploy", "nginx.conf");
const CERT_SCRIPT = join(APP_ROOT, "deploy", "gen-selfsigned-cert.sh");
const ROLLBACK = join(APP_ROOT, "deploy", "rollback.sh");
const ENV_EXAMPLE = join(APP_ROOT, ".env.production.example");
const GITIGNORE = join(REPO_ROOT, ".gitignore");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** 取出文件里所有 `${NAME}` 形式的 envsubst 占位符（去重、排序）。 */
function envsubstPlaceholders(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
    names.add(m[1]);
  }
  return [...names].sort();
}

describe("prod compose：nginx 独立终止 TLS", () => {
  const yaml = read(COMPOSE);

  it("同时发布 80 与 443（不再只有 8080:80）", () => {
    expect(yaml).toContain('"80:80"');
    expect(yaml).toContain('"443:443"');
    expect(yaml).not.toContain("8080:80");
  });

  it("TLS_SERVER_NAME 用 `:?` 强制必填（缺失即解析阶段失败）", () => {
    expect(yaml).toMatch(/TLS_SERVER_NAME:\s*\$\{TLS_SERVER_NAME:\?/);
  });

  it("模板、证书、ACME 目录都以**只读**方式挂载", () => {
    expect(yaml).toContain(
      "./deploy/nginx.conf.template:/etc/nginx/templates/default.conf.template:ro",
    );
    expect(yaml).toContain("/etc/nginx/certs:ro");
    expect(yaml).toContain("/var/www/certbot:ro");
  });

  it("健康检查走 443 的 /nginx-health（不依赖 api，也不走 80 的 308）", () => {
    expect(yaml).toContain("https://127.0.0.1/nginx-health");
  });

  it("旧的 deploy/nginx.conf 已改名，不存在两份会漂移的配置", () => {
    expect(existsSync(OLD_NGINX_CONF)).toBe(false);
    expect(existsSync(TEMPLATE)).toBe(true);
  });
});

describe("nginx 模板：80 与 443 分工", () => {
  const conf = read(TEMPLATE);

  it("只有一个 80 server 和一个 443 server", () => {
    expect(conf.match(/^\s*listen 80;\s*$/gm) ?? []).toHaveLength(1);
    expect(conf.match(/^\s*listen 443 ssl;\s*$/gm) ?? []).toHaveLength(1);
    expect(conf.match(/^\s*server_name \$\{TLS_SERVER_NAME\};\s*$/gm) ?? []).toHaveLength(2);
  });

  it("80 保留 ACME HTTP-01 校验目录", () => {
    expect(conf).toContain("location /.well-known/acme-challenge/");
    expect(conf).toContain("root /var/www/certbot;");
  });

  it("80 用 308 跳到 https，且跳转目标写死域名 —— 不用 $host（否则是开放重定向）", () => {
    expect(conf).toContain("return 308 https://${TLS_SERVER_NAME}$request_uri;");
    expect(conf).not.toContain("https://$host");
    expect(conf).not.toContain("https://${host}");
  });

  it("443 上 http2、证书路径与 TLS 1.2/1.3 都已就位", () => {
    expect(conf).toContain("http2 on;");
    expect(conf).toContain("ssl_certificate /etc/nginx/certs/fullchain.pem;");
    expect(conf).toContain("ssl_certificate_key /etc/nginx/certs/privkey.pem;");
    expect(conf).toContain("ssl_protocols TLSv1.2 TLSv1.3;");
    expect(conf).toContain("ssl_session_tickets off;");
  });

  it("HSTS 已真正启用（不是注释），且带 includeSubDomains", () => {
    expect(conf).toContain(
      'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;',
    );
    // 行首若被 `#` 注释，上面的 toContain 仍会匹配 —— 这里单独钉住"未被注释"。
    expect(conf).not.toMatch(/^\s*#\s*add_header Strict-Transport-Security/m);
  });

  it("CSP 仍保持注释（Nuxt hydration 未接 nonce，启用会白屏）", () => {
    expect(conf).toMatch(/^\s*#\s*add_header Content-Security-Policy/m);
    expect(conf).not.toMatch(/^\s*add_header Content-Security-Policy/m);
  });

  it("体积上限与 API bodyLimit 对齐到 48m", () => {
    expect(conf).toContain("client_max_body_size 48m;");
  });

  it("健康检查端点与同源反代仍然正确", () => {
    expect(conf).toContain("location = /nginx-health");
    expect(conf).toContain('set $api_upstream "api:3000";');
    expect(conf).toContain('set $web_upstream "web:3001";');
    expect(conf).toContain("proxy_pass http://$api_upstream;");
    expect(conf).toContain("proxy_pass http://$web_upstream;");
  });

  it("envsubst 只会替换 ${TLS_SERVER_NAME}，不会吃掉 nginx 自己的 $host/$scheme", () => {
    expect(envsubstPlaceholders(conf)).toEqual(["TLS_SERVER_NAME"]);
    for (const v of ["$host", "$request_uri", "$scheme", "$remote_addr"]) {
      expect(conf).toContain(v);
    }
  });
});

describe("证书与回滚链路", () => {
  it(".env.production.example 暴露 TLS_SERVER_NAME，并说明 COOKIE_SECURE=true", () => {
    const env = read(ENV_EXAMPLE);
    expect(env).toMatch(/^TLS_SERVER_NAME=/m);
    expect(env).toContain("COOKIE_SECURE=true");
  });

  it(".gitignore 忽略证书私钥，但保留 .gitkeep", () => {
    const ig = read(GITIGNORE);
    expect(ig).toContain("app/deploy/certs/*");
    expect(ig).toContain("!app/deploy/certs/.gitkeep");
    expect(ig).toContain("app/deploy/acme-webroot/*");
    expect(ig).toContain("!app/deploy/acme-webroot/.gitkeep");
  });

  it("自签脚本拒绝覆盖已有证书（避免把手滑把线上证书换成自签）", () => {
    const script = read(CERT_SCRIPT);
    expect(script).toContain("refusing to overwrite existing certificate");
    expect(script).toContain("openssl req -x509");
    expect(script).toContain("-addext \"subjectAltName=DNS:${HOST}\"");
  });

  it("rollback.sh 的 readiness 走 443（不能走 80：curl -f 把 308 当成功会假通过）", () => {
    const sh = read(ROLLBACK);
    expect(sh).toContain('HEALTH_URL="${HEALTH_URL:-https://127.0.0.1/v1/healthz/ready}"');
    expect(sh).not.toContain("http://127.0.0.1:8080/v1/healthz/ready");
    expect(sh).toContain('CURL_OPTS="${CURL_OPTS--k}"');
  });
});