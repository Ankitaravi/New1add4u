export const validHprId = (s: string) => /^\d{14}$/.test(s.replace(/-/g, ''));

/** "71123456789012" -> "71-1234-5678-9012" */
export function formatHprId(digits: string): string {
  const d = digits.replace(/\D/g, '');
  return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}-${d.slice(10, 14)}`;
}
