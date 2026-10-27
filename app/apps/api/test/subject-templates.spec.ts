import { describe, expect, it } from "vitest";
import {
  SUBJECT_TEMPLATES,
  applyTemplateToPrompt,
  findSubjectTemplate,
} from "../src/modules/subjects/subject-templates";

/**
 * IP/风格模板（模块 #17 收尾）。
 *
 * 竞品模板语义**未取证**，本轮是自建口径（见 subject-templates.ts 文件头）：
 * 模板 = 生成时追加的风格前缀 + 负向前缀，**不改主体描述本身**。
 * 这里钉住三件容易被"优化"掉的事：追加而非覆盖、幂等（不重复拼）、未知模板返回 undefined。
 */
describe("subject-templates", () => {
  it("目录有 4 个模板且字段完整（key/name/description/prefix/negative）", () => {
    expect(SUBJECT_TEMPLATES.length).toBe(4);
    for (const template of SUBJECT_TEMPLATES) {
      expect(template.key).toMatch(/^ip-[a-z0-9-]+$/);
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.description.length).toBeGreaterThan(0);
      expect(template.prompt_prefix.length).toBeGreaterThan(10);
      expect(template.negative_prompt.length).toBeGreaterThan(5);
    }
    // key 唯一（重复会让"应用哪个模板"变得不确定）
    expect(new Set(SUBJECT_TEMPLATES.map((t) => t.key)).size).toBe(SUBJECT_TEMPLATES.length);
  });

  it("findSubjectTemplate：命中返回模板，未知/空返回 undefined", () => {
    expect(findSubjectTemplate("ip-anime")?.name).toBe("日系动漫");
    expect(findSubjectTemplate("ip-not-exist")).toBeUndefined();
    expect(findSubjectTemplate(null)).toBeUndefined();
    expect(findSubjectTemplate(undefined)).toBeUndefined();
  });

  it("applyTemplateToPrompt：**追加**前缀而不是覆盖原描述", () => {
    const template = findSubjectTemplate("ip-anime")!;
    const original = "少女，黑长直，校服，表情倔强";
    const merged = applyTemplateToPrompt(original, template);
    expect(merged.startsWith(original)).toBe(true);
    expect(merged).toContain(template.prompt_prefix);
    expect(merged.length).toBeGreaterThan(original.length);
  });

  it("applyTemplateToPrompt：幂等（已含前缀时不重复拼接）", () => {
    const template = findSubjectTemplate("ip-3d")!;
    const once = applyTemplateToPrompt("机器人伙伴", template);
    const twice = applyTemplateToPrompt(once, template);
    expect(twice).toBe(once);
    expect(twice.split(template.prompt_prefix).length - 1).toBe(1);
  });

  it("applyTemplateToPrompt：描述为空时直接给前缀（不拼出以逗号开头的脏串）", () => {
    const template = findSubjectTemplate("ip-realistic")!;
    expect(applyTemplateToPrompt("", template)).toBe(template.prompt_prefix);
    expect(applyTemplateToPrompt(null, template)).toBe(template.prompt_prefix);
  });

  it("applyTemplateToPrompt：无模板时原样返回（零回归）", () => {
    expect(applyTemplateToPrompt("原始描述", undefined)).toBe("原始描述");
    expect(applyTemplateToPrompt(null, undefined)).toBe("");
  });

  it("描述以中文/英文逗号结尾时不重复加逗号", () => {
    const template = findSubjectTemplate("ip-guofeng")!;
    const zh = applyTemplateToPrompt("古装侠客，", template);
    expect(zh).toContain("古装侠客，" + template.prompt_prefix);
    expect(zh).not.toContain("，，");
    const en = applyTemplateToPrompt("knight,", template);
    expect(en.startsWith("knight,")).toBe(true);
    expect(en).not.toContain(",,");
  });
});
