<script setup lang="ts">
definePageMeta({ ssr: false });
</script>

<template>
  <main class="page">
    <h1>用户协议</h1>
    <p class="muted">版本 1.0 · 生效日期 2026-10-24（上线前需经法务确认并替换正式主体信息）</p>

    <section>
      <h2>一、服务内容</h2>
      <p>
        OneFrame（万帧）提供 AI 短剧生产工具：文本生成视频、图像生成视频、剧本流水线（大纲／角色／分镜／批量出片）、
        资产库与作品分享。服务当前处于 Alpha 阶段，以邀请制免费开放。
      </p>
    </section>

    <section>
      <h2>二、账号与年龄</h2>
      <p>
        账号通过手机号验证码登录，Alpha 阶段需有效邀请码方可注册。
        注册即表示您已满 18 周岁并同意本协议；我们会对该声明留痕。
        您可随时在「账号设置」中注销账号。
      </p>
    </section>

    <section>
      <h2>三、生成内容与 AI 标识</h2>
      <p>
        平台生成内容均带「显式水印 + 隐式元数据」双重 AI 生成标识，您在下载、分享、转存时须保留该标识。
        平台不对生成内容的合法性、准确性作担保，请勿将生成内容直接用于医疗、法律、金融等专业场景。
      </p>
    </section>

    <section>
      <h2>四、积分与计费</h2>
      <p>
        Alpha 阶段积分来自注册赠送与邀请奖励，不可充值、不可提现、不可转让，永久有效。
        创建任务时冻结积分，成功结算、失败或取消后解冻；任何时点余额与流水满足 balance = Σdelta、frozen = Σfrozen_delta。
        支付能力上线后将以 Beta 形式提供，届时另行公示退款规则。
      </p>
    </section>

    <section>
      <h2>五、内容规范与违规处置</h2>
      <p>
        不得利用平台生成违法违规内容（涉黄涉暴、赌博诈骗、恐怖暴力、侵权盗用等）。
        平台对输入与输出均进行敏感内容审核，违规内容将被拦截且不扣费。
        收到举报或发现违规时，平台有权撤销分享链接、下架内容、冻结或注销账号。
      </p>
    </section>

    <section>
      <h2>六、知识产权</h2>
      <p>
        您输入的素材与提示词的权利归您或相应权利人所有；您在合法范围内使用生成内容产生的权利归您所有。
        请确保您有权使用所上传的全部素材，并就第三方主张的权利向我们承担相应责任。
      </p>
    </section>

    <section>
      <h2>七、免责与终止</h2>
      <p>
        因不可抗力、供应商服务中断、网络故障等导致服务中断的，平台不承担赔偿责任。
        您可随时停止使用并注销账号；平台也可为遵守法律法规或保护平台与其他用户权益而终止服务。
      </p>
    </section>

    <section>
      <h2>八、联系我们</h2>
      <p class="muted">举报与投诉：页脚「举报 / 投诉」入口；客服邮箱与主体信息以上线后公示为准。</p>
    </section>

    <NuxtLink to="/login" class="home">返回登录</NuxtLink>
  </main>
</template>

<style scoped>
.page {
  flex: 1;
  max-width: 760px;
  width: 100%;
  margin: 0 auto;
  padding: 24px 32px;
  line-height: 1.85;
}
h1 {
  font-size: 22px;
  margin: 0 0 4px;
}
h2 {
  font-size: 15px;
  margin: 20px 0 6px;
}
p {
  margin: 0;
  color: var(--text-inverse-2);
  font-size: 13px;
}
.muted {
  color: var(--text-inverse-3);
  font-size: 12px;
}
.home {
  display: inline-block;
  margin-top: 24px;
  color: var(--text-inverse-3);
  font-size: 12px;
}
</style>
