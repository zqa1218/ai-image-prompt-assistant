import { create } from "zustand";
import { migrateOutputMode, migratePreserve } from './intakeLayout.ts';
import { getWorkflow, WORKFLOWS } from "../workflows/index.ts";
import type { Workflow } from "../workflows/types.ts";
import { deepseekProvider } from "./deepseekProvider.ts";
import { beginConversationRun } from "./imageConversation.ts";
import { createRunGuard } from "./runGuard.ts";
import { clearSession, loadSession } from "./sessionSnapshot.ts";
import {
  parseChecklistItems,
  parsePersonaPayload,
  parseResearchPayload,
} from "./llm/parsers.ts";
import type {
  ChecklistItem,
  PersonaPayload,
  ResearchPayload,
} from "./llm/parsers.ts";
import { mockProvider } from "./mockProvider.ts";
import type {
  Artifact,
  ChatMessage,
  DirectionOption,
  ImageRef,
  Provider,
  ReferenceItem,
  StageRecord,
  WizardContext,
  WizardImage,
} from "./wizardTypes.ts";
import { createId } from "./wizardTypes.ts";

/** 默认走真实模型；设为 mock 可在没有 key 时演示流程。 */
let provider: Provider = deepseekProvider;

export function setProvider(next: Provider) {
  provider = next;
  useWizard.setState({ providerKind: next.kind });
}

export function getProvider(): Provider {
  return provider;
}

export const MOCK_PROVIDER = mockProvider;
export const LIVE_PROVIDER = deepseekProvider;

/** 自动执行（进入即跑）的阶段。接收、细化、迭代由用户驱动。 */
const AUTO_STAGES = new Set(["analyze", "direction", "compose"]);

export type WizardState = {
  providerKind: "mock" | "live";
  workflowId: string | null;
  stageIndex: number;
  records: Record<string, StageRecord>;
  intake: Record<string, string>;
  original: WizardImage | null;
  references: WizardImage[];
  /** 从参考图拆解出的可迁移项 */
  referenceItems: ReferenceItem[];
  /** 已勾选要导入的项 id */
  selectedReferenceItems: string[];
  options: DirectionOption[];
  selectedOptionId: string | null;
  notes: string[];
  artifact: Artifact | null;
  messages: ChatMessage[];
  notice: string | null;
  busy: boolean;
  /** 本次任务的稳定标识：面板与记录都以它为键，切换布局不会变 */
  taskId: string;
  /** 提示词版本：每次成功组装 +1，用于判断是不是最新一轮产物 */
  promptVersion: number;
  /** 细化阶段抓到的待定项（选项化） */
  questions: ChecklistItem[];
  /** 最近一次「抓待定项」的原始往返，用于诊断为什么没解析出来 */
  lastChecklist: { focus: string; reply: string; parsed: number } | null;
  /** 资料收集结果（人设要点 + 灵感方案 + 确认项） */
  research: ResearchPayload | null;
  /** 人设卡解析结果 */
  persona: PersonaPayload | null;

  start: (workflowId: string) => void;
  /** 载入一份存档：需求、底图、参考图一次换好，产出全部作废。 */
  applyArchive: (snapshot: ArchiveSnapshot) => boolean;
  reset: () => void;
  restartModelContext: () => void;
  /** 一张图做完后开下一组：回到接收步骤，清空底图与产出，需求保留。 */
  nextRound: (keepReferences?: boolean) => void;
  setIntake: (key: string, value: string) => void;
  setOriginal: (image: ImageRef | null) => void;
  addReference: (image: ImageRef) => void;
  removeReference: (index: number) => void;
  /** 给某张参考图写分工，会进提示词的 REFERENCE_N 行 */
  setReferenceNote: (index: number, note: string) => void;
  toggleReferenceItem: (id: string) => void;
  goTo: (index: number) => void;
  advance: () => Promise<void>;
  rerun: (index?: number) => Promise<void>;
  selectOption: (id: string) => void;
  addNote: (text: string) => Promise<string | null>;
  sendFeedback: (text: string) => Promise<void>;
  /** 让模型把「还没定但影响成片」的参数列成选项 */
  loadChecklist: () => Promise<ChecklistItem[] | null>;
  /** 把选中的待定项写进补充要求 */
  answerChecklist: (text: string) => void;
  /** 让模型结合角色名与官方图收集资料 */
  loadResearch: () => Promise<ResearchPayload | null>;
  /** 载入资料方案：填回表单并直接跳到方向建议 */
  applyResearch: (fill?: Record<string, string>) => Promise<void>;
  /** 解析人设卡与三视图提示词 */
  loadPersona: () => Promise<PersonaPayload | null>;
  /** 把预设文本套到当前提示词上；返回被替换掉的旧正文，便于撤回 */
  applyPresetPrompt: (text: string) => string | null;
  /** 撤回最近一次套用 */
  restorePrompt: (previous: string) => void;
  /** 重启后恢复上次的任务线索（图片必然缺失，界面要说清） */
  hydrateSession: () => boolean;
};

/** 保存/载入一份接收阶段配置时用到的字段。 */
export type ArchiveSnapshot = {
  name?: string;
  workflowId: string;
  intake: Record<string, string>;
  original: ImageRef | null;
  references: ImageRef[];
};

const initial = {
  providerKind: provider.kind as "mock" | "live",
  workflowId: null as string | null,
  stageIndex: 0,
  records: {} as Record<string, StageRecord>,
  intake: {} as Record<string, string>,
  original: null as WizardImage | null,
  references: [] as WizardImage[],
  referenceItems: [] as ReferenceItem[],
  selectedReferenceItems: [] as string[],
  options: [] as DirectionOption[],
  selectedOptionId: null as string | null,
  notes: [] as string[],
  artifact: null as Artifact | null,
  messages: [] as ChatMessage[],
  notice: null as string | null,
  busy: false,
  taskId: createId("t"),
  promptVersion: 0,
  questions: [] as ChecklistItem[],
  lastChecklist: null as { focus: string; reply: string; parsed: number } | null,
  research: null as ResearchPayload | null,
  persona: null as PersonaPayload | null,
};

function workflowOf(state: WizardState): Workflow {
  if (!state.workflowId) throw new Error("尚未选择工作流");
  return getWorkflow(state.workflowId);
}

function contextOf(state: WizardState): WizardContext {
  const workflow = workflowOf(state);
  return {
    workflow,
    intake: state.intake,
    images: allImages(state),
    analysis: (state.records["analyze"]?.output as string | undefined) ?? "",
    options: state.options,
    selectedOptionId: state.selectedOptionId,
    notes: state.notes,
    artifact: state.artifact,
    selectedReferenceItems: state.referenceItems.filter((item) =>
      state.selectedReferenceItems.includes(item.id),
    ),
  };
}

/** 原图永远排在参考图前面，编号顺序即上传顺序。 */
export function allImages(state: WizardState): WizardImage[] {
  return [...(state.original ? [state.original] : []), ...state.references];
}

function withReference(image: ImageRef): WizardImage {
  return { ...image, role: "reference" };
}

/** 第 index 步之后的所有产出都作废；返回被清掉的阶段标题。 */
function invalidateAfter(state: WizardState, index: number) {
  const workflow = workflowOf(state);
  const records = { ...state.records };
  const cleared: string[] = [];
  const patch: Partial<WizardState> = {};

  const idx = (id: string) => workflow.stages.findIndex((s) => s.id === id);

  if (index < idx("analyze") && records["analyze"]?.status === "ready") {
    records["analyze"] = { status: "idle" };
    cleared.push("原图分析");
  }
  if (index < idx("analyze") && state.referenceItems.length > 0) {
    records["extract"] = { status: "idle" };
    patch.referenceItems = [];
    patch.selectedReferenceItems = [];
    cleared.push("参考图拆解");
  }
  if (
    index < idx("direction") &&
    (state.options.length > 0 || state.selectedOptionId)
  ) {
    records["direction"] = { status: "idle" };
    patch.options = [];
    patch.selectedOptionId = null;
    cleared.push("方向建议");
  }
  if (index < idx("detail") && state.notes.length > 0) {
    patch.notes = [];
    cleared.push("细化");
  }
  if (
    index < idx("compose") &&
    (state.artifact || records["compose"]?.status === "ready")
  ) {
    records["compose"] = { status: "idle" };
    patch.artifact = null;
    cleared.push("生成提示词");
  }
  if (index < idx("iterate") && state.messages.length > 0) {
    patch.messages = [];
    cleared.push("迭代");
  }

  return { records, patch, cleared };
}

export const useWizard = create<WizardState>()((set, get) => {
  // 每个阶段同一时刻只认最新一轮回复：晚回来的旧请求直接丢弃
  const guard = createRunGuard();
  async function runStage(index: number) {
    const state = get();
    if (!state.workflowId) return;
    const workflow = workflowOf(state);
    const stage = workflow.stages[index];
    if (!stage || !AUTO_STAGES.has(stage.id)) return;

    const ctx = contextOf(state);
    const token = guard.begin(stage.id);
    set((s) => ({
      busy: true,
      records: { ...s.records, [stage.id]: { status: "running" } },
      notice: null,
    }));

    try {
      if (stage.id === "analyze") {
        const text = await provider.analyze(ctx);

        // 有参考图时顺带拆解出可迁移项。拆解失败不该把已经成功的分析一起判失败。
        let items: ReferenceItem[] = [];
        let extractError = "";
        if (ctx.images.some((image) => image.role === "reference")) {
          try {
            items = await provider.extractReferences(ctx);
          } catch (error) {
            items = [];
            extractError =
              error instanceof Error ? error.message : String(error);
          }
        }
        // 显式标注类型：条件表达式里的字面量会被拓宽成 string，导致不符合 StageRecord
        const extractRecord: StageRecord =
          items.length > 0
            ? { status: "ready", output: items }
            : { status: "idle" };
        if (!guard.isCurrent(stage.id, token)) return;
        set((s) => ({
          busy: false,
          referenceItems: items,
          selectedReferenceItems: [],
          // 拆解失败以前是静默的：用户只会看到底图分析好了，却不知道参考图没被读。
          notice: extractError
            ? `参考图拆解没成功：${extractError}。可以继续，只是不会自动列出可迁移项。`
            : s.notice,
          records: {
            ...s.records,
            analyze: { status: "ready", output: text },
            extract: extractRecord,
          },
        }));
      } else if (stage.id === "direction") {
        const options = await provider.suggestDirections(ctx);
        if (!guard.isCurrent(stage.id, token)) return;
        set((s) => ({
          busy: false,
          options,
          selectedOptionId: null,
          records: {
            ...s.records,
            direction: { status: "ready", output: options },
          },
        }));
      } else if (stage.id === "compose") {
        const artifact = await provider.compose(ctx);
        if (!guard.isCurrent(stage.id, token)) return;
        set((s) => ({
          busy: false,
          artifact,
          // 每次成功组装都推进版本号：下游据此判断「这份提示词是不是最新一轮」
          promptVersion: s.promptVersion + 1,
          records: {
            ...s.records,
            compose: { status: "ready", output: artifact },
          },
        }));
      }
    } catch (err) {
      // 过期请求的失败也不该覆盖新一轮的界面
      if (!guard.isCurrent(stage.id, token)) return;
      set((s) => ({
        busy: false,
        records: {
          ...s.records,
          [stage.id]: {
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          },
        },
      }));
    }
  }

  async function runIfNeeded(index: number) {
    const state = get();
    const workflow = workflowOf(state);
    const stage = workflow.stages[index];
    if (!stage || !AUTO_STAGES.has(stage.id)) return;
    if (state.records[stage.id]?.status === "ready") return;
    await runStage(index);
  }

  return {
    ...initial,

    hydrateSession() {
      const snapshot = loadSession();
      if (!snapshot) return false;
      const workflow = WORKFLOWS.find(
        (item) => item.id === snapshot.workflowId,
      );
      if (!workflow) {
        clearSession();
        return false;
      }
      guard.reset();
      const intake: Record<string, string> = {};
      const intakeStage = workflow.stages.find(
        (stage) => stage.id === "intake",
      );
      for (const field of intakeStage?.fields ?? []) {
        if (field.defaultValue !== undefined)
          intake[field.key] = field.defaultValue;
      }
      Object.assign(intake, snapshot.intake);
      set({
        ...initial,
        taskId: snapshot.taskId,
        workflowId: workflow.id,
        intake: migrateOutputMode(migratePreserve(intake)),
        // 恢复只回到接收阶段：中间产物没有持久化，跳到一半反而像"数据丢了"
        stageIndex: 0,
        notice:
          "已恢复上次的任务：需求还在，但底图与参考图需要重新选择，然后点「开始分析」。",
      });
      return true;
    },

    start(workflowId) {
      // 带默认值的字段（如输出规格）在进入时预填，用户可以改
      const workflow = getWorkflow(workflowId);
      const intakeStage = workflow.stages.find(
        (stage) => stage.id === "intake",
      );
      const intake: Record<string, string> = {};
      for (const field of intakeStage?.fields ?? []) {
        if (field.defaultValue !== undefined)
          intake[field.key] = field.defaultValue;
      }
      beginConversationRun();
      guard.reset();
      set({ ...initial, taskId: createId("t"), workflowId, intake });
    },

    /**
     * 载入存档：整份配置一次换好，产出全部作废，回到第 1 步。
     *
     * 存档不再绑定线路：已经选中某条线时沿用当前线路（只搬图与需求），
     * 这样「分步生成线」可以直接复用原图精修线存下的任务。
     * 没有选中任何线路时，才按存档自带的线路进入。
     */
    applyArchive(snapshot) {
      const own = WORKFLOWS.find((item) => item.id === snapshot.workflowId);
      const selected = get().workflowId;
      const current = selected
        ? WORKFLOWS.find((item) => item.id === selected)
        : undefined;
      const workflow = current ?? own;
      if (!workflow) {
        set({
          notice:
            "这份存档的工作路径在当前版本里不存在，且当前没有选中任何线路，没有载入。",
        });
        return false;
      }
      const intakeStage = workflow.stages.find(
        (stage) => stage.id === "intake",
      );
      const intake: Record<string, string> = {};
      for (const field of intakeStage?.fields ?? []) {
        if (field.defaultValue !== undefined)
          intake[field.key] = field.defaultValue;
      }
      for (const [key, value] of Object.entries(snapshot.intake ?? {})) {
        if (typeof value === "string") intake[key] = value;
      }
      beginConversationRun();
      guard.reset();
      const crossLine = Boolean(current && own && current.id !== own.id);
      set({
        ...initial,
        taskId: createId("t"),
        workflowId: workflow.id,
        intake: migrateOutputMode(migratePreserve(intake)),
        original: snapshot.original
          ? { ...snapshot.original, role: "original" }
          : null,
        references: (snapshot.references ?? []).map(withReference),
        notice: crossLine
          ? `已把存档「${snapshot.name ?? "未命名"}」的底图、参考图与需求载入当前线路「${workflow.name}」（这份存档原本属于「${own?.name ?? "未知线路"}」），点「开始分析」继续。`
          : `已载入存档「${snapshot.name ?? "未命名"}」：需求、底图与参考图都换好了，点「开始分析」继续。`,
      });
      return true;
    },

    reset() {
      guard.reset();
      set({ ...initial, taskId: createId("t"), promptVersion: 0 });
    },

    restartModelContext() {
      set({
        stageIndex: 0,
        records: {},
        options: [],
        selectedOptionId: null,
        artifact: null,
        referenceItems: [],
        selectedReferenceItems: [],
        messages: [],
        notice:
          "已清除模型旧结论；保留底图、参考图、需求与用户补充，请继续重新分析。",
      });
    },

    /**
     * 上一张图做完后接着做下一张：只换底图。
     * 修图需求（含用途、输出规格、置景参数等）保留，避免每张图重复填写；
     * keepReferences 为 true 时连参考图一起沿用，适合同一组照片共用同一张参考。
     */
    nextRound(keepReferences = false) {
      const state = get();
      set({
        stageIndex: 0,
        records: {},
        original: null,
        references: keepReferences ? state.references : [],
        referenceItems: [],
        selectedReferenceItems: [],
        options: [],
        selectedOptionId: null,
        notes: [],
        artifact: null,
        messages: [],
        busy: false,
        notice: keepReferences
          ? "已开始下一组：底图与产出已清空，需求与参考图保留，可在第 1 步调整。"
          : "已开始下一组：底图、参考图与产出已清空，需求保留，可在第 1 步调整。",
      });
    },

    setIntake(key, value) {
      const state = get();
      const { records, patch } = invalidateAfter(state, 0);
      set({ ...patch, records, intake: { ...state.intake, [key]: value } });
    },

    setOriginal(image) {
      const state = get();
      const { records, patch } = invalidateAfter(state, 0);
      set({
        ...patch,
        records,
        original: image ? { ...image, role: "original" } : null,
      });
    },

    addReference(image) {
      const state = get();
      const { records, patch } = invalidateAfter(state, 0);
      set({
        ...patch,
        records,
        references: [...state.references, withReference(image)],
      });
    },

    removeReference(index) {
      const state = get();
      const { records, patch, cleared } = invalidateAfter(state, 0);
      set({
        ...patch,
        records,
        references: state.references.filter((_, i) => i !== index),
        notice: cleared.length
          ? `参考图有变化，后续的 ${cleared.join("、")} 已作废。`
          : null,
      });
    },

    toggleReferenceItem(id) {
      const state = get();
      // 勾选变化会影响方向与提示词，所以从分析之后的下游都要作废
      const { records, patch } = invalidateAfter(state, 1);
      set({
        ...patch,
        records,
        selectedReferenceItems: state.selectedReferenceItems.includes(id)
          ? state.selectedReferenceItems.filter((item) => item !== id)
          : [...state.selectedReferenceItems, id],
      });
    },

    goTo(index) {
      const state = get();
      if (!state.workflowId) return;
      const workflow = workflowOf(state);
      if (index < 0 || index >= workflow.stages.length) return;
      if (index === state.stageIndex) return;

      const { records, patch, cleared } = invalidateAfter(state, index);
      set({
        ...patch,
        records,
        stageIndex: index,
        notice: cleared.length
          ? `已回到第 ${index + 1} 步「${workflow.stages[index].title}」，` +
            `后续的 ${cleared.join("、")} 已作废，需要重新推进。`
          : null,
      });
    },

    async advance() {
      const state = get();
      if (!state.workflowId) return;
      const workflow = workflowOf(state);
      const stage = workflow.stages[state.stageIndex];

      // 方向阶段：用户没点选时按推荐项继续，避免卡死
      if (
        stage.id === "direction" &&
        !state.selectedOptionId &&
        state.options.length > 0
      ) {
        const pick =
          state.options.find((o) => o.recommended) ?? state.options[0];
        set({
          selectedOptionId: pick.id,
          notice: `你没有选择方向，已按推荐项「${pick.title}」继续。`,
        });
      }

      const next = state.stageIndex + 1;
      if (next >= workflow.stages.length) return;
      set({ stageIndex: next });
      await runIfNeeded(next);
    },

    async rerun(index) {
      const state = get();
      const target = index ?? state.stageIndex;
      const { records, patch, cleared } = invalidateAfter(state, target - 1);
      set({
        ...patch,
        records,
        stageIndex: target,
        notice: cleared.length
          ? `已重跑，后续的 ${cleared.join("、")} 已作废。`
          : null,
      });
      await runStage(target);
    },

    selectOption(id) {
      set({ selectedOptionId: id, notice: null });
    },

    async addNote(text) {
      const state = get();
      const trimmed = text.trim();
      if (!trimmed) return null;
      const ctx = contextOf(state);
      const message: ChatMessage = {
        id: createId("m"),
        role: "user",
        text: trimmed,
      };
      set((s) => ({
        notes: [...s.notes, trimmed],
        messages: [...s.messages, message],
        busy: true,
      }));
      try {
        const reply = await provider.askDetail(
          { ...ctx, notes: [...ctx.notes, trimmed] },
          trimmed,
        );
        set((s) => ({
          busy: false,
          messages: [
            ...s.messages,
            { id: createId("m"), role: "assistant", text: reply },
          ],
        }));
        return reply;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        set((s) => ({
          busy: false,
          messages: [
            ...s.messages,
            { id: createId("m"), role: "assistant", text: `出错：${error}` },
          ],
        }));
        return null;
      }
    },

    /** 参考图逐张分工：写进提示词的 REFERENCE_N 行 */
    setReferenceNote(index, note) {
      set((s) => {
        const references = s.references.slice();
        if (!references[index]) return {};
        references[index] = { ...references[index], note: note.trim() };
        return { references };
      });
    },

    async loadChecklist() {
      const state = get();
      const ctx = contextOf(state);
      set({ busy: true, notice: null });
      try {
        let reply = await provider.askDetail(ctx, "【待定项清单】");
        let items = parseChecklistItems(reply);
        if (items.length === 0) {
          // 模型偶尔还是写成散文。补一次只说 JSON 的重试——
          // 比让用户自己点「重新抓取」再失败一次要好。
          reply = await provider.askDetail(
            ctx,
            "【待定项清单】这次只输出 JSON 对象本身：不要分析、不要解释、不要 markdown 代码标记，JSON 前后不要写任何字。",
          );
          items = parseChecklistItems(reply);
        }
        // 只有真的解析到东西才覆盖：重新抓取失败时不要把上一次的结果清空，
        // 否则用户会看到「刚才还在的选项突然全没了」，比没抓到更困惑。
        set((s) => ({
          busy: false,
          questions: items.length > 0 ? items : s.questions,
          // 诊断用：把这次实际发出的指令和模型原文留下来
          lastChecklist: {
            focus: "【待定项清单】",
            reply,
            parsed: items.length,
          },
        }));
        if (items.length === 0) {
          set((s) => ({
            messages: [
              ...s.messages,
              {
                id: createId("m"),
                role: "assistant",
                text:
                  "没能从这次回复里解析出待定项，可以点「重新抓取」，或直接在下面写补充要求。" +
                  (reply.trim()
                    ? `\n\n模型这次回的是：\n${reply.trim().slice(0, 400)}`
                    : "\n\n模型这次没有返回内容。"),
              },
            ],
          }));
        }
        return items;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        set((s) => ({
          busy: false,
          messages: [
            ...s.messages,
            {
              id: createId("m"),
              role: "assistant",
              text: `列出待定项失败：${error}`,
            },
          ],
        }));
        return null;
      }
    },

    answerChecklist(text) {
      const trimmed = text.trim();
      if (!trimmed) return;
      set((s) => ({
        notes: [...s.notes, trimmed],
        questions: [],
        notice: "待定项已写入补充要求，生成提示词时会带上。",
      }));
    },

    applyPresetPrompt(text) {
      const artifact = get().artifact;
      if (!artifact) return null;
      const previous = artifact.prompt;
      set((s) => ({
        artifact: { ...artifact, prompt: text },
        promptVersion: s.promptVersion + 1,
        notice: "已套用预设，可在预设区撤回。",
      }));
      return previous;
    },

    restorePrompt(previous) {
      const artifact = get().artifact;
      if (!artifact) return;
      set((s) => ({
        artifact: { ...artifact, prompt: previous },
        promptVersion: s.promptVersion + 1,
        notice: "已撤回预设，恢复原来的提示词。",
      }));
    },

    async loadResearch() {
      const state = get();
      const ctx = contextOf(state);
      set({ busy: true, notice: null });
      try {
        let reply = await provider.askDetail(ctx, "【资料收集】");
        if (!parseResearchPayload(reply)) {
          reply = await provider.askDetail(
            ctx,
            "【资料收集】这次只输出 JSON 对象本身：不要分析、不要解释、不要 markdown 代码标记。",
          );
        }
        const data = parseResearchPayload(reply);
        set({ busy: false, research: data });
        if (!data)
          set({
            notice:
              "没能从这次回复里解析出资料方案，可以点「重新收集」再试一次",
          });
        return data;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        set({ busy: false, notice: `收集资料失败：${error}` });
        return null;
      }
    },

    async applyResearch(fill) {
      const state = get();
      const merged = {
        ...state.intake,
        ...(fill ?? state.research?.fill ?? {}),
      };
      set({ intake: merged, notice: "已载入资料方案，正在生成方向建议" });
      const workflow = workflowOf({ ...state, intake: merged });
      const index = workflow.stages.findIndex(
        (item) => item.id === "direction",
      );
      if (index >= 0) await get().rerun(index);
    },

    async loadPersona() {
      const state = get();
      const ctx = contextOf(state);
      set({ busy: true, notice: null });
      try {
        const reply = await provider.askDetail(ctx, "【人设解析】");
        const data = parsePersonaPayload(reply);
        set({ busy: false, persona: data });
        if (!data)
          set({ notice: "没能解析出人设卡，可以贴一张官方图或补一句人设再试" });
        return data;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        set({ busy: false, notice: `人设解析失败：${error}` });
        return null;
      }
    },

    async sendFeedback(text) {
      const state = get();
      const trimmed = text.trim();
      if (!trimmed || !state.artifact) return;
      const ctx = contextOf(state);
      set((s) => ({
        busy: true,
        messages: [
          ...s.messages,
          { id: createId("m"), role: "user", text: trimmed },
        ],
      }));
      try {
        const artifact = await provider.iterate(ctx, trimmed);
        set((s) => ({
          busy: false,
          artifact,
          records: {
            ...s.records,
            compose: { status: "ready", output: artifact },
          },
          messages: [
            ...s.messages,
            {
              id: createId("m"),
              role: "assistant",
              text: "已按你的反馈重新编译提示词，本轮只改动了这一处。",
            },
          ],
        }));
      } catch (err) {
        set((s) => ({
          busy: false,
          messages: [
            ...s.messages,
            {
              id: createId("m"),
              role: "assistant",
              text: `出错：${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        }));
      }
    },
  };
});

export function stageStatus(state: WizardState, stageId: string) {
  return state.records[stageId]?.status ?? "idle";
}

export function selectedOption(state: WizardState): DirectionOption | null {
  if (!state.selectedOptionId) return null;
  return state.options.find((o) => o.id === state.selectedOptionId) ?? null;
}
