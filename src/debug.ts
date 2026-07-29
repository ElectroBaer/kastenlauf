import { distanceMeters, formatDistance, interpolate } from './geo';
import type { Config, LatLng } from './types';
import { h } from './ui';

export function isDebugEnabled(): boolean {
  return new URLSearchParams(location.search).has('debug');
}

/**
 * Panel für Entwicklung und Generalprobe: schiebt eine simulierte Position
 * entlang der Route, statt echtes GPS abzuwarten. Nur aktiv mit `?debug=1`.
 */
export function createDebugPanel(options: {
  config: Config;
  onSimulate: (coords: LatLng | null) => void;
  onSkip: () => void;
  onEvent: () => void;
}): HTMLElement {
  const { start, finish } = options.config.route;
  const routeLength = distanceMeters(start, finish);
  const readout = h('span', { class: 'debug-readout' }, 'GPS aktiv');

  const slider = h('input', {
    class: 'debug-slider',
    type: 'range',
    min: '0',
    max: '1000',
    value: '0',
    'aria-label': 'Position auf der Route',
    oninput: (event: Event) => {
      const fraction = Number((event.currentTarget as HTMLInputElement).value) / 1000;
      const coords = interpolate(start, finish, fraction);
      readout.textContent = `${Math.round(fraction * 100)} % — ${formatDistance(
        fraction * routeLength,
      )} ab Start`;
      options.onSimulate(coords);
    },
  });

  return h(
    'div',
    { class: 'debug-panel' },
    h(
      'div',
      { class: 'debug-row' },
      h('strong', {}, 'Debug'),
      readout,
      h(
        'button',
        {
          class: 'btn btn-ghost btn-small',
          type: 'button',
          onclick: () => {
            slider.value = '0';
            readout.textContent = 'GPS aktiv';
            options.onSimulate(null);
          },
        },
        'GPS',
      ),
      h(
        'button',
        { class: 'btn btn-ghost btn-small', type: 'button', onclick: options.onSkip },
        'Station auslösen',
      ),
      h(
        'button',
        { class: 'btn btn-ghost btn-small', type: 'button', onclick: options.onEvent },
        'Ereignis auslösen',
      ),
    ),
    slider,
  );
}
