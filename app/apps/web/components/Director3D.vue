<script setup lang="ts">
/**
 * 3D 导演台（对齐参照 product 的导演台形态）
 * - 真实 three.js 场景：网格地面 / 角色站位 / 机位框 / 视角切换
 * - 左「素材区 + 3D场景」、右「机位区 + 机位参数」，中间 3D 视口 + 方向 gizmo + 底部工具条
 * - 机位与站位存 localStorage（每镜头一份），"定格" 可导出当前视角 PNG
 */
import * as THREE from "three";
import { useDirectorPersistence } from "~/components/director/useDirectorPersistence";

const props = withDefaults(
  defineProps<{
    open: boolean;
    shotId?: string;
    shotNo?: number;
    actors?: Array<{ id: string; name: string; image?: string | null }>;
    /** 项目上下文：有值时场景会持久化到服务端（`/v1/director/scenes`），否则只存 localStorage */
    projectId?: string;
    episodeId?: string;
  }>(),
  { shotId: "", shotNo: 1, actors: () => [], projectId: "", episodeId: "" },
);
const emit = defineEmits<{ close: []; captured: [dataUrl: string] }>();

// ── 状态 ──
const viewMode = ref<"director" | "camera">("director");
const gridSnap = ref(true);
const showLabels = ref(true);
const groundOpacity = ref(0.4);
const sceneScale = ref(100);
const sceneRot = reactive({ x: 0, y: 0, z: 0 });
const camPos = reactive({ x: 2.4, y: 2.2, z: 3.2 });
const camTarget = reactive({ x: 0, y: 1, z: 0 });
const fov = ref(50);
const facingMode = ref<"manual" | "actor" | "center">("manual");
const search = ref("");
const snapMsg = ref("");
const canvasHost = ref<HTMLDivElement | null>(null);

// ── three 运行时 ──
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let directorCam: THREE.PerspectiveCamera | null = null;
let shotCam: THREE.PerspectiveCamera | null = null;
let activeCam: THREE.PerspectiveCamera | null = null;
let ground: THREE.Mesh | null = null;
let grid: THREE.GridHelper | null = null;
let actorGroup: THREE.Group | null = null;
let shotFrame: THREE.LineSegments | null = null;
let labels: THREE.Sprite[] = [];
const actorsWithTexture: THREE.Mesh[] = [];
let raf = 0;
const orbit = { theta: Math.PI * 0.15, phi: Math.PI * 0.42, radius: 9, dragging: false, lastX: 0, lastY: 0 };
const snapStep = 0.5;
const STORAGE_KEY = () => `director3d:${props.shotId || "default"}`;

type Actor = { id: string; name: string; x: number; z: number; rot: number; pose: PoseKey; image?: string | null };
type Cam = { id: string; name: string; pos: { x: number; y: number; z: number }; target: { x: number; y: number; z: number }; fov: number };
const POSE_KEYS = ["stand", "walk", "sit", "jump"] as const;
type PoseKey = (typeof POSE_KEYS)[number];
const POSE_META: Record<PoseKey, { label: string; scaleY: number; lift: number; tilt: number }> = {
  stand: { label: "站立", scaleY: 1, lift: 0.75, tilt: 0 },
  walk: { label: "行走", scaleY: 1, lift: 0.78, tilt: 0.18 },
  sit: { label: "坐姿", scaleY: 0.62, lift: 0.42, tilt: 0.08 },
  jump: { label: "跳跃", scaleY: 1.02, lift: 1.12, tilt: -0.12 },
};

const positions = ref<Actor[]>([]);
const cameras = ref<Cam[]>([
  { id: "cam-1", name: "机位1", pos: { x: 2.4, y: 2.2, z: 3.2 }, target: { x: 0, y: 1, z: 0 }, fov: 50 },
]);
const activeCamIndex = ref(0);
const selectedActorId = ref<string | null>(null);
const textureReady = ref<Record<string, boolean>>({});
const dragState = { id: null as string | null, plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0) };
const camSelect = computed({
  get: () => cameras.value[activeCamIndex.value]?.id ?? "",
  set: (id: string) => {
    const idx = cameras.value.findIndex((c) => c.id === id);
    if (idx >= 0) switchCamera(idx);
  },
});

/** 把编辑缓冲写回当前机位，保证列表/机位框同步 */
function syncActiveCam(): void {
  const cam = cameras.value[activeCamIndex.value];
  if (!cam) return;
  cam.pos = { ...camPos };
  cam.target = { ...camTarget };
  cam.fov = fov.value;
}
function switchCamera(index: number): void {
  const cam = cameras.value[index];
  if (!cam) return;
  activeCamIndex.value = index;
  Object.assign(camPos, cam.pos);
  Object.assign(camTarget, cam.target);
  fov.value = cam.fov;
  saveState();
  snapMsg.value = `已切换到 ${cam.name}`;
  setTimeout(() => (snapMsg.value = ""), 1500);
}
function addCamera(): void {
  syncActiveCam();
  const idx = cameras.value.length + 1;
  cameras.value = [
    ...cameras.value,
    {
      id: `cam-${Date.now()}`,
      name: `机位${idx}`,
      pos: { x: -2.4, y: 2.0, z: 3.0 },
      target: { x: 0, y: 1, z: 0 },
      fov: 50,
    },
  ];
  switchCamera(cameras.value.length - 1);
}
function removeCamera(index: number): void {
  if (cameras.value.length <= 1) {
    snapMsg.value = "至少保留一个机位";
    setTimeout(() => (snapMsg.value = ""), 1500);
    return;
  }
  const list = cameras.value.filter((_, i) => i !== index);
  cameras.value = list;
  switchCamera(Math.max(0, Math.min(index, list.length - 1)));
}
/** 把当前编辑缓冲另存为新机位 */
function duplicateCamera(): void {
  syncActiveCam();
  const cur = cameras.value[activeCamIndex.value]!;
  cameras.value = [
    ...cameras.value,
    { id: `cam-${Date.now()}`, name: `机位${cameras.value.length + 1}`, pos: { ...cur.pos }, target: { ...cur.target }, fov: cur.fov },
  ];
  switchCamera(cameras.value.length - 1);
}

function loadState(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY());
    if (raw) {
      const s = JSON.parse(raw) as Record<string, unknown>;
      Object.assign(camPos, (s.camPos as typeof camPos) ?? camPos);
      Object.assign(camTarget, (s.camTarget as typeof camTarget) ?? camTarget);
      if (typeof s.fov === "number") fov.value = s.fov;
      if (typeof s.groundOpacity === "number") groundOpacity.value = s.groundOpacity;
      if (Array.isArray(s.cameras) && s.cameras.length) {
        cameras.value = (s.cameras as Cam[]).map((c, i) => ({
          ...c,
          name: c.name || `机位${i + 1}`,
        }));
        activeCamIndex.value = Math.min(Number(s.activeCamIndex ?? 0) || 0, cameras.value.length - 1);
      }
      if (Array.isArray(s.positions)) {
        positions.value = (s.positions as Array<Partial<Actor>>).map((p, i) => ({
          id: p.id ?? `actor-${i}`,
          name: p.name ?? `角色${i + 1}`,
          x: Number(p.x ?? 0),
          z: Number(p.z ?? 0),
          rot: Number(p.rot ?? 0),
          pose: (POSE_KEYS as readonly string[]).includes(String(p.pose)) ? (p.pose as PoseKey) : "stand",
          image: p.image ?? null,
        }));
      }
    }
  } catch {
    /* ignore */
  }
  if (!positions.value.length) {
    positions.value = props.actors.slice(0, 6).map((a, i) => ({
      id: a.id,
      name: a.name,
      x: Number(((i - (props.actors.length - 1) / 2) * 1.6).toFixed(2)),
      z: 0,
      rot: 0,
      pose: "stand" as PoseKey,
      image: a.image ?? null,
    }));
  }
  // 编辑缓冲取当前机位
  const cam = cameras.value[activeCamIndex.value];
  if (cam) {
    Object.assign(camPos, cam.pos);
    Object.assign(camTarget, cam.target);
    fov.value = cam.fov;
  }
}
function saveState(): void {
  syncActiveCam();
  try {
    localStorage.setItem(
      STORAGE_KEY(),
      JSON.stringify({
        camPos: { ...camPos },
        camTarget: { ...camTarget },
        fov: fov.value,
        groundOpacity: groundOpacity.value,
        positions: positions.value,
        cameras: cameras.value,
        activeCamIndex: activeCamIndex.value,
      }),
    );
  } catch {
    /* ignore */
  }
}

// ── 服务端持久化（场景快照 / 姿态预设 / 编辑心跳）──────────────
//
// 分工：`useDirectorPersistence` 只负责协议（保存/乐观锁/预设/心跳），
// 这里负责**组件状态 ↔ payload 的唯一映射**。两边都不碰对方的细节。
const presetName = ref("");
const presetScope = ref(1);
/** 正在应用远端快照时不要把它当成"用户改动"（否则一载入就变 dirty、马上又存一遍） */
let applyingRemote = false;
/** 远端快照应用后的短暂抑制窗口：`rebuildActors()` 等 nextTick 里的同步还会轻微改状态 */
let suppressDirtyUntil = 0;

function showSnap(message: string): void {
  snapMsg.value = message;
  setTimeout(() => (snapMsg.value = ""), 2200);
}

/**
 * 组件状态 → 场景快照。
 *
 * 字段名与本地存档（`saveState`）保持一致，并额外带 `settings`（视图/网格/标签/缩放/旋转）：
 * 这些是"导演台看起来是什么样"的一部分，只存相机和站位的话，重开项目视角全丢。
 */
function sceneSnapshot(): Record<string, unknown> {
  syncActiveCam();
  return {
    schema_version: 1,
    camPos: { ...camPos },
    camTarget: { ...camTarget },
    fov: fov.value,
    groundOpacity: groundOpacity.value,
    positions: positions.value.map((p) => ({ ...p })),
    cameras: cameras.value.map((c) => ({ ...c, pos: { ...c.pos }, target: { ...c.target } })),
    activeCamIndex: activeCamIndex.value,
    settings: {
      viewMode: viewMode.value,
      gridSnap: gridSnap.value,
      showLabels: showLabels.value,
      sceneScale: sceneScale.value,
      sceneRot: { ...sceneRot },
    },
  };
}

/**
 * 快照 → 组件状态（防御式）。
 *
 * 为什么每个字段都要兜底：payload 可能来自**旧版本编辑器**（用户半年前存的场景），
 * 少一个字段就抛异常的话，用户打开项目等于导演台打不开；宁可退化成默认值。
 */
function applySceneSnapshot(payload: Record<string, unknown>): void {
  applyingRemote = true;
  try {
    const num = (value: unknown, fallback: number): number =>
      typeof value === "number" && Number.isFinite(value) ? value : fallback;
    const readVec = (value: unknown, fallback: { x: number; y: number; z: number }) => {
      const record = (value ?? {}) as Record<string, unknown>;
      return {
        x: num(record.x, fallback.x),
        y: num(record.y, fallback.y),
        z: num(record.z, fallback.z),
      };
    };
    Object.assign(camPos, readVec(payload.camPos, { x: 2.4, y: 2.2, z: 3.2 }));
    Object.assign(camTarget, readVec(payload.camTarget, { x: 0, y: 1, z: 0 }));
    fov.value = num(payload.fov, 50);
    groundOpacity.value = Math.min(1, Math.max(0, num(payload.groundOpacity, 0.4)));

    if (Array.isArray(payload.cameras) && payload.cameras.length > 0) {
      cameras.value = (payload.cameras as Array<Record<string, unknown>>).map((raw, index) => ({
        id: typeof raw.id === "string" ? raw.id : `cam-${index + 1}`,
        name: typeof raw.name === "string" && raw.name ? raw.name : `机位${index + 1}`,
        pos: readVec(raw.pos, { x: 2.4, y: 2.2, z: 3.2 }),
        target: readVec(raw.target, { x: 0, y: 1, z: 0 }),
        fov: num(raw.fov, 50),
      }));
      activeCamIndex.value = Math.min(Math.max(0, num(payload.activeCamIndex, 0)), cameras.value.length - 1);
    }
    if (Array.isArray(payload.positions)) {
      positions.value = (payload.positions as Array<Record<string, unknown>>).map((raw, index) => ({
        id: typeof raw.id === "string" ? raw.id : `actor-${index}`,
        name: typeof raw.name === "string" && raw.name ? raw.name : `角色${index + 1}`,
        x: num(raw.x, 0),
        z: num(raw.z, 0),
        rot: num(raw.rot, 0),
        pose: (POSE_KEYS as readonly string[]).includes(String(raw.pose)) ? (raw.pose as PoseKey) : "stand",
        image: typeof raw.image === "string" ? raw.image : null,
      }));
    }
    const settings = (payload.settings ?? {}) as Record<string, unknown>;
    viewMode.value = settings.viewMode === "camera" ? "camera" : "director";
    gridSnap.value = settings.gridSnap !== false;
    showLabels.value = settings.showLabels !== false;
    sceneScale.value = Math.min(200, Math.max(60, num(settings.sceneScale, 100)));
    Object.assign(sceneRot, readVec(settings.sceneRot, { x: 0, y: 0, z: 0 }));

    // 相机缓冲跟随当前机位（与 switchCamera 的后置状态一致）
    const cam = cameras.value[activeCamIndex.value];
    if (cam) {
      Object.assign(camPos, cam.pos);
      Object.assign(camTarget, cam.target);
      fov.value = cam.fov;
    }
  } finally {
    /**
     * 同步复位（不放在 nextTick 里）+ 200ms 抑制窗口：
     * 组件 watcher 用 `flush: "sync"`，远端快照的每次字段赋值都会同步触发它；
     * 而 `rebuildActors()` 等在 nextTick 里可能再改一点状态。两者都算"同步远端结果"，
     * 不该让用户看到"刚打开就提示有未保存修改"。
     */
    applyingRemote = false;
    suppressDirtyUntil = Date.now() + 200;
  }
  if (scene) {
    nextTick(() => {
      rebuildActors();
      resize();
    });
  }
}

const persistence = useDirectorPersistence({
  projectId: () => props.projectId || undefined,
  episodeId: () => props.episodeId || undefined,
  snapshot: sceneSnapshot,
  restore: applySceneSnapshot,
  /**
   * 姿态预设是**快照子集**（只含站位/机位）：应用时只覆盖这两块，
   * 不覆盖当前视图设置——用户刚调好的导演视角不该被预设带走。
   */
  applyPresetPayload: (payload) => {
    applySceneSnapshot({ ...sceneSnapshot(), ...payload });
  },
  notify: showSnap,
});

const presetOptions = computed(() => persistence.presets.value);

/** 模板里用短名（ref 在模板中自动解包） */
const sceneDirty = persistence.dirty;
const sceneSaving = persistence.saving;
const sceneConflictVersion = persistence.conflictVersion;
const sceneCollaborators = persistence.collaborators;
const sceneStatusText = persistence.statusText;
const sceneError = persistence.error;
const scenePresetSaving = persistence.presetSaving;

function onPresetChange(event: Event): void {
  const id = (event.target as HTMLSelectElement).value;
  const preset = presetOptions.value.find((item) => item.id === id);
  if (preset) persistence.applyPreset(preset);
  (event.target as HTMLSelectElement).value = "";
}

async function savePresetNow(): Promise<void> {
  const ok = await persistence.savePreset(presetName.value, presetScope.value);
  if (ok) presetName.value = "";
}

async function saveNow(): Promise<void> {
  const ok = await persistence.save();
  if (ok) saveState();
}

async function syncFromServer(): Promise<void> {
  if (!props.projectId) return;
  await persistence.loadPresets();
  const loaded = await persistence.loadLatest();
  if (loaded) {
    // 服务端快照为准，顺手镜像回本地（断网时还能用上次的）
    saveState();
    showSnap(`已载入场景 v${persistence.version.value}`);
  }
  void persistence.heartbeat();
}

/** 关闭前把未保存改动落一次（尽力而为：失败也不阻塞关闭） */
async function closePanel(): Promise<void> {
  if (persistence.dirty.value && persistence.conflictVersion.value === null) {
    await persistence.save();
  }
  persistence.dispose();
  emit("close");
}


function makeLabel(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, 0, 256, 64);
  ctx.font = "bold 28px system-ui, sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.slice(0, 10), 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.2, 0.3, 1);
  return sprite;
}

/** 角色占位体 + 定妆图贴图（可选）+ 名称标签 */
function rebuildActors(): void {
  if (!scene) return;
  if (actorGroup) {
    scene.remove(actorGroup);
    actorGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mat = obj.material as THREE.Material & { map?: THREE.Texture | null };
        mat.map?.dispose();
        mat.dispose();
      }
      if (obj instanceof THREE.Sprite) {
        obj.material.map?.dispose();
        obj.material.dispose();
      }
    });
  }
  actorGroup = new THREE.Group();
  labels = [];
  actorsWithTexture.length = 0;
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");

  for (const pos of positions.value) {
    const pose = POSE_META[pos.pose] ?? POSE_META.stand;
    const selected = selectedActorId.value === pos.id;

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.28, 0.9, 6, 12),
      new THREE.MeshStandardMaterial({
        color: selected ? 0xcf9fff : 0x9b46ff,
        roughness: 0.55,
        metalness: 0.15,
        transparent: true,
        opacity: pos.image ? 0.25 : 1,
      }),
    );
    body.position.set(pos.x, pose.lift, pos.z);
    body.scale.set(1, pose.scaleY, 1);
    body.rotation.z = pose.tilt;
    body.rotation.y = (pos.rot * Math.PI) / 180;
    body.name = `actor:${pos.id}`;
    body.userData = { actorId: pos.id, kind: "body" };
    actorGroup.add(body);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 0.04, 24),
      new THREE.MeshBasicMaterial({ color: selected ? 0xcf9fff : 0x9b46ff, transparent: true, opacity: 0.28 }),
    );
    base.position.set(pos.x, 0.02, pos.z);
    actorGroup.add(base);

    // 定妆图贴图（billboard 平面，加载失败则忽略，保留胶囊占位）
    if (pos.image) {
      const planeMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.96, depthWrite: false });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.5), planeMat);
      plane.position.set(pos.x, 0.8, pos.z);
      plane.userData = { actorId: pos.id, kind: "texture" };
      if (textureReady.value[pos.id]) {
        // 已缓存过：直接从 userData 复用
        const cached = textureReady.value[`${pos.id}:tex`];
        void cached;
      }
      loader.load(
        pos.image,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          planeMat.map = tex;
          planeMat.needsUpdate = true;
          textureReady.value = { ...textureReady.value, [pos.id]: true };
        },
        undefined,
        () => {
          textureReady.value = { ...textureReady.value, [pos.id]: false };
        },
      );
      actorGroup.add(plane);
      actorsWithTexture.push(plane);
    }

    const label = makeLabel(pos.name);
    label.position.set(pos.x, 1.9, pos.z);
    label.visible = showLabels.value;
    actorGroup.add(label);
    labels.push(label);
  }
  scene.add(actorGroup);
}

function initScene(): void {
  const host = canvasHost.value;
  if (!host || renderer) return;

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.setClearColor(0x08080c, 1);
  host.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x08080c, 12, 34);

  directorCam = new THREE.PerspectiveCamera(50, host.clientWidth / host.clientHeight, 0.1, 200);
  shotCam = new THREE.PerspectiveCamera(fov.value, host.clientWidth / host.clientHeight, 0.1, 200);
  activeCam = directorCam;

  scene.add(new THREE.HemisphereLight(0xcf9fff, 0x0a0a10, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(4, 8, 6);
  scene.add(key);
  const rim = new THREE.PointLight(0x9b46ff, 12, 24);
  rim.position.set(-4, 3, -4);
  scene.add(rim);

  grid = new THREE.GridHelper(40, 40, 0x3a3550, 0x232232);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.85;
  scene.add(grid);

  ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x14161d, transparent: true, opacity: groundOpacity.value, roughness: 0.9 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  scene.add(ground);

  // 机位框（视锥线框）
  shotFrame = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.4, 0.9, 0.1)),
    new THREE.LineBasicMaterial({ color: 0x4aa8ff }),
  );
  scene.add(shotFrame);

  rebuildActors();
  bindPointer();
  resize();
  new ResizeObserver(() => resize()).observe(host);
  animate();
}

function resize(): void {
  const host = canvasHost.value;
  if (!host || !renderer || !directorCam || !shotCam) return;
  const w = Math.max(1, host.clientWidth);
  const h = Math.max(1, host.clientHeight);
  renderer.setSize(w, h);
  directorCam.aspect = w / h;
  directorCam.updateProjectionMatrix();
  shotCam.aspect = w / h;
  shotCam.updateProjectionMatrix();
}

function pointerToNdc(e: PointerEvent): THREE.Vector2 {
  const el = renderer!.domElement;
  const rect = el.getBoundingClientRect();
  return new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
}

/** 命中角色（胶囊/贴图平面）→ 返回 actorId */
function pickActor(e: PointerEvent): string | null {
  if (!actorGroup || !activeCam) return null;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(pointerToNdc(e), activeCam);
  const hits = ray.intersectObjects(actorGroup.children, false);
  for (const hit of hits) {
    const id = (hit.object.userData as { actorId?: string }).actorId;
    if (id) return id;
  }
  return null;
}

/** 把屏幕点投到地面 y=0 平面，返回网格吸附后的坐标 */
function groundPoint(e: PointerEvent): { x: number; z: number } | null {
  if (!activeCam) return null;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(pointerToNdc(e), activeCam);
  const hit = new THREE.Vector3();
  if (!ray.ray.intersectPlane(dragState.plane, hit)) return null;
  return { x: snapValue(hit.x), z: snapValue(hit.z) };
}

/** 拖拽中同步该角色所有对象的坐标（不重建场景） */
function moveActorObjects(actorId: string, x: number, z: number): void {
  if (!actorGroup) return;
  for (const obj of actorGroup.children) {
    if ((obj.userData as { actorId?: string }).actorId === actorId) {
      obj.position.x = x;
      obj.position.z = z;
    }
  }
}

function bindPointer(): void {
  const el = renderer?.domElement;
  if (!el) return;
  el.addEventListener("pointerdown", (e) => {
    const hitId = pickActor(e);
    if (hitId) {
      // 命中角色 → 选中并进入拖拽（不再轨道旋转）
      selectedActorId.value = hitId;
      dragState.id = hitId;
      rebuildActors();
      el.style.cursor = "grabbing";
      return;
    }
    selectedActorId.value = null;
    orbit.dragging = true;
    orbit.lastX = e.clientX;
    orbit.lastY = e.clientY;
  });
  el.addEventListener("pointermove", (e) => {
    if (dragState.id) {
      const pt = groundPoint(e);
      const target = positions.value.find((p) => p.id === dragState.id);
      if (pt && target) {
        target.x = pt.x;
        target.z = pt.z;
        moveActorObjects(target.id, pt.x, pt.z);
      }
      return;
    }
    if (!orbit.dragging) return;
    const dx = e.clientX - orbit.lastX;
    const dy = e.clientY - orbit.lastY;
    orbit.lastX = e.clientX;
    orbit.lastY = e.clientY;
    if (viewMode.value === "director") {
      orbit.theta -= dx * 0.008;
      orbit.phi = Math.min(Math.PI * 0.52, Math.max(Math.PI * 0.08, orbit.phi - dy * 0.006));
    }
  });
  el.addEventListener("pointerup", () => {
    if (dragState.id) {
      dragState.id = null;
      saveState();
      snapMsg.value = "站位已更新（已吸附网格）";
      setTimeout(() => (snapMsg.value = ""), 1500);
    }
    orbit.dragging = false;
    el.style.cursor = "grab";
  });
  el.addEventListener("pointerleave", () => {
    dragState.id = null;
    orbit.dragging = false;
  });
  el.style.cursor = "grab";
  el.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (viewMode.value === "director") {
        orbit.radius = Math.min(26, Math.max(3, orbit.radius + e.deltaY * 0.01));
      }
    },
    { passive: false },
  );
}

function updateCams(): void {
  if (!directorCam || !shotCam) return;
  // 导演视角：围绕目标轨道
  const r = orbit.radius * (sceneScale.value / 100);
  directorCam.position.set(
    camTarget.x + r * Math.sin(orbit.phi) * Math.sin(orbit.theta),
    camTarget.y + r * Math.cos(orbit.phi) + 1.2,
    camTarget.z + r * Math.sin(orbit.phi) * Math.cos(orbit.theta),
  );
  directorCam.lookAt(camTarget.x, camTarget.y, camTarget.z);

  // 机位视角：用 x/y/z 位置 + 注视目标
  shotCam.fov = fov.value;
  shotCam.position.set(camPos.x, camPos.y, camPos.z);
  shotCam.lookAt(camTarget.x, camTarget.y, camTarget.z);
  shotCam.updateProjectionMatrix();

  if (shotFrame) {
    shotFrame.position.set(camPos.x, camPos.y, camPos.z);
    shotFrame.lookAt(camTarget.x, camTarget.y, camTarget.z);
  }
  activeCam = viewMode.value === "director" ? directorCam : shotCam;
}

function drawGizmo(): void {
  if (!renderer || !scene || !activeCam) return;
  const size = 76;
  const w = renderer.domElement.clientWidth;
  const h = renderer.domElement.clientHeight;
  renderer.setScissorTest(true);
  renderer.setViewport(w - size - 14, h - size - 14, size, size);
  renderer.setScissor(w - size - 14, h - size - 14, size, size);
  const gcam = new THREE.PerspectiveCamera(45, 1, 0.1, 20);
  gcam.position.copy(activeCam.position).multiplyScalar(0.12);
  gcam.lookAt(0, 0, 0);
  renderer.render(scene, gcam);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, w, h);
}

function animate(): void {
  raf = requestAnimationFrame(animate);
  if (!renderer || !scene) return;
  updateCams();
  if (ground) (ground.material as THREE.MeshStandardMaterial).opacity = groundOpacity.value;
  if (scene) {
    scene.rotation.y = (sceneRot.y * Math.PI) / 180;
    scene.rotation.x = (sceneRot.x * Math.PI) / 180;
  }
  for (const label of labels) label.visible = showLabels.value;
  // 定妆图平面始终朝向当前相机（billboard）
  if (activeCam) {
    for (const plane of actorsWithTexture) plane.lookAt(activeCam.position);
  }
  renderer.render(scene, activeCam!);
  drawGizmo();
  exposeDebugState();
}

/** 测试/排查钩子：暴露只读快照（不影响渲染） */
function exposeDebugState(): void {
  const w = window as unknown as { __director3d?: () => unknown };
  if (typeof w.__director3d !== "function") {
    w.__director3d = () => ({
      positions: positions.value.map((p) => ({ id: p.id, name: p.name, x: p.x, z: p.z, rot: p.rot, pose: p.pose, textured: Boolean(textureReady.value[p.id]) })),
      cameras: cameras.value.map((c) => ({ id: c.id, name: c.name, fov: c.fov })),
      activeCamIndex: activeCamIndex.value,
      viewMode: viewMode.value,
      selectedActorId: selectedActorId.value,
      canvas: renderer ? [renderer.domElement.width, renderer.domElement.height] : null,
    });
  }
}

// ── 交互 ──
function switchView(): void {
  viewMode.value = viewMode.value === "director" ? "camera" : "director";
}
function resetView(): void {
  orbit.theta = Math.PI * 0.15;
  orbit.phi = Math.PI * 0.42;
  orbit.radius = 9;
  Object.assign(camPos, { x: 2.4, y: 2.2, z: 3.2 });
  Object.assign(camTarget, { x: 0, y: 1, z: 0 });
  sceneRot.x = 0;
  sceneRot.y = 0;
  sceneRot.z = 0;
  saveState();
  snapMsg.value = "视角已重置";
  setTimeout(() => (snapMsg.value = ""), 1500);
}
function snapValue(v: number): number {
  return gridSnap.value ? Math.round(v / snapStep) * snapStep : Math.round(v * 100) / 100;
}
function onPosChange(axis: "x" | "y" | "z", value: number): void {
  if (Number.isNaN(value)) return;
  camPos[axis] = snapValue(value);
  saveState();
}
function onTargetChange(axis: "x" | "y" | "z", value: number): void {
  if (Number.isNaN(value)) return;
  camTarget[axis] = snapValue(value);
  saveState();
}
function onFovChange(value: number): void {
  fov.value = Math.min(120, Math.max(10, Math.round(value)));
  saveState();
}
function applyFacing(): void {
  if (facingMode.value === "center") {
    Object.assign(camTarget, { x: 0, y: 1, z: 0 });
  } else if (facingMode.value === "actor") {
    const first = positions.value[0];
    if (first) Object.assign(camTarget, { x: first.x, y: 1, z: first.z });
  }
  saveState();
}
function addActorSlot(): void {
  const idx = positions.value.length;
  positions.value = [
    ...positions.value,
    {
      id: `actor-${Date.now()}`,
      name: `角色${idx + 1}`,
      x: snapValue((idx - 1) * 1.2),
      z: snapValue(-0.6),
      rot: 0,
      pose: "stand",
    },
  ];
  rebuildActors();
  saveState();
}
function removeActor(id: string): void {
  positions.value = positions.value.filter((p) => p.id !== id);
  rebuildActors();
  saveState();
}
function toggleFullscreen(): void {
  const host = canvasHost.value;
  if (!host) return;
  if (document.fullscreenElement) void document.exitFullscreen();
  else void host.requestFullscreen?.();
}

/** 定格：把当前视角渲染成 PNG 并下载 + 抛给父组件 + 作为场景缩略图存到服务端 */
function capture(): void {
  if (!renderer || !scene || !activeCam) return;
  renderer.render(scene, activeCam);
  const url = renderer.domElement.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = `3d-director-shot-${props.shotNo}-${Date.now()}.png`;
  a.click();
  emit("captured", url);
  snapMsg.value = "已定格并下载当前视角 PNG";
  setTimeout(() => (snapMsg.value = ""), 2000);
  // 缩略图只在有项目上下文时上传（独立导演台不产生服务端资产）
  if (props.projectId) void persistence.save({ thumbnailDataUrl: url });
}

const filteredActors = computed(() => {
  const kw = search.value.trim();
  return kw ? positions.value.filter((p) => p.name.includes(kw)) : positions.value;
});

watch(
  () => props.open,
  (open) => {
    if (open) {
      /**
       * 打开瞬间会做"本地存档回放 + 场景初始化 + 服务端快照覆盖"，这一串都是**加载**动作：
       * 抑制窗口内不标脏，否则用户刚打开就看到"有未保存修改"（其实什么都没改）。
       */
      suppressDirtyUntil = Date.now() + 1200;
      // 本地存档先上（秒开），服务端快照到了再覆盖：断网/服务端没存过时不至于白屏
      loadState();
      nextTick(() => {
        initScene();
        rebuildActors();
        resize();
      });
      void syncFromServer();
      persistence.start();
    } else {
      persistence.dispose();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (renderer) {
        renderer.dispose();
        renderer.domElement.remove();
        renderer = null;
      }
      scene = null;
      directorCam = null;
      shotCam = null;
      ground = null;
      grid = null;
      actorGroup = null;
      shotFrame = null;
      labels = [];
    }
  },
);

/**
 * 任何"会被保存进快照"的状态变化都标脏。
 *
 * 为什么用 deep watch 而不是在每个操作里手写 markDirty：
 * 拖动角色、改 FOV、加机位、改网格吸附……入口有十几处，漏一个就会出现
 * "界面改了但 30s 自动保存没存"（用户重开项目发现改动没了，最难排查的一类 bug）。
 */
watch(
  [positions, cameras, camPos, camTarget, fov, groundOpacity, sceneScale, sceneRot, viewMode, gridSnap, showLabels],
  () => {
    if (applyingRemote || Date.now() < suppressDirtyUntil) return;
    persistence.markDirty();
  },
  // sync：远端快照应用期间的赋值必须**当场**被 `applyingRemote` 挡住；
  // 默认的 pre-flush 会把这些赋值攒到下一轮，那时标志位已经复位 → 误判成用户改动
  { deep: true, flush: "sync" },
);

onUnmounted(() => {
  persistence.dispose();
  if (raf) cancelAnimationFrame(raf);
  if (renderer) {
    renderer.dispose();
    renderer = null;
  }
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="d3-mask">
      <div class="d3">
        <!-- 顶栏 -->
        <header class="d3-top">
          <b class="d3-title">3D导演台</b>
          <div class="d3-seg">
            <button type="button" :class="{ on: viewMode === 'director' }" @click="viewMode = 'director'">导演视角</button>
            <button type="button" :class="{ on: viewMode === 'camera' }" @click="viewMode = 'camera'">机位视角</button>
          </div>
          <!-- 场景持久化状态：项目上下文里才有意义（独立导演台只存本地） -->
          <div v-if="projectId" class="d3-sync" :data-dirty="sceneDirty ? '1' : '0'">
            <span class="d3-sync__dot" />
            <span class="d3-sync__text">{{ sceneStatusText }}</span>
            <button type="button" class="d3-sync__save" :disabled="sceneSaving" @click="saveNow">
              {{ sceneSaving ? "保存中…" : "保存" }}
            </button>
            <span
              v-if="sceneCollaborators.length"
              class="d3-sync__peers"
              :title="sceneCollaborators.map((c) => `${c.nickname}（${Math.round(c.last_seen_ms / 1000)}s 前）`).join('\n')"
            >
              👥 {{ sceneCollaborators.length }} 人在编辑
            </span>
          </div>
          <span class="d3-spacer" />
          <span v-if="snapMsg" class="d3-toast">{{ snapMsg }}</span>
          <button type="button" class="d3-icon" title="快捷键：拖动旋转 · 滚轮缩放" @click="resetView">⌨</button>
          <button type="button" class="d3-icon" title="关闭" @click="closePanel">✕</button>
        </header>

        <!-- 版本冲突：有人在旧版本上改过，不许静默覆盖 -->
        <div v-if="sceneConflictVersion !== null" class="d3-conflict">
          <span>
            场景已被他人更新到 <b>v{{ sceneConflictVersion }}</b>，你的改动还没保存。要覆盖服务端，还是载入最新版本？
          </span>
          <button type="button" class="d3-btn" :disabled="sceneSaving" @click="persistence.overwriteConflict()">
            覆盖服务端
          </button>
          <button type="button" class="d3-btn d3-btn--ghost" @click="persistence.discardLocal()">载入最新</button>
        </div>
        <p v-if="sceneError" class="d3-error">{{ sceneError }}</p>

        <div class="d3-body">
          <!-- 左：素材区 + 3D 场景 -->
          <aside class="d3-panel d3-panel--left">
            <div class="d3-group">
              <div class="d3-group__head">
                <span>素材区</span>
                <input v-model="search" class="d3-search" type="search" placeholder="搜索角色" />
              </div>
              <div class="d3-chips">
                <button type="button" class="d3-chip" @click="addActorSlot">＋ 3D 世界</button>
                <button
                  v-for="a in filteredActors"
                  :key="a.id"
                  type="button"
                  class="d3-chip d3-chip--actor"
                  :title="`移除 ${a.name}`"
                  @click="removeActor(a.id)"
                >
                  <i />{{ a.name }} ✕
                </button>
                <p v-if="!filteredActors.length" class="d3-muted">还没有角色：分镜里绑定角色后会自动出现，或点「+ 3D 世界」占位</p>
              </div>
            </div>

            <div class="d3-group">
              <p class="d3-group__label">3D场景</p>
              <label class="d3-toggle"><input v-model="showLabels" type="checkbox" />角色标签</label>
              <label class="d3-toggle"><input v-model="gridSnap" type="checkbox" />网格吸附（0.5m）</label>

              <label class="d3-range">
                <span>场景缩放</span>
                <input v-model.number="sceneScale" type="range" min="60" max="200" step="5" />
                <em>{{ sceneScale }} %</em>
              </label>
              <label class="d3-range">
                <span>地面透明度</span>
                <input v-model.number="groundOpacity" type="range" min="0" max="1" step="0.05" />
                <em>{{ groundOpacity.toFixed(2) }}</em>
              </label>

              <p class="d3-sub">场景平移</p>
              <div class="d3-xyz">
                <label v-for="axis in (['x', 'y', 'z'] as const)" :key="`p-${axis}`">
                  <span>{{ axis.toUpperCase() }}</span>
                  <input
                    :value="axis === 'x' ? camTarget.x : axis === 'y' ? camTarget.y : camTarget.z"
                    type="number"
                    step="0.5"
                    @change="onTargetChange(axis, Number(($event.target as HTMLInputElement).value))"
                  />
                </label>
              </div>

              <p class="d3-sub">场景旋转</p>
              <div class="d3-xyz">
                <label v-for="axis in (['x', 'y', 'z'] as const)" :key="`r-${axis}`">
                  <span>{{ axis.toUpperCase() }}</span>
                  <input v-model.number="sceneRot[axis]" type="number" step="5" @change="saveState" />
                </label>
              </div>
            </div>

            <!-- 姿态预设：团队协作里"常用摆位一键复用"（个人 / 团队） -->
            <div v-if="projectId" class="d3-group">
              <p class="d3-group__label">姿态预设</p>
              <select class="d3-select" @change="onPresetChange">
                <option value="">应用预设…</option>
                <option v-for="p in presetOptions" :key="p.id" :value="p.id">
                  {{ p.name }}{{ p.scope === 2 ? "（团队）" : "" }}
                </option>
              </select>
              <div class="d3-preset-row">
                <input v-model="presetName" class="d3-search" type="text" maxlength="60" placeholder="预设名" />
                <select v-model.number="presetScope" class="d3-select">
                  <option :value="1">个人</option>
                  <option :value="2">团队</option>
                </select>
                <button type="button" class="d3-btn" :disabled="scenePresetSaving" @click="savePresetNow">存为预设</button>
              </div>
              <p v-if="!presetOptions.length" class="d3-muted">
                还没有预设：把角色摆好后可存成预设，下次一键复用。
              </p>
            </div>
          </aside>

          <!-- 中：视口 -->
          <section class="d3-stage">
            <div ref="canvasHost" class="d3-canvas" />
            <button type="button" class="d3-reset" @click="resetView">重置视角</button>
            <div class="d3-toolbar">
              <button type="button" title="添加角色站位" @click="addActorSlot">👤</button>
              <button type="button" title="切换导演/机位视角" @click="switchView">🎥</button>
              <button type="button" title="重置视角" @click="resetView">⌖</button>
              <button type="button" title="定格并下载 PNG" @click="capture">◉</button>
              <button type="button" title="角色标签" @click="showLabels = !showLabels">🏷</button>
              <button type="button" title="全屏" @click="toggleFullscreen">⛶</button>
            </div>
          </section>

          <!-- 右：机位区 -->
          <aside class="d3-panel d3-panel--right">
            <div class="d3-group__head">
              <span>机位区</span>
              <input class="d3-search" type="search" placeholder="搜索机位" />
            </div>
            <div class="d3-cam-item on">机位1<em>当前</em></div>

            <div class="d3-preview">
              <div class="d3-preview__frame">
                <span>FOV {{ fov }}°</span>
              </div>
              <p class="d3-muted">机位预览（切换「机位视角」查看实际取景）</p>
            </div>

            <p class="d3-sub">位置</p>
            <div class="d3-xyz">
              <label v-for="axis in (['x', 'y', 'z'] as const)" :key="`c-${axis}`">
                <span>{{ axis.toUpperCase() }}</span>
                <input
                  :value="camPos[axis]"
                  type="number"
                  step="0.5"
                  @change="onPosChange(axis, Number(($event.target as HTMLInputElement).value))"
                />
              </label>
            </div>

            <label class="d3-range">
              <span>视野角度 (FOV)</span>
              <input :value="fov" type="range" min="10" max="120" step="1" @input="onFovChange(Number(($event.target as HTMLInputElement).value))" />
              <em>{{ fov.toFixed(1) }}°</em>
            </label>

            <div class="d3-group__head">
              <span>注视目标</span>
              <select v-model="facingMode" class="d3-select" @change="applyFacing">
                <option value="manual">手动坐标</option>
                <option value="center">场景中心</option>
                <option value="actor">第一个角色</option>
              </select>
            </div>
            <div class="d3-xyz">
              <label v-for="axis in (['x', 'y', 'z'] as const)" :key="`t-${axis}`">
                <span>{{ axis.toUpperCase() }}</span>
                <input
                  :value="camTarget[axis]"
                  type="number"
                  step="0.5"
                  @change="onTargetChange(axis, Number(($event.target as HTMLInputElement).value))"
                />
              </label>
            </div>

            <div class="d3-ops">
              <button type="button" class="d3-btn" @click="capture">定格截图</button>
              <button type="button" class="d3-btn d3-btn--ghost" @click="switchView">切换视角</button>
              <button v-if="projectId" type="button" class="d3-btn d3-btn--ghost" @click="persistence.duplicate()">
                复制场景
              </button>
            </div>
            <p class="d3-muted">
              {{ projectId ? "场景快照自动保存到服务端（30s 自动保存 + 心跳）；「定格截图」会下载 PNG 并作为场景缩略图。" : "机位与站位按镜头保存在本浏览器；「定格截图」会下载当前视角 PNG（可作为首帧参考素材的来源）。" }}
            </p>
          </aside>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.d3-mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: rgba(4, 4, 8, 0.72);
  backdrop-filter: blur(4px);
  display: grid;
  place-items: center;
  padding: 16px;
}
.d3 {
  width: min(1440px, 100%);
  height: min(920px, 100%);
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: var(--radius-panel);
  border: 1px solid var(--panel-line);
  background: #0e0f14;
  overflow: hidden;
}
.d3-top {
  display: flex;
  align-items: center;
  gap: 12px;
}
.d3-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-1);
}
.d3-seg {
  display: flex;
  padding: 3px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid var(--panel-line);
}
.d3-seg button {
  height: 30px;
  padding: 0 16px;
  border: 0;
  border-radius: 999px;
  background: none;
  color: var(--text-3);
  font-size: 13px;
  cursor: pointer;
}
.d3-seg button.on {
  background: #1d1d24;
  color: var(--text-1);
  font-weight: 600;
}
.d3-spacer {
  flex: 1;
}
.d3-toast {
  font-size: 12px;
  color: var(--success);
}

/* ── 场景持久化状态条 / 冲突条 / 预设行 ── */
.d3-sync {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.35);
  font-size: 12px;
  color: var(--text-3);
}

.d3-sync__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
}

.d3-sync[data-dirty="1"] .d3-sync__dot {
  background: var(--warning, #f5b544);
}

.d3-sync__text {
  white-space: nowrap;
}

.d3-sync__save {
  height: 22px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--panel-line);
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}

.d3-sync__save:disabled {
  opacity: 0.6;
  cursor: default;
}

.d3-sync__peers {
  color: var(--brand-300, #a99cff);
  white-space: nowrap;
  cursor: help;
}

.d3-conflict {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid rgba(245, 181, 68, 0.35);
  background: rgba(245, 181, 68, 0.1);
  color: #f5d08a;
  font-size: 12px;
}

.d3-error {
  margin: 0;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--danger-bg);
  color: var(--danger);
  font-size: 12px;
}

.d3-preset-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.d3-preset-row .d3-search {
  flex: 1;
  min-width: 0;
}

.d3-preset-row .d3-select {
  flex: 0 0 72px;
}
.d3-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.3);
  color: var(--text-2);
  font-size: 14px;
  cursor: pointer;
}
.d3-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr) 300px;
  gap: 10px;
}
.d3-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid var(--panel-line);
  background: rgba(255, 255, 255, 0.03);
  overflow: auto;
}
.d3-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.d3-group__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
}
.d3-group__label {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
}
.d3-sub {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--text-4);
}
.d3-search {
  width: 130px;
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.32);
  color: var(--text-1);
  font-size: 12px;
  outline: none;
}
.d3-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.d3-chip {
  height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.28);
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}
.d3-chip--actor {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.d3-chip--actor i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--brand-500);
}
.d3-muted {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-5);
}
.d3-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-3);
  cursor: pointer;
}
.d3-range {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-3);
}
.d3-range input {
  flex: 1;
  min-width: 0;
}
.d3-range em {
  font-style: normal;
  min-width: 46px;
  text-align: right;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.d3-xyz {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.d3-xyz label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-4);
}
.d3-xyz input {
  width: 100%;
  min-width: 0;
  height: 28px;
  padding: 0 6px;
  border-radius: 6px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.32);
  color: var(--text-1);
  font-size: 12px;
  outline: none;
}
.d3-stage {
  position: relative;
  border-radius: 14px;
  border: 1px solid var(--panel-line);
  overflow: hidden;
  background: #08080c;
}
.d3-canvas {
  position: absolute;
  inset: 0;
}
.d3-reset {
  position: absolute;
  top: 12px;
  right: 12px;
  height: 30px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.5);
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}
.d3-toolbar {
  position: absolute;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%);
  display: flex;
  gap: 6px;
  padding: 6px;
  border-radius: 999px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.55);
}
.d3-toolbar button {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-2);
  font-size: 15px;
  cursor: pointer;
}
.d3-toolbar button:hover {
  background: var(--brand-500);
  color: #fff;
}
.d3-cam-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.28);
  font-size: 13px;
  color: var(--text-2);
}
.d3-cam-item.on {
  border-color: var(--brand-500);
  color: var(--text-1);
}
.d3-cam-item em {
  font-style: normal;
  font-size: 11px;
  color: var(--brand-on-soft);
}
.d3-preview__frame {
  height: 92px;
  border-radius: 10px;
  border: 1px dashed var(--panel-line);
  background: repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.03) 0 8px, transparent 8px 16px);
  display: grid;
  place-items: center;
  color: var(--text-4);
  font-size: 12px;
}
.d3-select {
  height: 28px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--panel-line);
  background: rgba(0, 0, 0, 0.32);
  color: var(--text-1);
  font-size: 12px;
}
.d3-ops {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 4px;
}
.d3-btn {
  height: 34px;
  border: 0;
  border-radius: 10px;
  background: var(--brand-500);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.d3-btn--ghost {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--panel-line);
  color: var(--text-2);
}
@media (max-width: 1180px) {
  .d3-body {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(280px, 1fr) auto;
    overflow: auto;
  }
}
</style>
