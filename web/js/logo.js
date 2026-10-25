// The Skarbnik logo, "Cracked ring": a ring, a gold zigzag crack across it, and a solid centre dot. This is the one
// place the mark and the name are defined; the header, the intro and the favicon (favicon.svg) use this drawing.
// Ring and dot take currentColor, the crack takes --g (gold), and the gap under the crack takes --b (the background).
export const NAME = 'Skarbnik';

export function logo(size = 28, cls = '') {
  const crack = 'M5 38 L17 29 L26 42 L39 23 L47 38 L59 27';
  return `<svg class="k-logo ${cls}" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">` +
    `<circle cx="32" cy="32" r="25" fill="none" stroke="currentColor" stroke-width="4.5"/>` +
    `<path d="${crack}" fill="none" stroke="var(--b)" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="32" cy="32" r="9" fill="currentColor"/>` +
    `<path d="${crack}" fill="none" stroke="var(--g)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

