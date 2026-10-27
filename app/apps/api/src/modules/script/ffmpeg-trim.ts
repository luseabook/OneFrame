// ⚠ 这里是**再导出**，不是实现：第 57 批把 `trimVideoBuffer` 下沉到了 `@app/shared`，
// 因为切片转码改走 worker 队列后，**worker 与 API 都要用同一份裁剪实现**
// （两份实现必然漂移：改了一处的 `-ss` 位置，另一处还按 copy 走，就会出现
// "同一个切片在两条路径下时长不一致"这种最难查的问题）。
//
// 保留这个薄文件是为了不动既有 import（`test/ffmpeg-trim.spec.ts` 仍从本路径引，
// 断言裁剪行为），也避免"实现搬走了、调用方忘了改"时静默走旧路径。
export { trimVideoBuffer, type TrimResult } from "@app/shared";
