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
  variant?: 'primary' | 'ghost';
  onSelect: () => void;
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
      ...options.actions.map((action) =>
        h(
          'button',
          {
            class: `btn ${action.variant === 'ghost' ? 'btn-ghost' : 'btn-primary'}`,
            type: 'button',
            onclick: () => {
              closeModal();
              action.onSelect();
            },
          },
          action.label,
        ),
      ),
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
