export type ShortcutAction = "undo" | "redo" | "delete" | "duplicate" | "copy" | "tool-select" | "tool-hand" | "tool-rect" | "tool-line" | "tool-box" | "tool-ellipse" | "tool-eyedropper" | "tool-brush" | "tool-eraser" | "tool-text" | "tool-memo" | "tool-warp" | "tool-finger" | "select-all" | "tool-auto" | "candidate-extract" | "candidate-clear" | "nudge-left" | "nudge-right" | "nudge-up" | "nudge-down" | "group" | "ungroup";

export type KeyInfo = { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; repeat?: boolean };

/** A key combination. `ctrl` means Ctrl, or ⌘ on a Mac. `key` is a letter/digit in lower case, or a name such as "Delete", "ArrowLeft". */
export type Binding = { key: string; ctrl: boolean; shift: boolean; alt: boolean };
export type Bindings = Record<ConfigurableAction, Binding>;

/** the actions whose keys the user can change (Enter and Esc keep their meaning in a task, and Ctrl+V is the browser's paste event) */
export type ConfigurableAction = Exclude<ShortcutAction, "candidate-extract" | "candidate-clear">;

const b = (key: string, o: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}): Binding => ({ key, ctrl: !!o.ctrl, shift: !!o.shift, alt: !!o.alt });

export const DEFAULT_BINDINGS: Bindings = {
  undo: b("z", { ctrl: true }),
  redo: b("z", { ctrl: true, shift: true }),
  delete: b("Delete"),
  duplicate: b("d", { ctrl: true }),
  copy: b("c", { ctrl: true }),
  "select-all": b("a", { ctrl: true }),
  group: b("g", { ctrl: true }),
  ungroup: b("g", { ctrl: true, shift: true }),
  "nudge-left": b("ArrowLeft"),
  "nudge-right": b("ArrowRight"),
  "nudge-up": b("ArrowUp"),
  "nudge-down": b("ArrowDown"),
  "tool-select": b("v"),
  "tool-hand": b("h"),
  "tool-rect": b("r"),
  "tool-auto": b("a"),
  "tool-line": b("l"),
  "tool-box": b("m"),
  "tool-ellipse": b("o"),
  "tool-brush": b("b"),
  "tool-eraser": b("e"),
  "tool-text": b("t"),
  "tool-memo": b("n"),
  "tool-warp": b("w"),
  "tool-finger": b("f"),
  "tool-eyedropper": b("i"),
};

/** Ctrl+Y also redoes while redo still has its default key */
const REDO_ALIAS = b("y", { ctrl: true });

export const ACTION_INFO: { id: ConfigurableAction; label: string; group: "편집" | "선택·그룹" | "이동" | "도구" }[] = [
  { id: "undo", label: "실행 취소", group: "편집" },
  { id: "redo", label: "다시 실행", group: "편집" },
  { id: "copy", label: "레이어 복사", group: "편집" },
  { id: "duplicate", label: "레이어 복제", group: "편집" },
  { id: "delete", label: "삭제", group: "편집" },
  { id: "select-all", label: "전체 선택", group: "선택·그룹" },
  { id: "group", label: "그룹 만들기", group: "선택·그룹" },
  { id: "ungroup", label: "그룹 해제", group: "선택·그룹" },
  { id: "nudge-left", label: "왼쪽으로 1px (Shift: 10px)", group: "이동" },
  { id: "nudge-right", label: "오른쪽으로 1px (Shift: 10px)", group: "이동" },
  { id: "nudge-up", label: "위로 1px (Shift: 10px)", group: "이동" },
  { id: "nudge-down", label: "아래로 1px (Shift: 10px)", group: "이동" },
  { id: "tool-select", label: "선택 도구", group: "도구" },
  { id: "tool-hand", label: "이동 도구", group: "도구" },
  { id: "tool-rect", label: "영역 추출", group: "도구" },
  { id: "tool-auto", label: "자동 후보", group: "도구" },
  { id: "tool-line", label: "선", group: "도구" },
  { id: "tool-box", label: "사각형", group: "도구" },
  { id: "tool-ellipse", label: "원", group: "도구" },
  { id: "tool-brush", label: "브러시", group: "도구" },
  { id: "tool-eraser", label: "지우개", group: "도구" },
  { id: "tool-text", label: "텍스트", group: "도구" },
  { id: "tool-memo", label: "메모", group: "도구" },
  { id: "tool-warp", label: "변형", group: "도구" },
  { id: "tool-finger", label: "손가락", group: "도구" },
  { id: "tool-eyedropper", label: "스포이트", group: "도구" },
];

/** keys that cannot be given to an action: the browser or the system keeps them (new tab, close tab, reload, find, save, print, ...), or
 *  the app already gives them a fixed meaning (paste is the browser's paste event; Enter and Esc finish or cancel a task; Tab moves focus) */
export const RESERVED: { binding: Binding; why: string }[] = [
  ...["t", "w", "n", "r", "l", "f", "s", "p", "o", "u", "h", "j", "k", "e", "q", "x", "v", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "Tab", "+", "-", "="].map((k) => ({ binding: b(k, { ctrl: true }), why: "브라우저가 쓰는 키입니다" })),
  ...["t", "n", "w", "r", "i", "j", "Delete", "b", "o", "a", "Tab"].map((k) => ({ binding: b(k, { ctrl: true, shift: true }), why: "브라우저가 쓰는 키입니다" })),
  ...["F1", "F3", "F5", "F6", "F7", "F10", "F11", "F12"].map((k) => ({ binding: b(k), why: "브라우저가 쓰는 키입니다" })),
  ...["F4", "ArrowLeft", "ArrowRight", "Tab"].map((k) => ({ binding: b(k, { alt: true }), why: "브라우저·시스템이 쓰는 키입니다" })),
  { binding: b("Enter"), why: "Enter는 작업 확정에 쓰입니다" },
  { binding: b("Escape"), why: "Esc는 선택·작업 취소에 쓰입니다" },
  { binding: b("Tab"), why: "Tab은 포커스 이동에 쓰입니다" },
  { binding: b(" "), why: "스페이스는 버튼 누르기에 쓰입니다" },
];

const MODIFIER_KEYS = ["Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock", "Dead", "Process", "Unidentified"];

export const bindingOf = (e: KeyInfo): Binding => ({ key: e.key.length === 1 ? e.key.toLowerCase() : e.key, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey });
export const sameBinding = (a: Binding, c: Binding) => a.key === c.key && a.ctrl === c.ctrl && a.shift === c.shift && a.alt === c.alt;

const KEY_NAMES: Record<string, string> = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Delete: "Delete", Backspace: "Backspace", " ": "Space" };
/** "Ctrl+Shift+Z", "V", "←" */
export function formatBinding(x: Binding): string {
  const key = KEY_NAMES[x.key] ?? (x.key.length === 1 ? x.key.toUpperCase() : x.key);
  return [x.ctrl ? "Ctrl" : "", x.alt ? "Alt" : "", x.shift ? "Shift" : "", key].filter(Boolean).join("+");
}

export type BindingCheck = { ok: true } | { ok: false; reason: string; conflict?: ConfigurableAction };

/** May `candidate` be given to `action`? Refused (with the reason) when it is only a modifier, reserved, or already used by another action. */
export function checkBinding(action: ConfigurableAction, candidate: Binding, current: Bindings): BindingCheck {
  if (MODIFIER_KEYS.includes(candidate.key)) return { ok: false, reason: "Ctrl·Shift·Alt 키만으로는 지정할 수 없습니다. 다른 키와 함께 누르세요." };
  const reserved = RESERVED.find((r) => sameBinding(r.binding, candidate));
  if (reserved) return { ok: false, reason: `${formatBinding(candidate)}: ${reserved.why}. 다른 키를 고르세요.` };
  // a key typed into text boxes (a plain letter) is fine here, since shortcuts do nothing while a text box has focus
  for (const other of ACTION_INFO) {
    if (other.id === action) continue;
    // a nudge key also fires with Shift held, so against a nudge key Shift does not tell two combinations apart
    const same = nudgeAction(action) || nudgeAction(other.id) ? sameIgnoringShift(current[other.id], candidate) : sameBinding(current[other.id], candidate);
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
 *  Enter and Esc are fixed: they confirm or cancel a task (the caller checks that a task is under way). */
export function resolveShortcut(e: KeyInfo, bindings: Bindings = DEFAULT_BINDINGS): ShortcutAction | null {
  const pressed = bindingOf(e);
  let action: ShortcutAction | null = null;

  if (!pressed.ctrl && !pressed.alt && !pressed.shift && (e.key === "Enter" || e.key === "Escape")) {
    action = e.key === "Enter" ? "candidate-extract" : "candidate-clear";
  } else {
    for (const info of ACTION_INFO) {
      const bound = bindings[info.id];
      if (nudgeAction(info.id) ? sameIgnoringShift(bound, pressed) : sameBinding(bound, pressed)) {
        action = info.id;
        break;
      }
    }
    if (!action && sameBinding(REDO_ALIAS, pressed) && sameBinding(bindings.redo, DEFAULT_BINDINGS.redo)) action = "redo";
  }
  // holding a key must not delete, copy, duplicate or group over and over
  if (e.repeat && (action === "delete" || action === "duplicate" || action === "copy" || action === "group" || action === "ungroup")) return null;
  return action;
}

/** the shortcut text shown in tooltips, for the default keys; the live text is `shortcutLabel` in shortcut-store */
export const SHORTCUT_HINT = { undo: "Ctrl+Z", redo: "Ctrl+Shift+Z", delete: "Delete", duplicate: "Ctrl+D", copy: "Ctrl+C", paste: "Ctrl+V", select: "V", hand: "H", rect: "R" } as const;
