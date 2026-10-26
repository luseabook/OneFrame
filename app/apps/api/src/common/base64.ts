import { AppError, ErrorCode } from "@app/shared";

/**
 * base64 上传体解码（`{file_base64}` 形态的入参共用）。
 *
 * 为什么放 common：剧本解析与画布表格导入都需要它，而 `canvas` 按契约
 * §5.1 禁止依赖 `script` 域；两处各写一份会在"带不带 data-url 前缀"
 * "大小上限报错怎么措辞"这类细节上慢慢分叉。
 */
export function decodeBase64Upload(fileBase64: string, maxBytes = 8 * 1024 * 1024): Buffer {
  const raw = fileBase64.includes(",") ? fileBase64.slice(fileBase64.indexOf(",") + 1) : fileBase64;
  let buffer: Buffer;
  try {
    buffer = Buffer.from(raw, "base64");
  } catch {
    throw new AppError(ErrorCode.INVALID_PARAM, "文件内容不是有效的 base64");
  }
  if (buffer.length === 0) throw new AppError(ErrorCode.INVALID_PARAM, "文件内容为空");
  if (buffer.length > maxBytes) {
    throw new AppError(
      ErrorCode.INVALID_PARAM,
      `文件超过 ${Math.round(maxBytes / 1024 / 1024)}MB 限制`,
    );
  }
  return buffer;
}
