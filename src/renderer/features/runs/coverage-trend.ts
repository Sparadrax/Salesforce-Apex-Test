/** Compare the displayed (database-rounded) percentages, never missing values as zero. */
export function coverageTrend(
  root: Document,
  current: number | null,
  previous: number | null,
): HTMLSpanElement {
  const indicator = root.createElement('span');
  indicator.className = 'coverage-trend';
  indicator.setAttribute('role', 'img');
  let label: string;
  if (current === null || previous === null) {
    indicator.textContent = '—';
    label = 'No comparison available with the previous run.';
  } else if (current === previous) {
    indicator.textContent = '=';
    label = `Coverage unchanged at ${current.toFixed(2)}% compared with the previous run.`;
  } else {
    const improved = current > previous;
    indicator.classList.add(
      improved ? 'coverage-trend-up' : 'coverage-trend-down',
    );
    const svg = root.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    const chevron = root.createElementNS(
      'http://www.w3.org/2000/svg',
      'polyline',
    );
    chevron.setAttribute(
      'points',
      improved ? '3,10 8,5 13,10' : '3,6 8,11 13,6',
    );
    svg.append(chevron);
    indicator.append(svg);
    label = `Coverage ${improved ? 'improved' : 'decreased'} from ${previous.toFixed(2)}% to ${current.toFixed(2)}% compared with the previous run.`;
  }
  indicator.title = label;
  indicator.setAttribute('aria-label', label);
  return indicator;
}
