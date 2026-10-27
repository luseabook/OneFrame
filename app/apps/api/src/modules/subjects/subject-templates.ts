/**
 * IP/风格模板目录（模块 #17 收尾）。
 *
 * ## 竞品证据与边界（必须先读）
 * 竞品 `_parts/d-model-task.md:152` 的能力表里有 `redraw-to-image` 等模式，主体库里也有"IP 模板"概念，
 * 但**模板的具体字段与生效方式未取证**（`commands/subject.md` 只有主体 CRUD/review/business_list）。
 * 因此这里采用**自建口径**，并在 API 契约（api-spec §17.11）与前端文案里如实标注：
 *
 *   「模板 = 生成时追加的**风格前缀 + 负向前缀**，不改主体描述本身」
 *
 * 不做的事（避免把猜测当实现）：
 * - 不做"模板即换脸/换画风模型"的承诺（那需要独立模型与训练，竞品证据不足）；
 * - 不覆盖主体已有 prompt（只追加，重复应用同一模板也只追加一次）。
 *
 * 为什么放在服务端常量而不是数据库表：模板是**产品预置**内容（4 个），
 * 运营不需要在线增删；等竞品字段取证后再考虑入库（届时加 `subject_templates` 表）。
 */

export interface SubjectTemplate {
  key: string;
  name: string;
  description: string;
  /** 生成时追加在主体描述**之后**的风格前缀 */
  prompt_prefix: string;
  /** 生成时追加的负向前缀（适配器支持 negative prompt 时使用） */
  negative_prompt: string;
}

export const SUBJECT_TEMPLATES: SubjectTemplate[] = [
  {
    key: "ip-anime",
    name: "日系动漫",
    description: "线条干净、高饱和、赛璐璐上色；适合番剧/短剧二次元线",
    prompt_prefix:
      "anime style, clean lineart, cel shading, high saturation, consistent character design, 2D illustration",
    negative_prompt: "photorealistic, 3d render, extra fingers, deformed hands, text watermark",
  },
  {
    key: "ip-realistic",
    name: "写实影视",
    description: "真实质感与光影，接近实拍剧照",
    prompt_prefix:
      "photorealistic, cinematic lighting, film still, 35mm lens, natural skin texture, shallow depth of field",
    negative_prompt: "cartoon, anime, plastic skin, oversaturated, watermark",
  },
  {
    key: "ip-3d",
    name: "3D 卡通",
    description: "皮克斯式 3D 卡通角色，圆润造型与柔和材质",
    prompt_prefix:
      "3d cartoon character, pixar style, soft global illumination, subsurface scattering, rounded shapes, high detail",
    negative_prompt: "flat 2d, sketch, low poly, distorted face, watermark",
  },
  {
    key: "ip-guofeng",
    name: "国风古装",
    description: "东方美学、水墨与绢本质感，适合古装题材",
    prompt_prefix:
      "chinese traditional style, ink wash texture, silk painting, oriental aesthetics, elegant costume details",
    negative_prompt: "modern clothing, western architecture, neon, watermark",
  },
];

const TEMPLATE_MAP = new Map(SUBJECT_TEMPLATES.map((template) => [template.key, template]));

export function findSubjectTemplate(key: string | null | undefined): SubjectTemplate | undefined {
  if (!key) return undefined;
  return TEMPLATE_MAP.get(key);
}

/**
 * 把模板前缀拼到主体描述之后（**追加，不覆盖**）。
 *
 * 幂等：若 prompt 里已经包含该前缀（用户手动加过或重复应用），不再重复拼接。
 * `prompt` 为空时直接返回前缀本身（模板也要求主体先有描述，但空描述不该拼出脏串）。
 */
export function applyTemplateToPrompt(prompt: string | null, template: SubjectTemplate | undefined): string {
  if (!template) return prompt ?? "";
  const base = (prompt ?? "").trim();
  if (!base) return template.prompt_prefix;
  if (base.includes(template.prompt_prefix)) return base;
  return `${base}${base.endsWith("，") || base.endsWith(",") ? "" : "，"}${template.prompt_prefix}`;
}
