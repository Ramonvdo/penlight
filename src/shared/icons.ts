const svg = (inner: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const icons = {
  grip: `<svg viewBox="0 0 10 16" fill="currentColor" aria-hidden="true"><circle cx="2.5" cy="2.5" r="1.4"/><circle cx="7.5" cy="2.5" r="1.4"/><circle cx="2.5" cy="8" r="1.4"/><circle cx="7.5" cy="8" r="1.4"/><circle cx="2.5" cy="13.5" r="1.4"/><circle cx="7.5" cy="13.5" r="1.4"/></svg>`,
  shuffle: svg(
    `<path d="M3 7h4l10 10h4"/><path d="M21 7h-4l-3.2 3.2"/><path d="M10.2 13.8 7 17H3"/><path d="m18.5 4.5 2.5 2.5-2.5 2.5"/><path d="m18.5 14.5 2.5 2.5-2.5 2.5"/>`,
  ),
  pen: svg(
    `<path d="M3.5 18.5c2.4-5.4 4.3-7.9 5.6-7.1 1.5.9-2.4 5.5-.8 6.5 1.6 1 4.5-4.8 6.3-3.8 1.5.8-.6 3.5 1 4.1 1.2.5 3-.9 4.9-3.7"/>`,
  ),
  highlighter: svg(
    `<path d="m9.5 10.5 4 4"/><path d="M6 14 14.5 5.5a1.4 1.4 0 0 1 2 0l2 2a1.4 1.4 0 0 1 0 2L10 18H7l-1-1v-3z"/><path d="M3.5 21h8"/>`,
  ),
  arrow: svg(`<path d="M17 7 7 17"/><path d="M7 10.5V17h6.5"/>`),
  line: svg(`<path d="M5 19 19 5"/>`),
  rect: svg(`<rect x="4" y="6" width="16" height="12" rx="1.5"/>`),
  ellipse: svg(`<circle cx="12" cy="12" r="8"/>`),
  text: svg(`<path d="M5 6h14"/><path d="M12 6v13"/>`),
  eraser: svg(
    `<path d="M9.5 19 4.6 14.1a2 2 0 0 1 0-2.8L11.8 4a2 2 0 0 1 2.8 0l5 5a2 2 0 0 1 0 2.8L13 19"/><path d="M8 8.8 15.2 16"/><path d="M13 19h8"/>`,
  ),
  cursorArrow: svg(`<path d="M5.5 3.5 19 11l-6 1.5L9.5 19 5.5 3.5z"/>`),
  close: svg(`<path d="m6 6 12 12M18 6 6 18"/>`),
  weight: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="4.5" cy="12" r="1.2"/><circle cx="11" cy="12" r="2"/><circle cx="19" cy="12" r="3.1"/></svg>`,
  boards: svg(
    `<rect x="3.5" y="4" width="13" height="13" rx="2"/><path d="M20.5 8.5v9a3 3 0 0 1-3 3h-9"/><path d="M7 9.5h6M7 12.5h4"/>`,
  ),
};
