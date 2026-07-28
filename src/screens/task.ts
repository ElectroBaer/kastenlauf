import type { Station } from '../types';
import { createMenuBar, h, renderStoryText } from '../ui';

/**
 * Vereinheitlicht Eingabe und Musterlösung, damit am Spieltag nicht an
 * Groß-/Kleinschreibung, Punkten oder Leerzeichen gescheitert wird:
 * "J. Jonas", "j jonas" und "JJonas" sind gleich.
 */
export function normalizeAnswer(value: string): string {
  return value
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function isCorrect(input: string, answers: string[]): boolean {
  const normalized = normalizeAnswer(input);
  return normalized.length > 0 && answers.some((answer) => normalizeAnswer(answer) === normalized);
}

export function createTaskScreen(options: {
  station: Station;
  onSolved: () => void;
  onOpenMenu?: () => void;
}): HTMLElement {
  const { station } = options;
  const body = h(
    'div',
    { class: 'screen-scroll' },
    h(
      'header',
      { class: 'story-header' },
      h('p', { class: 'eyebrow' }, station.title),
      h('h1', { class: 'story-title' }, 'Aufgabe'),
    ),
    renderStoryText(station.task.prompt),
  );

  const footer = h('footer', { class: 'screen-footer' });

  if (station.task.type === 'acknowledge') {
    footer.append(
      h(
        'button',
        { class: 'btn btn-primary', type: 'button', onclick: options.onSolved },
        'Aufgabe erledigt',
      ),
    );
  } else {
    const input = h('input', {
      class: 'input',
      type: 'text',
      name: 'answer',
      placeholder: 'Lösung eingeben',
      autocomplete: 'off',
      autocapitalize: 'off',
      autocorrect: 'off',
      spellcheck: false,
      'aria-label': 'Lösung',
    });
    const error = h('p', { class: 'form-error', role: 'alert' });
    let attempts = 0;

    const form = h(
      'form',
      {
        class: 'task-form',
        onsubmit: (event: Event) => {
          event.preventDefault();
          if (isCorrect(input.value, station.task.answers)) {
            options.onSolved();
            return;
          }
          attempts += 1;
          error.textContent =
            attempts >= 3
              ? 'Immer noch nicht richtig. Lest den Text nochmal ganz genau.'
              : 'Das ist leider nicht richtig.';
          input.select();
        },
      },
      input,
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Prüfen'),
      error,
    );

    if (station.task.hint) {
      const hint = h('p', { class: 'task-hint', hidden: true }, station.task.hint);
      form.append(
        h(
          'button',
          {
            class: 'btn btn-ghost',
            type: 'button',
            onclick: (event: Event) => {
              hint.hidden = false;
              (event.currentTarget as HTMLButtonElement).remove();
            },
          },
          'Tipp anzeigen',
        ),
        hint,
      );
    }

    footer.append(form);
  }

  return h(
    'section',
    { class: 'screen screen-task' },
    options.onOpenMenu ? createMenuBar(options.onOpenMenu) : null,
    body,
    footer,
  );
}
