import type { CoverageHistory } from '../../../shared/contracts/coverage-history';

const NS = 'http://www.w3.org/2000/svg';
/** SVG chart with a bounded number of points and no runtime chart dependency. */
export function drawHistory(
  root: Document,
  container: HTMLElement,
  data: CoverageHistory,
): void {
  container.replaceChildren();
  const known = data.points.filter((point) => point.percentage !== null);
  if (!known.length) {
    const empty = root.createElement('p');
    empty.className = 'history-empty';
    empty.textContent = data.totalRuns
      ? 'These runs have no calculated coverage percentage.'
      : 'No coverage runs in this date range.';
    container.append(empty);
    return;
  }
  const width = 1040;
  const height = 410;
  const left = 64;
  const top = 25;
  const plotWidth = 940;
  const plotHeight = 320;
  const first = Date.parse(data.points[0]!.at);
  const last = Date.parse(data.points.at(-1)!.at);
  const x = (at: string) =>
    first === last
      ? left + plotWidth / 2
      : left + ((Date.parse(at) - first) / (last - first)) * plotWidth;
  const y = (value: number) =>
    top + plotHeight * (1 - Math.min(100, Math.max(0, value)) / 100);
  function svg<K extends keyof SVGElementTagNameMap>(
    tag: K,
    attributes: Record<string, string>,
    text?: string,
  ): SVGElementTagNameMap[K] {
    const node = root.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attributes))
      node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  const chart = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': `Coverage history: ${data.totalRuns} runs. ${data.aggregated ? 'Averages with minimum and maximum ranges.' : 'Individual run percentages.'}`,
  });
  chart.append(svg('title', {}, 'Apex class coverage over time'));
  for (const value of [0, 25, 50, 75, 100]) {
    chart.append(
      svg('line', {
        x1: String(left),
        x2: String(left + plotWidth),
        y1: String(y(value)),
        y2: String(y(value)),
        class: value === 75 ? 'chart-threshold' : 'chart-grid',
      }),
    );
    chart.append(
      svg(
        'text',
        {
          x: String(left - 12),
          y: String(y(value) + 4),
          'text-anchor': 'end',
          class: 'chart-label',
        },
        `${value}%`,
      ),
    );
  }
  const tickCount = first === last ? 1 : 5;
  for (let i = 0; i < tickCount; i++) {
    const instant =
      tickCount === 1 ? first : first + ((last - first) * i) / (tickCount - 1);
    const date = new Date(instant);
    chart.append(
      svg(
        'text',
        {
          x: String(x(date.toISOString())),
          y: String(top + plotHeight + 28),
          'text-anchor': 'middle',
          class: 'chart-label',
        },
        date.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        }),
      ),
    );
  }
  let path = '';
  let connected = false;
  for (const point of data.points) {
    if (point.percentage === null) {
      connected = false;
      continue;
    }
    const px = x(point.at);
    const py = y(point.percentage);
    path += `${connected ? 'L' : 'M'}${px.toFixed(2)},${py.toFixed(2)} `;
    connected = true;
    if (data.aggregated && point.minimum !== null && point.maximum !== null)
      chart.append(
        svg('line', {
          x1: String(px),
          x2: String(px),
          y1: String(y(point.minimum)),
          y2: String(y(point.maximum)),
          class: 'chart-range',
        }),
      );
  }
  chart.append(
    svg('path', { d: path.trim(), class: 'chart-line', fill: 'none' }),
  );
  const tooltip = root.createElement('div');
  tooltip.id = 'coverage-point-tooltip';
  tooltip.className = 'chart-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  for (const point of known) {
    const label = `${new Date(point.at).toLocaleString()}: ${point.percentage!.toFixed(2)}%${point.runId ? ` · ${point.runId}` : ` · average of ${point.count} runs, range ${point.minimum!.toFixed(2)}–${point.maximum!.toFixed(2)}%`}`;
    const dot = svg('circle', {
      cx: String(x(point.at)),
      cy: String(y(point.percentage!)),
      r: known.length === 1 ? '5' : '4',
      class: point.percentage! < 75 ? 'chart-point low' : 'chart-point',
      tabindex: '0',
      'aria-label': label,
      'aria-describedby': tooltip.id,
      'data-tooltip': `Date: ${new Date(point.at).toLocaleString()}\nCoverage: ${point.percentage!.toFixed(2)}%${point.runId ? `\nRun: ${point.runId}` : `\nAverage of ${point.count} runs · Min ${point.minimum!.toFixed(2)}% / Max ${point.maximum!.toFixed(2)}%`}`,
    });
    dot.append(svg('title', {}, label));
    chart.append(dot);
  }
  chart.append(
    svg(
      'text',
      {
        x: String(left + plotWidth / 2),
        y: String(height - 12),
        'text-anchor': 'middle',
        class: 'chart-label',
      },
      'Test run date',
    ),
  );
  function show(event: Event): void {
    const point = (event.target as Element | null)?.closest<SVGCircleElement>(
      '.chart-point',
    );
    if (!point) return;
    tooltip.textContent = point.getAttribute('data-tooltip');
    tooltip.hidden = false;
    const bounds =
      typeof container.getBoundingClientRect === 'function'
        ? container.getBoundingClientRect()
        : { left: 0, top: 0, width: 600, height: 300 };
    const pointBounds =
      typeof point.getBoundingClientRect === 'function'
        ? point.getBoundingClientRect()
        : { left: 100, top: 100, width: 8, height: 8 };
    const mouse = event as MouseEvent;
    const px = Number.isFinite(mouse.clientX)
      ? mouse.clientX
      : pointBounds.left + pointBounds.width / 2;
    const py = Number.isFinite(mouse.clientY) ? mouse.clientY : pointBounds.top;
    const width = tooltip.offsetWidth || 250;
    const height = tooltip.offsetHeight || 75;
    const left = Math.max(
      8,
      Math.min(px - bounds.left + 14, (bounds.width || 600) - width - 8),
    );
    let top = py - bounds.top - height - 12;
    if (top < 8) top = py - bounds.top + 14;
    top = Math.max(8, Math.min(top, (bounds.height || 300) - height - 8));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }
  chart.addEventListener('pointerover', show);
  chart.addEventListener('pointermove', show);
  chart.addEventListener('focusin', show);
  chart.addEventListener('pointerout', () => {
    if (!chart.contains(root.activeElement)) tooltip.hidden = true;
  });
  chart.addEventListener('pointerleave', () => {
    if (!chart.contains(root.activeElement)) tooltip.hidden = true;
  });
  chart.addEventListener('focusout', () => {
    tooltip.hidden = true;
  });
  chart.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') tooltip.hidden = true;
  });
  container.append(chart, tooltip);
}
