import { useSyncExternalStore } from "react";
import { ACTION_INFO, Binding, BindingCheck, Bindings, ConfigurableAction, DEFAULT_PRESET, PRESETS, PRESET_ALIASES, PresetId, checkBinding, formatBinding, sameBinding } from "./shortcuts";

/* The user's shortcut keys. They are a setting of this browser, not of a project: stored in localStorage (`slc-shortcuts`) as the chosen
 * preset and only the keys that differ from it, never in a project file or the temporary save. A damaged or partly invalid entry is
 * ignored key by key (the preset's key stays), so a bad value can never lock a shortcut away.
 * Format 2 = {format: 2, preset, bindings}. Format 1 (before presets) is not read: it was made against the old layout. */

export const SHORTCUTS_STORAGE_KEY = "slc-shortcuts";
const FORMAT = 2;

type Listener = () => void;
export type ShortcutSetting = { preset: PresetId; bindings: Bindings };

function validBinding(v: unknown): v is Binding {
  if (typeof v !== "object" || v === null) return false;
  const x = v as Record<string, unknown>;
  return typeof x.key === "string" && x.key.length >= 1 && x.key.length <= 20 && typeof x.ctrl === "boolean" && typeof x.shift === "boolean" && typeof x.alt === "boolean";
}
const isPreset = (v: unknown): v is PresetId => v === "photoshop" || v === "legacy";

/** the saved text as a setting: the preset, with each valid saved key applied when it passes the same checks as typing it in */
export function parseStoredSetting(text: string | null): ShortcutSetting {
  const fallback: ShortcutSetting = { preset: DEFAULT_PRESET, bindings: { ...PRESETS[DEFAULT_PRESET] } };
  if (!text) return fallback;
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return fallback;
  }
  const d = doc as { format?: unknown; preset?: unknown; bindings?: unknown } | null;
  if (!d || d.format !== FORMAT) return fallback;
  const preset: PresetId = isPreset(d.preset) ? d.preset : DEFAULT_PRESET;
  const out: Bindings = { ...PRESETS[preset] };
  const saved = d.bindings;
  if (typeof saved !== "object" || saved === null) return { preset, bindings: out };
  for (const info of ACTION_INFO) {
    const v = (saved as Record<string, unknown>)[info.id];
    if (v === null) out[info.id] = null; // the user cleared this key
    else if (validBinding(v)) out[info.id] = { key: v.key, ctrl: v.ctrl, shift: v.shift, alt: v.alt };
  }
  // the saved keys are applied together (a key may have moved from one action to another), then each is checked against the rest;
  // one that is reserved or collides goes back to the preset's, so a bad file cannot leave two actions on one key
  for (const info of ACTION_INFO) {
    const cur = out[info.id];
    if (!cur || sameBinding(cur, PRESETS[preset][info.id])) continue;
    if (!checkBinding(info.id, cur, out).ok) out[info.id] = PRESETS[preset][info.id];
  }
  return { preset, bindings: out };
}

export function serializeSetting(s: ShortcutSetting): string {
  const changed: Partial<Record<ConfigurableAction, Binding | null>> = {};
  for (const info of ACTION_INFO) {
    const a = s.bindings[info.id], p = PRESETS[s.preset][info.id];
    if (a === null ? p !== null : !sameBinding(a, p)) changed[info.id] = a;
  }
  return JSON.stringify({ format: FORMAT, preset: s.preset, bindings: changed });
}

/** the extra keys that are live: those of the preset, for each action that still has the preset's own key */
export function liveAliases(s: ShortcutSetting): Partial<Record<ConfigurableAction, Binding[]>> {
  const out: Partial<Record<ConfigurableAction, Binding[]>> = {};
  for (const [id, list] of Object.entries(PRESET_ALIASES[s.preset]) as [ConfigurableAction, Binding[]][]) {
    if (sameBinding(s.bindings[id], PRESETS[s.preset][id])) out[id] = list;
  }
  return out;
}

export type ShortcutStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function createShortcutStore(storage: ShortcutStorage | null = typeof window === "undefined" ? null : safeLocalStorage()) {
  const read = (): ShortcutSetting => {
    try {
      return parseStoredSetting(storage?.getItem(SHORTCUTS_STORAGE_KEY) ?? null);
    } catch {
      return { preset: DEFAULT_PRESET, bindings: { ...PRESETS[DEFAULT_PRESET] } }; // storage blocked: the defaults, and changes last until the page closes
    }
  };
  let setting: ShortcutSetting = read();
  let aliases = liveAliases(setting);
  const listeners = new Set<Listener>();
  const emit = () => {
    aliases = liveAliases(setting);
    listeners.forEach((l) => l());
  };
  const persist = () => {
    try {
      const plain = serializeSetting({ preset: DEFAULT_PRESET, bindings: PRESETS[DEFAULT_PRESET] });
      const text = serializeSetting(setting);
      if (text === plain) storage?.removeItem(SHORTCUTS_STORAGE_KEY);
      else storage?.setItem(SHORTCUTS_STORAGE_KEY, text);
    } catch {
      /* not saved; the change still applies for this page */
    }
  };
  return {
    get: () => setting.bindings,
    preset: () => setting.preset,
    aliases: () => aliases,
    subscribe(l: Listener) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    /** gives `action` the key, unless it is refused (reserved, or used by another action): then nothing changes and the reason comes back */
    set(action: ConfigurableAction, binding: Binding): BindingCheck {
      const check = checkBinding(action, binding, setting.bindings);
      if (!check.ok) return check;
      setting = { ...setting, bindings: { ...setting.bindings, [action]: binding } };
      persist();
      emit();
      return check;
    },
    /** take the key away from an action (it stays in the tool bar or on a button) */
    clear(action: ConfigurableAction) {
      setting = { ...setting, bindings: { ...setting.bindings, [action]: null } };
      persist();
      emit();
    },
    /** change to a preset: its keys replace every key, the individual changes are dropped */
    setPreset(preset: PresetId) {
      setting = { preset, bindings: { ...PRESETS[preset] } };
      persist();
      emit();
    },
    /** back to the keys of the current preset */
    reset() {
      setting = { preset: setting.preset, bindings: { ...PRESETS[setting.preset] } };
      persist();
      emit();
    },
    /** another tab changed the setting */
    reload() {
      setting = read();
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

export const useBindings = (): Bindings => useSyncExternalStore(shortcutStore.subscribe, shortcutStore.get, () => PRESETS[DEFAULT_PRESET]);
export const usePreset = (): PresetId => useSyncExternalStore(shortcutStore.subscribe, shortcutStore.preset, () => DEFAULT_PRESET);

/** the live key text of an action ("Ctrl+Z", "V") for tooltips; it follows the setting */
export function useShortcutLabel(action: ConfigurableAction): string {
  return formatBinding(useBindings()[action]);
}
