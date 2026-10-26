export class ImportValidationError extends Error {}

export function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new ImportValidationError(
      `${label} must contain 1–${max} characters.`,
    );
  }
  return value.trim();
}

export function orgId(value: unknown): string {
  const id = text(value, 'Org ID', 18);
  if (!/^00D[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?$/.test(id)) {
    throw new ImportValidationError(
      'Enter a 15- or 18-character Salesforce org ID beginning with 00D.',
    );
  }
  if (id.length === 18) return id;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
  let suffix = '';
  for (let group = 0; group < 3; group++) {
    let bits = 0;
    for (let index = 0; index < 5; index++) {
      if (/[A-Z]/.test(id[group * 5 + index]!)) bits |= 1 << index;
    }
    suffix += alphabet[bits];
  }
  return id + suffix;
}

export function hostName(value: unknown): string {
  const input = text(value, 'Hostname', 180);
  let url: URL;
  try {
    url = new URL(input.includes('://') ? input : `https://${input}`);
  } catch {
    throw new ImportValidationError(
      'Enter a valid Salesforce hostname or HTTPS instance URL.',
    );
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !url.hostname.includes('.') ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(
      url.hostname,
    ) ||
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search ||
    url.hash
  ) {
    throw new ImportValidationError(
      'Enter a hostname or HTTPS instance URL without a path, credentials, or query.',
    );
  }
  return url.hostname.toLowerCase();
}

export function importToken(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/.test(value))
    throw new ImportValidationError(
      'The import preview is invalid. Choose the file again.',
    );
  return value;
}

export function orgCursor(value: unknown): string {
  if (value === undefined || value === '') return '';
  return text(value, 'Org cursor', 18);
}
