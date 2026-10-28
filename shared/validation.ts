import { z } from 'zod';
export const safeUrl = z.string().max(2048).refine(v => !v || /^https:\/\/[^\s]+$/i.test(v), 'Use a full HTTPS URL, or leave empty');
export const mediaUrl = z.string().max(2048).refine(v => !v || /^\/media\/[a-zA-Z0-9._/-]+$/.test(v) || /^https:\/\/[^\s]+$/i.test(v), 'Use an uploaded /media/ path or HTTPS URL');
const text = z.string().max(30000).default('');
export const projectSchema = z.object({
  title: z.string().min(1).max(160), slug: z.string().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  category: z.string().min(1).max(100), summary: z.string().min(1).max(500),
  description: text, objective: text, problem: text, solution: text, role: text, process: text, features: text, challenges: text, results: text,
  technologies: z.array(z.string().min(1).max(80)).max(30).default([]),
  cover: mediaUrl.default(''), coverAlt: z.string().max(500).default(''), video: safeUrl.default(''), github: safeUrl.default(''), live: safeUrl.default(''),
  completionDate: z.string().refine(v => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Use YYYY-MM-DD').default(''),
  status: z.enum(['draft', 'published']).default('draft'), featured: z.boolean().default(false), sortOrder: z.number().int().min(0).max(100000).default(0)
});
export const contactSchema = z.object({
  name: z.string().trim().min(2).max(120), email: z.email().max(254), type: z.string().min(1).max(100),
  budget: z.string().max(100).default(''), message: z.string().trim().min(20).max(5000), token: z.string().min(1).max(2048)
});
export const entrySchema = z.object({ title: z.string().min(1).max(160), subtitle: z.string().max(200).default(''), body: z.string().max(10000).default(''), sortOrder: z.number().int().min(0).max(100000).default(0) });
export function validFile(bytes: Uint8Array, mime: string): boolean {
  const starts = (...v: number[]) => v.every((n, i) => bytes[i] === n);
  if (mime === 'image/jpeg') return starts(255, 216, 255);
  if (mime === 'image/png') return starts(137, 80, 78, 71, 13, 10, 26, 10);
  if (mime === 'image/gif') return new TextDecoder().decode(bytes.slice(0, 6)).match(/^GIF8[79]a$/) !== null;
  if (mime === 'image/webp') return new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
  if (mime === 'application/pdf') return starts(37, 80, 68, 70, 45);
  return false;
}