<script setup lang="ts">
definePageMeta({ ssr: false });
</script>

<template>
  <main class="page">
    <header class="head">
      <h1>隐私政策</h1>
      <p class="date">版本 1.0 · 生效日期 2026-10-24（上线前需经法务确认并替换正式主体信息）</p>
    </header>

    <section class="panel">
      <h2>一、我们收集的信息</h2>
      <ul>
        <li>账号信息：手机号（加密存储，仅用于登录与账号安全）、昵称、头像、注册时间；</li>
        <li>年龄声明：注册时「已满 18 周岁」的确认时间；</li>
        <li>创作数据：项目、大纲、角色、分镜、提示词、生成任务与结果、资产库内容；</li>
        <li>交易记录：积分冻结、结算、解冻流水；</li>
        <li>日志：登录与操作审计、任务执行记录、错误堆栈（已脱敏，禁止写入 token）。</li>
      </ul>
    </section>

    <section class="panel">
      <h2>二、我们如何使用信息</h2>
      <p>
        用于账号登录与鉴权、生成任务调度与计费、内容安全审核（输入敏感词与供应商审核）、
        投诉举报处置、故障排查与产品改进。不会将您的创作内容用于训练通用模型；
        发送给模型供应商的仅为完成本次生成所必需的内容，且按供应商条款处理。
      </p>
    </section>

    <section class="panel">
      <h2>三、存储与保留</h2>
      <ul>
        <li>生成结果文件保留 90 天，到期前 7 天站内提醒并引导转存资产库，转存后按资产规则长期保留；</li>
        <li>回收站资产保留 7 天后物理删除；</li>
        <li>注销账号后立即停止登录、任务记录脱敏，个人数据保留 30 天后物理清理。</li>
      </ul>
    </section>

    <section class="panel">
      <h2>四、共享与披露</h2>
      <p>
        仅在以下情形披露：模型/存储/短信等必要服务供应商（受最小必要与合同约束）、
        法律法规或主管部门要求、涉及人身财产安全的紧急情形。
        运营人员访问用户数据需经授权并留痕。
      </p>
    </section>

    <section class="panel">
      <h2>五、信息安全</h2>
      <p>
        手机号加密存储、验证码哈希比对、访问令牌短期有效并支持刷新与撤销、敏感词审核与频控、
        关键操作（分享、举报、注销）留痕。生产环境将通过 HTTPS 传输并配置安全响应头。
      </p>
    </section>

    <section class="panel">
      <h2>六、你的权利</h2>
      <p>
        你可查询与更正账号信息、导出创作内容、转存与删除资产、撤回分享链接、注销账号。
        注销后进入 30 天保留期，逾期不可恢复；如需恢复请在保留期内联系客服。
      </p>
    </section>

    <section class="panel">
      <h2>七、未成年人保护</h2>
      <p class="muted">平台服务面向已满 18 周岁的用户；未成年人不得注册使用。</p>
    </section>

    <section class="panel">
      <h2>八、政策更新与联系</h2>
      <p class="muted">政策变更将在站内公告；举报与投诉请使用页脚入口，客服邮箱与主体信息以上线后公示为准。</p>
    </section>

    <NuxtLink to="/login" class="home">返回登录</NuxtLink>
  </main>
</template>

<style scoped>
/* 页容器：法务正文页 960 行宽 + 32/32/80 内距 */
.page {
  flex: 1;
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  padding: 32px 32px 80px;
}
.head {
  margin-bottom: var(--space-6);
}
h1 {
  margin: 0;
  font-size: var(--text-2xl);
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text-1);
}
.date {
  margin: var(--space-2) 0 0;
  color: var(--text-3);
  font-size: 13px;
}
/* 卡片范式 C：每个条款分块一张面板 */
.panel {
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2xl);
  padding: var(--space-6);
}
.panel + .panel {
  margin-top: var(--space-4);
}
h2 {
  margin: 0 0 var(--space-3);
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text-1);
}
p,
li {
  color: var(--text-2);
  font-size: var(--text-sm);
  line-height: 1.8;
}
p {
  margin: 0;
}
ul {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.muted {
  color: var(--text-3);
  font-size: var(--text-sm);
}
.home {
  display: inline-block;
  margin-top: var(--space-6);
  color: var(--brand-300);
  font-size: var(--text-sm);
  transition: color var(--duration-fast) var(--ease-out);
}
.home:hover {
  color: var(--text-1);
}

@media (max-width: 768px) {
  .page {
    padding: 16px;
  }
  .panel {
    padding: var(--space-4);
  }
}
</style>
