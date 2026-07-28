import { createMenuBar, h, renderStoryText } from '../ui';

export function createStoryScreen(options: {
  eyebrow?: string;
  title: string;
  text: string;
  actionLabel: string;
  onContinue: () => void;
  onOpenMenu?: () => void;
}): HTMLElement {
  return h(
    'section',
    { class: 'screen screen-story' },
    options.onOpenMenu ? createMenuBar(options.onOpenMenu) : null,
    h(
      'div',
      { class: 'screen-scroll' },
      h(
        'header',
        { class: 'story-header' },
        options.eyebrow ? h('p', { class: 'eyebrow' }, options.eyebrow) : null,
        h('h1', { class: 'story-title' }, options.title),
      ),
      renderStoryText(options.text),
    ),
    h(
      'footer',
      { class: 'screen-footer' },
      h(
        'button',
        { class: 'btn btn-primary', type: 'button', onclick: options.onContinue },
        options.actionLabel,
      ),
    ),
  );
}
