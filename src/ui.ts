type Attrs = Record<string, string | number | boolean | EventListener | undefined>;
type Child = Node | string | null | undefined | false;

/** Kleiner Element-Helfer — `on*`-Attribute werden als Listener gebunden. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'class') {
      node.className = String(value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Rendert die Markdown-Teilmenge, die in der Story vorkommt: Absätze
 * (Leerzeile), Zeilenumbrüche, `**fett**` und `*kursiv*`. Bewusst kein
 * Markdown-Paket — mehr braucht der Text nicht.
 */
export function renderStoryText(text: string): HTMLDivElement {
  const container = h('div', { class: 'prose' });
  for (const paragraph of text.split(/\n{2,}/)) {
    if (!paragraph.trim()) continue;
    const html = escapeHtml(paragraph)
      .replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br />');
    const node = h('p');
    node.innerHTML = html;
    container.append(node);
  }
  return container;
}

export interface ModalAction {
  label: string;
  /**
   * `debug` kennzeichnet Werkzeuge, die nichts mit dem Spiel zu tun haben.
   * Sie werden ans Ende gesetzt und deutlich abgehoben dargestellt.
   */
  variant?: 'primary' | 'ghost' | 'debug';
  /**
   * Lässt den Dialog offen. Für Umschalter sinnvoll — man will nach dem
   * Antippen sehen, was passiert ist, und ggf. gleich nochmal tippen.
   */
  keepOpen?: boolean;
  /** Bekommt den eigenen Button, um z.B. die Beschriftung zu aktualisieren. */
  onSelect: (button: HTMLButtonElement) => void;
}

let openModal: HTMLElement | null = null;

export function closeModal(): void {
  openModal?.remove();
  openModal = null;
}

export function showModal(options: {
  title: string;
  message?: string;
  /** Eigener Inhalt zwischen Text und Buttons, etwa ein Formular. */
  content?: HTMLElement;
  actions: ModalAction[];
  dismissible?: boolean;
}): void {
  closeModal();
  const backdrop = h('div', {
    class: 'modal-backdrop',
    onclick: (event: Event) => {
      if (options.dismissible && event.target === backdrop) closeModal();
    },
  });
  const dialog = h(
    'div',
    { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
    h('h2', { class: 'modal-title' }, options.title),
    options.message ? h('p', { class: 'modal-message' }, options.message) : null,
    options.content ?? null,
    h(
      'div',
      { class: 'modal-actions' },
      ...options.actions.flatMap((action, index) => {
        const button = h(
          'button',
          {
            class: `btn btn-${action.variant ?? 'primary'}`,
            type: 'button',
            onclick: () => {
              if (!action.keepOpen) closeModal();
              action.onSelect(button);
            },
          },
          action.label,
        );

        // Vor dem ersten Debug-Eintrag eine beschriftete Trennlinie: So liest
        // sich der Rest als angehängter Werkzeugkasten, nicht als weitere
        // Menüpunkte.
        const startsDebugBlock =
          action.variant === 'debug' && options.actions[index - 1]?.variant !== 'debug';
        return startsDebugBlock
          ? [h('p', { class: 'modal-divider' }, 'Debug'), button]
          : [button];
      }),
    ),
  );
  backdrop.append(dialog);
  document.body.append(backdrop);
  openModal = backdrop;
  dialog.querySelector<HTMLButtonElement>('button')?.focus();
}

let openToast: HTMLElement | null = null;

/** Kurzer Hinweis, der sich nicht in den Weg stellt und von selbst verschwindet. */
export function showToast(message: string, durationMs = 6000): void {
  openToast?.remove();
  const toast = h(
    'div',
    { class: 'toast', role: 'status' },
    h('span', {}, message),
    h(
      'button',
      {
        class: 'toast-close',
        type: 'button',
        'aria-label': 'Hinweis schließen',
        onclick: () => toast.remove(),
      },
      '✕',
    ),
  );
  document.body.append(toast);
  openToast = toast;
  setTimeout(() => toast.remove(), durationMs);
}

/**
 * Schmale Leiste mit dem Menüknopf für die Overlay-Screens.
 *
 * Bewusst als eigene Zeile **über** dem scrollenden Inhalt: Der Kopf mit Titel
 * scrollt mit dem Text weg, dort läge der Knopf nach ein paar Zeilen außer
 * Reichweite. Absolut positioniert würde er über langen Überschriften liegen.
 */
export function createMenuBar(onOpenMenu: () => void): HTMLElement {
  return h(
    'div',
    { class: 'screen-bar' },
    h(
      'button',
      { class: 'icon-btn', type: 'button', 'aria-label': 'Menü', onclick: onOpenMenu },
      '☰',
    ),
  );
}

export function confirmDialog(
  title: string,
  message: string,
  confirmLabel: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    showModal({
      title,
      message,
      dismissible: true,
      actions: [
        { label: confirmLabel, onSelect: () => resolve(true) },
        { label: 'Abbrechen', variant: 'ghost', onSelect: () => resolve(false) },
      ],
    });
  });
}
