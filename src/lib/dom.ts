/** True when keystrokes belong to a text control, so editor shortcuts and paste handlers must stay out of the way.
 *  Duck-typed on purpose: it only reads tagName and isContentEditable. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el || typeof el.tagName !== "string") return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable === true;
}
