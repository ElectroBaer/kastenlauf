import { checkPassword } from '../auth';
import type { Config } from '../types';
import { h } from '../ui';

export function createLoginScreen(config: Config, onUnlock: () => void): HTMLElement {
  const input = h('input', {
    class: 'input',
    type: 'password',
    name: 'password',
    placeholder: 'Passwort',
    autocomplete: 'current-password',
    autocapitalize: 'off',
    autocorrect: 'off',
    required: true,
    'aria-label': 'Passwort',
  });
  const error = h('p', { class: 'form-error', role: 'alert' });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Los geht’s');

  const form = h(
    'form',
    {
      class: 'login-form',
      onsubmit: async (event: Event) => {
        event.preventDefault();
        error.textContent = '';
        submit.disabled = true;
        try {
          if (await checkPassword(input.value, config.auth.passwordHash)) {
            onUnlock();
          } else {
            error.textContent = 'Falsches Passwort. Nochmal versuchen!';
            input.value = '';
            input.focus();
          }
        } finally {
          submit.disabled = false;
        }
      },
    },
    input,
    submit,
    error,
  );

  return h(
    'section',
    { class: 'screen screen-login' },
    h(
      'div',
      { class: 'login-card' },
      h('p', { class: 'login-eyebrow' }, config.subtitle ?? ''),
      h('h1', { class: 'login-title' }, config.title),
      h('p', { class: 'login-hint' }, 'Gebt das Passwort ein, um den Fall zu übernehmen.'),
      form,
    ),
  );
}
