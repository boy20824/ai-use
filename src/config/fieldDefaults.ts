// Keep the template key 警局 as its visible label; both spellings share one default.
const policeBureau = '臺南市政府警察局'

export const fieldDefaults: Readonly<Record<string, string>> = {
  警局: policeBureau,
  警察局: policeBureau,
  分局: '白河分局',
}

/** Copy the draft, filling only blank configured fields that are available. */
export function applyFieldDefaults(
  values: Record<string, string>,
  fields: readonly string[] = Object.keys(fieldDefaults),
): Record<string, string> {
  const next = { ...values }
  for (const key of fields) {
    if (Object.hasOwn(fieldDefaults, key) && !next[key]?.trim()) {
      next[key] = fieldDefaults[key]!
    }
  }
  return next
}
