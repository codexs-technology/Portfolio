export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...options.headers } });
  const data = await response.json() as { error?: string };
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}
export const https = (s: string) => /^https:\/\/[^\s]+$/i.test(s);