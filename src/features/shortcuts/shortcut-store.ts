import { useSyncExternalStore } from "react";
import { ACTION_INFO, Binding, BindingCheck, Bindings, ConfigurableAction, DEFAULT_BINDINGS, checkBinding, formatBinding, sameBinding } from "./shortcuts";

/* The user's shortcut keys. They are a setting of this browser, not of a project: stored in localStorage (`slc-shortcuts`) as only the
 * keys that differ from the defaults, never in a project file or the temporary save. A damaged or partly invalid entry is ignored
 * key by key (the default stays), so a bad value can never lock a shortcut away. */

export const SHORTCUTS_STORAGE_KEY = "slc-shortcuts";
const FORMAT = 1;

type Listener = () => void;

function validBinding(v: unknown): v is Binding {
  if (typeof v !== "object" || v === null) return false;
  const x = v as Record<string, unknown>;
  return typeof x.key === "string" && x.key.length >= 1 && x.key.length <= 20 && typeof x.ctrl === "boolean" && typeof x.shift === "boolean" && typeof x.alt === "boolean";
}

/** the saved text as bindings: defaults, with each valid saved key applied when it passes the same checks as typing it in */
export function parseStoredBindings(text: string | null): Bindings {
  const out: Bindings = { ...DEFAULT_BINDINGS };
  if (!text) return out;
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return out;
  }
  const saved = (doc as { format?: unknown; bindings?: unknown } | null)?.bindings;
  if ((doc as { format?: unknown } | null)?.format !== FORMAT || typeof saved !== "object" || saved === null) return out;
  for (const info of ACTION_INFO) {
    const v = (saved as Record<string, unknown>)[info.id];
    if (validBinding(v)) out[info.id] = { key: v.key, ctrl: v.ctrl, shift: v.shift, alt: v.alt };
  }
  // the saved keys are applied together (a key may have moved from one action to another), then each is checked against the rest;
  // one that is reserved or collides goes back to its default, so a bad file cannot leave two actions on one key
  for (const info of ACTION_INFO) {
    if (sameBinding(out[info.id], DEFAULT_BINDINGS[info.id])) continue;
    if (!checkBinding(info.id, out[info.id], out).ok) out[info.id] = DEFAULT_BINDINGS[info.id];
  }  return out;
}

export function serializeBindings(bindings: Bindings): string {
  const changed: Partial<Bindings> = {};
  for (const info of ACTION_INFO) if (!sameBinding(bindings[info.id], DEFAULT_BINDINGS[info.id])) changed[info.id] = bindings[info.id];
  return JSON.stringify({ format: FORMAT, bindings: changed });
}

export type ShortcutStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function createShortcutStore(storage: ShortcutStorage | null = typeof window === "undefined" ? null : safeLocalStorage()) {
  const read = () => {
    try {
      return parseStoredBindings(storage?.getItem(SHORTCUTS_STORAGE_KEY) ?? null);
    } catch {
      return { ...DEFAULT_BINDINGS }; // storage blocked: the defaults, and changes last until the page closes
    }
  };
  let bindings: Bindings = read();
  const listeners = new Set<Listener>();
  const emit = () => listeners.forEach((l) => l());
  const persist = () => {
    try {
      const text = serializeBindings(bindings);
      if (text === serializeBindings(DEFAULT_BINDINGS)) storage?.removeItem(SHORTCUTS_STORAGE_KEY);
      else storage?.setItem(SHORTCUTS_STORAGE_KEY, text);
    } catch {
      /* not saved; the change still applies for this page */
    }
  };
  return {
    get: () => bindings,
    subscribe(l: Listener) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    /** gives `action` the key, unless it is refused (reserved, or used by another action): then nothing changes and the reason comes back */
    set(action: ConfigurableAction, binding: Binding): BindingCheck {
      const check = checkBinding(action, binding, bindings);
      if (!check.ok) return check;
      bindings = { ...bindings, [action]: binding };
      persist();
      emit();
      return check;
    },
    reset() {
      bindings = { ...DEFAULT_BINDINGS };
      persist();
      emit();
    },
    /** another tab changed the setting */
    reload() {
      bindings = read();
      emit();
    },
  };
}

function safeLocalStorage(): ShortcutStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const shortcutStore = createShortcutStore();

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => e.key === SHORTCUTS_STORAGE_KEY && shortcutStore.reload());
}

export const useBindings = (): Bindings => useSyncExternalStore(shortcutStore.subscribe, shortcutStore.get, () => DEFAULT_BINDINGS);

/** the live key text of an action ("Ctrl+Z", "V") for tooltips; it follows the setting */
export function useShortcutLabel(action: ConfigurableAction): string {
  return formatBinding(useBindings()[action]);
}
