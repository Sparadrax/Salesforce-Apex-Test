export function element<T extends HTMLElement>(root: Document, id: string): T {
  const node = root.getElementById(id);
  if (!node) throw new Error(`Missing screen element: ${id}`);
  return node as T;
}
export function message(error: unknown): string {
  return (
    error instanceof Error
      ? error.message
      : 'An unexpected error occurred. Try again.'
  ).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}
export function dateText(value: string | null): string {
  return value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'Undated run';
}
export function cell(root: Document, text: string): HTMLTableCellElement {
  const td = root.createElement('td');
  td.textContent = text;
  return td;
}
