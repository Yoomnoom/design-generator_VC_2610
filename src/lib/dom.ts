/** True when keystrokes belong to a text control, so editor shortcuts and paste handlers must stay out of the way.
 *  Duck-typed on purpose: it only reads tagName and isContentEditable. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el || typeof el.tagName !== "string") return false;
  // a focused checkbox, radio or button takes no typing (a slider does: it uses the arrow keys): shortcuts keep working with focus on one of them
  if (el.tagName === "INPUT" && /^(checkbox|radio|button|submit|reset|image)$/.test((target as HTMLInputElement).type)) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable === true;
}
