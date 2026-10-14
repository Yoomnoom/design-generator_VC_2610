export type ShortcutAction =
  | "undo" | "redo" | "delete" | "duplicate" | "copy" | "cut"
  | "tool-select" | "tool-hand" | "tool-rect" | "tool-line" | "tool-box" | "tool-ellipse" | "tool-shape" | "tool-eyedropper" | "tool-brush" | "tool-eraser" | "tool-text" | "tool-memo" | "tool-warp" | "tool-finger" | "tool-liquify" | "tool-auto"
  | "select-all" | "deselect" | "invert-selection" | "group" | "ungroup" | "free-transform"
  | "zoom-fit" | "zoom-100" | "zoom-in" | "zoom-out"
  | "layer-forward" | "layer-backward" | "layer-front" | "layer-back"
  | "swap-colors" | "default-colors" | "brush-smaller" | "brush-bigger"
  | "save" | "open-project"
  | "candidate-extract" | "candidate-clear"
  | "nudge-left" | "nudge-right" | "nudge-up" | "nudge-down";

/** `code` is the physical key ("KeyB", "BracketRight"): it is what makes a shortcut work while a Korean (or any other) input method is on */
export type KeyInfo = { key: string; code?: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; repeat?: boolean };

/** A key combination. `ctrl` means Ctrl, or ⌘ on a Mac. `key` is a letter/digit/punctuation in lower case, or a name such as "Delete", "ArrowLeft". */
export type Binding = { key: string; ctrl: boolean; shift: boolean; alt: boolean };
/** `null` = no key (the function is still in the tool bar or a button) */
export type Bindings = Record<ConfigurableAction, Binding | null>;

/** the actions whose keys the user can change (Enter and Esc keep their meaning in a task, and Ctrl+V is the browser's paste event) */
export type ConfigurableAction = Exclude<ShortcutAction, "candidate-extract" | "candidate-clear">;

const b = (key: string, o: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}): Binding => ({ key, ctrl: !!o.ctrl, shift: !!o.shift, alt: !!o.alt });

export type PresetId = "photoshop" | "legacy";
export const PRESET_LABEL: Record<PresetId, string> = { photoshop: "포토샵", legacy: "이전 기본값" };

const COMMON = {
  undo: b("z", { ctrl: true }),
  redo: b("z", { ctrl: true, shift: true }),
  copy: b("c", { ctrl: true }),
  cut: b("x", { ctrl: true }),
  "select-all": b("a", { ctrl: true }),
  group: b("g", { ctrl: true }),
  ungroup: b("g", { ctrl: true, shift: true }),
  "free-transform": b("t", { shift: true }),
  "zoom-fit": b("0", { ctrl: true }),
  "zoom-100": b("1", { ctrl: true }),
  "zoom-in": b("=", { ctrl: true }),
  "zoom-out": b("-", { ctrl: true }),
  "layer-forward": b("]", { ctrl: true }),
  "layer-backward": b("[", { ctrl: true }),
  "layer-front": b("]", { ctrl: true, shift: true }),
  "layer-back": b("[", { ctrl: true, shift: true }),
  save: b("s", { ctrl: true }),
  "open-project": b("o", { ctrl: true }),
  "nudge-left": b("ArrowLeft"),
  "nudge-right": b("ArrowRight"),
  "nudge-up": b("ArrowUp"),
  "nudge-down": b("ArrowDown"),
  delete: b("Delete"),
  "tool-select": b("v"),
  "tool-hand": b("h"),
  "tool-text": b("t"),
  "tool-brush": b("b"),
  "tool-eraser": b("e"),
  "tool-eyedropper": b("i"),
  "tool-memo": b("n"),
  "swap-colors": b("x"),
  "default-colors": b("d"),
  "brush-smaller": b("["),
  "brush-bigger": b("]"),
};

/** Photoshop's keys, for the functions this app has. Where Photoshop's key belongs to a function the app does not have (L lasso, W magic
 *  wand, Z zoom, Ctrl+E merge), the key is NOT assigned: see NOT_AVAILABLE. Tools that lost their old key to a Photoshop key moved to a free
 *  one (warp: Shift+W, finger: R, auto candidates: A) or to the U cycle (line, rectangle, ellipse), and are always in the tool bar. */
export const PRESETS: Record<PresetId, Bindings> = {
  photoshop: {
    ...COMMON,
    duplicate: b("j", { ctrl: true }),
    deselect: b("d", { ctrl: true }),
    "invert-selection": b("i", { ctrl: true, shift: true }),
    "tool-rect": b("m"),
    "tool-auto": b("a"),
    "tool-shape": b("u"),
    "tool-line": null,
    "tool-box": null,
    "tool-ellipse": null,
    "tool-warp": b("w", { shift: true }),
    "tool-finger": b("r"),
    "tool-liquify": b("x", { shift: true }),
  },
  legacy: {
    ...COMMON,
    duplicate: b("d", { ctrl: true }),
    deselect: null,
    "invert-selection": null,
    "tool-rect": b("r"),
    "tool-auto": b("a"),
    "tool-shape": b("u"),
    "tool-line": b("l"),
    "tool-box": b("m"),
    "tool-ellipse": b("o"),
    "tool-warp": b("w"),
    "tool-finger": b("f"),
    "tool-liquify": b("x", { shift: true }),
    "default-colors": null, // plain D is free in the old layout, but a one-letter key for a rarely used function is left unassigned there
  },
};
export const DEFAULT_PRESET: PresetId = "photoshop";
/** the keys of the default preset (kept under this name: tests and tooltips start from it) */
export const DEFAULT_BINDINGS: Bindings = PRESETS[DEFAULT_PRESET];

/** extra keys that do the same as an action while the action still has its preset key (not editable, not listed as the action's key) */
export const PRESET_ALIASES: Record<PresetId, Partial<Record<ConfigurableAction, Binding[]>>> = {
  photoshop: {
    undo: [b("z", { ctrl: true, alt: true })], // "step backward": every press is one more undo step
    redo: [b("y", { ctrl: true })],
    delete: [b("Backspace")],
    // Photoshop's own key; the browser may take it before the page sees it (see BROWSER_FIRST), so Shift+T is the one to rely on
    "free-transform": [b("t", { ctrl: true })],
  },
  legacy: { redo: [b("y", { ctrl: true })] },
};

/** keys of Photoshop that this app cannot give a function: shown in the settings as "해당 기능 없음" instead of being registered */
export const NOT_AVAILABLE: { keys: string; what: string }[] = [
  { keys: "L", what: "올가미 선택 (선택 영역 도구가 없습니다)" },
  { keys: "W", what: "마술봉 (선택 영역 도구가 없습니다; 변형 도구는 Shift+W)" },
  { keys: "Z", what: "확대 도구·Alt+클릭 축소 (대신 Ctrl++ / Ctrl+- 와 화면의 + − 버튼)" },
  { keys: "Ctrl+E", what: "아래 레이어와 병합 (레이어 병합이 없습니다)" },
  { keys: "Ctrl+Shift+E", what: "모든 레이어 병합 (레이어 병합이 없습니다)" },
];

/** Keys the browser handles before the page sees them in an ordinary tab (new tab, new window, close tab). A page cannot cancel these;
 *  in a full-screen or installed-app window the Keyboard Lock API may let the page have them (tried at start-up, not verified here). */
export const BROWSER_FIRST: string[] = ["Ctrl+T", "Ctrl+N", "Ctrl+W", "Ctrl+Shift+T", "Ctrl+Shift+N", "Ctrl+Shift+W"];

export const ACTION_INFO: { id: ConfigurableAction; label: string; group: "편집" | "선택·그룹" | "이동·보기" | "레이어 순서" | "도구" | "색·크기" | "파일" }[] = [
  { id: "undo", label: "실행 취소 (Ctrl+Alt+Z: 여러 단계 뒤로)", group: "편집" },
  { id: "redo", label: "다시 실행", group: "편집" },
  { id: "copy", label: "레이어 복사", group: "편집" },
  { id: "cut", label: "레이어 잘라내기", group: "편집" },
  { id: "duplicate", label: "레이어 복제", group: "편집" },
  { id: "delete", label: "삭제", group: "편집" },
  { id: "select-all", label: "전체 선택", group: "선택·그룹" },
  { id: "deselect", label: "선택 해제", group: "선택·그룹" },
  { id: "invert-selection", label: "선택 반전", group: "선택·그룹" },
  { id: "group", label: "그룹 만들기", group: "선택·그룹" },
  { id: "ungroup", label: "그룹 해제", group: "선택·그룹" },
  { id: "free-transform", label: "자유 변형 (선택 전체의 크기·회전 상자)", group: "선택·그룹" },
  { id: "zoom-fit", label: "화면 맞춤", group: "이동·보기" },
  { id: "zoom-100", label: "100% 보기", group: "이동·보기" },
  { id: "zoom-in", label: "확대", group: "이동·보기" },
  { id: "zoom-out", label: "축소", group: "이동·보기" },
  { id: "nudge-left", label: "왼쪽으로 1px (Shift: 10px)", group: "이동·보기" },
  { id: "nudge-right", label: "오른쪽으로 1px (Shift: 10px)", group: "이동·보기" },
  { id: "nudge-up", label: "위로 1px (Shift: 10px)", group: "이동·보기" },
  { id: "nudge-down", label: "아래로 1px (Shift: 10px)", group: "이동·보기" },
  { id: "layer-forward", label: "한 칸 앞으로", group: "레이어 순서" },
  { id: "layer-backward", label: "한 칸 뒤로", group: "레이어 순서" },
  { id: "layer-front", label: "맨 앞으로", group: "레이어 순서" },
  { id: "layer-back", label: "맨 뒤로", group: "레이어 순서" },
  { id: "tool-select", label: "선택 도구", group: "도구" },
  { id: "tool-hand", label: "이동(손) 도구", group: "도구" },
  { id: "tool-rect", label: "영역 추출", group: "도구" },
  { id: "tool-auto", label: "자동 후보", group: "도구" },
  { id: "tool-shape", label: "선·사각형·원 (반복해서 누르면 차례로)", group: "도구" },
  { id: "tool-line", label: "선", group: "도구" },
  { id: "tool-box", label: "사각형", group: "도구" },
  { id: "tool-ellipse", label: "원", group: "도구" },
  { id: "tool-brush", label: "브러시", group: "도구" },
  { id: "tool-eraser", label: "지우개", group: "도구" },
  { id: "tool-text", label: "텍스트", group: "도구" },
  { id: "tool-memo", label: "메모", group: "도구" },
  { id: "tool-warp", label: "변형(왜곡)", group: "도구" },
  { id: "tool-liquify", label: "유동화 (모양을 밀어 바꿈)", group: "도구" },
  { id: "tool-finger", label: "손가락 (색을 번지게 함)", group: "도구" },
  { id: "tool-eyedropper", label: "스포이트", group: "도구" },
  { id: "swap-colors", label: "테두리·채움 색 바꾸기", group: "색·크기" },
  { id: "default-colors", label: "기본색(검정·흰색)", group: "색·크기" },
  { id: "brush-smaller", label: "브러시·손가락 크기 줄이기", group: "색·크기" },
  { id: "brush-bigger", label: "브러시·손가락 크기 키우기", group: "색·크기" },
  { id: "save", label: "프로젝트 저장", group: "파일" },
  { id: "open-project", label: "프로젝트 열기", group: "파일" },
];

/** keys that cannot be given to an action: the browser or the system keeps them (new tab, close tab, reload, find, print, ...), or
 *  the app already gives them a fixed meaning (paste is the browser's paste event; Enter and Esc finish or cancel a task; Tab moves focus).
 *  Ctrl+S, Ctrl+O, Ctrl+J, Ctrl+0/1, Ctrl++/-, Ctrl+Shift+I are NOT here: the page can take them (Photoshop's own keys use them). */
export const RESERVED: { binding: Binding; why: string }[] = [
  ...["t", "w", "n", "r", "l", "f", "p", "u", "h", "k", "e", "q", "v", "2", "3", "4", "5", "6", "7", "8", "9", "Tab"].map((k) => ({ binding: b(k, { ctrl: true }), why: "브라우저가 쓰는 키입니다" })),
  ...["t", "n", "w", "r", "j", "Delete", "b", "o", "a", "Tab"].map((k) => ({ binding: b(k, { ctrl: true, shift: true }), why: "브라우저가 쓰는 키입니다" })),
  ...["F1", "F3", "F5", "F6", "F7", "F10", "F11", "F12"].map((k) => ({ binding: b(k), why: "브라우저가 쓰는 키입니다" })),
  ...["F4", "ArrowLeft", "ArrowRight", "Tab"].map((k) => ({ binding: b(k, { alt: true }), why: "브라우저·시스템이 쓰는 키입니다" })),
  { binding: b("Enter"), why: "Enter는 작업 확정에 쓰입니다" },
  { binding: b("Escape"), why: "Esc는 선택·작업 취소에 쓰입니다" },
  { binding: b("Tab"), why: "Tab은 포커스 이동에 쓰입니다" },
  { binding: b(" "), why: "스페이스는 임시 손 이동과 버튼 누르기에 쓰입니다" },
];

const MODIFIER_KEYS = ["Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock", "Dead", "Process", "Unidentified"];

const PUNCT_BY_CODE: Record<string, string> = { BracketLeft: "[", BracketRight: "]", Equal: "=", Minus: "-", Backslash: "\\", Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'", Backquote: "`" };

/** The key of an event as a binding. Letters, digits and brackets come from the physical key (`code`) when the character is not usable
 *  (a Korean input method turns "b" into "ㅠ" or "Process"; Shift turns "]" into "}"), so a shortcut works whatever the input state is. */
export function bindingOf(e: KeyInfo): Binding {
  const code = e.code ?? "";
  let key: string;
  if (PUNCT_BY_CODE[code]) key = PUNCT_BY_CODE[code];
  else if (e.key.length === 1 && /^[A-Za-z0-9]$/.test(e.key)) key = e.key.toLowerCase();
  else if (/^Key[A-Z]$/.test(code)) key = code.slice(3).toLowerCase();
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return { key, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey };
}
export const sameBinding = (a: Binding | null, c: Binding | null) => !!a && !!c && a.key === c.key && a.ctrl === c.ctrl && a.shift === c.shift && a.alt === c.alt;

const KEY_NAMES: Record<string, string> = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Delete: "Delete", Backspace: "Backspace", " ": "Space" };
/** "Ctrl+Shift+Z", "V", "←"; "없음" for no key */
export function formatBinding(x: Binding | null): string {
  if (!x) return "없음";
  const key = KEY_NAMES[x.key] ?? (x.key.length === 1 ? x.key.toUpperCase() : x.key);
  return [x.ctrl ? "Ctrl" : "", x.alt ? "Alt" : "", x.shift ? "Shift" : "", key].filter(Boolean).join("+");
}

export type BindingCheck = { ok: true } | { ok: false; reason: string; conflict?: ConfigurableAction };

/** May `candidate` be given to `action`? Refused (with the reason) when it is only a modifier, reserved, or already used by another action. */
export function checkBinding(action: ConfigurableAction, candidate: Binding, current: Bindings): BindingCheck {
  if (MODIFIER_KEYS.includes(candidate.key)) return { ok: false, reason: "Ctrl·Shift·Alt 키만으로는 지정할 수 없습니다. 다른 키와 함께 누르세요." };
  const reserved = RESERVED.find((r) => sameBinding(r.binding, candidate));
  if (reserved) return { ok: false, reason: `${formatBinding(candidate)}: ${reserved.why}. 다른 키를 고르세요.` };
  for (const other of ACTION_INFO) {
    if (other.id === action) continue;
    const o = current[other.id];
    if (!o) continue;
    // a nudge key also fires with Shift held, so against a nudge key Shift does not tell two combinations apart
    const same = nudgeAction(action) || nudgeAction(other.id) ? sameIgnoringShift(o, candidate) : sameBinding(o, candidate);
    if (same) return { ok: false, conflict: other.id, reason: `${formatBinding(candidate)}은(는) 이미 "${other.label}"에 쓰이고 있습니다. 그 키를 먼저 바꾸거나 다른 키를 고르세요.` };
  }
  if (nudgeAction(action) && (candidate.ctrl || candidate.alt || candidate.shift)) return { ok: false, reason: "이동 키는 Shift 없이 한 키로 지정합니다 (Shift를 함께 누르면 10px 이동)." };
  return { ok: true };
}

const nudgeAction = (a: ShortcutAction) => a.startsWith("nudge-");
/** nudge keys also fire with Shift held (10px), so for them Shift is not part of the match */
const sameIgnoringShift = (a: Binding, c: Binding) => a.key === c.key && a.ctrl === c.ctrl && a.alt === c.alt;

/** What a key press means in the editor, or null when it means nothing here.
 *  Ctrl+V is not in this list: paste arrives as a `paste` event, which also carries the clipboard.
 *  Enter and Esc are fixed: they confirm or cancel a task (the caller checks that a task is under way).
 *  `aliases`: extra keys for actions that still have their preset key (the store passes the live ones). */
export function resolveShortcut(e: KeyInfo, bindings: Bindings = DEFAULT_BINDINGS, aliases: Partial<Record<ConfigurableAction, Binding[]>> = PRESET_ALIASES[DEFAULT_PRESET]): ShortcutAction | null {
  const pressed = bindingOf(e);
  let action: ShortcutAction | null = null;

  if (!pressed.ctrl && !pressed.alt && !pressed.shift && (e.key === "Enter" || e.key === "Escape")) {
    action = e.key === "Enter" ? "candidate-extract" : "candidate-clear";
  } else {
    for (const info of ACTION_INFO) {
      const bound = bindings[info.id];
      if (bound && (nudgeAction(info.id) ? sameIgnoringShift(bound, pressed) : sameBinding(bound, pressed))) {
        action = info.id;
        break;
      }
    }
    if (!action) {
      for (const info of ACTION_INFO) {
        if ((aliases[info.id] ?? []).some((a) => sameBinding(a, pressed))) {
          action = info.id;
          break;
        }
      }
    }
  }
  // holding a key must not delete, copy, cut, duplicate, group or save over and over
  if (e.repeat && ["delete", "duplicate", "copy", "cut", "group", "ungroup", "save", "open-project", "tool-shape", "invert-selection"].includes(action ?? "")) return null;
  return action;
}

/** the shortcut text shown in tooltips, for the default keys; the live text is `formatBinding(useBindings()[action])` */
export const SHORTCUT_HINT = { undo: "Ctrl+Z", redo: "Ctrl+Shift+Z", delete: "Delete", duplicate: "Ctrl+J", copy: "Ctrl+C", paste: "Ctrl+V", select: "V", hand: "H", rect: "M" } as const;
