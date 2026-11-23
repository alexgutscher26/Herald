import {
  IMPORT_FIELDS,
  headerKey,
  presetSignature,
  type ImportFormat,
  type ImportMapping,
} from "./types";

/**
 * Remembered column mappings.
 *
 * A preset is tied to the set of headers (its signature), not to a file, so the
 * same export re-applies its mapping next month even if the columns moved.
 * Header names are matched case- and punctuation-insensitively; a header that
 * disappeared is dropped rather than guessed.
 */

export type ImportPresetView = {
  id: string;
  name: string;
  format: ImportFormat;
  signature: string;
  mapping: ImportMapping;
  updatedAt: string;
};

export function presetApplies(preset: { signature: string }, headers: string[]): boolean {
  return preset.signature === presetSignature(headers);
}

export function applyPresetMapping(
  stored: ImportMapping,
  headers: string[],
): ImportMapping | null {
  const byKey = new Map<string, string>();
  for (const header of headers) {
    const key = headerKey(header);
    if (!byKey.has(key)) byKey.set(key, header);
  }

  const mapping: ImportMapping = {};
  const used = new Set<string>();
  for (const field of IMPORT_FIELDS) {
    const savedHeader = stored[field];
    if (!savedHeader) continue;
    const current = byKey.get(headerKey(savedHeader));
    if (!current || used.has(current)) continue;
    mapping[field] = current;
    used.add(current);
  }

  return mapping.title ? mapping : null;
}
