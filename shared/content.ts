export const categories = ['AI & Automation', 'Web Development', 'Custom Software', 'SaaS', 'CRM Systems', 'Game Development', 'Mobile Applications', 'UI/UX Design', 'Digital Marketing', 'Cloud & DevOps'];
export const expertise = ['AI Automation & AI Agents', 'Full-Stack Web Development', 'Custom Software & SaaS', 'CRM Development & Integrations', 'Game Platform Engineering', 'Cloud & DevOps', 'Digital Marketing, SEO & PPC'];
export const defaults = {
  headline: "Hi, I'm Mehboob Masih.",
  subtitle: 'Full-Stack Developer & AI Automation Engineer',
  intro: 'I build practical software, intelligent automation systems, and scalable digital products. As the founder of CodesBoxs, I work across custom development, AI integrations, CRM platforms, and cloud-native applications.',
  about: 'I’m Mehboob Masih, a full-stack developer, AI automation engineer and software architect based in Karachi, Sindh, Pakistan. I independently manage my Pakistan-based software development company, CodesBoxs SMC Pvt Ltd, including software engineering, project delivery, client communication, technical architecture and business operations.',
  biography: 'My approach is practical: understand the problem, choose the right tools, and build software that is clear, maintainable and useful. I also work independently with clients through Fiverr Pro and Upwork.',
  email: 'codexstechnology@gmail.com', phone: '+92 341 276 8875', location: 'Karachi, Sindh, Pakistan',
  github: 'https://github.com/codexs-technology', upwork: 'https://www.upwork.com/freelancers/~018c646c65d4dc42ea?mp_source=share', fiverr: 'https://pro.fiverr.com/freelancers/codexstechnolog',
  linkedin: '', facebook: '', instagram: '', profileImage: '', resume: '',
  services: expertise.join('\n'),
  seoTitle: 'Mehboob Masih — Developer & AI Automation Engineer',
  seoDescription: 'Personal portfolio of Mehboob Masih, full-stack developer, AI automation engineer and founder of CodesBoxs in Karachi, Pakistan.',
  ogImage: '', selectedRepos: '', analyticsToken: ''
};
export type Settings = typeof defaults;
export interface Project {
  id: string; title: string; slug: string; category: string; summary: string;
  description: string; objective: string; problem: string; solution: string; role: string;
  process: string; features: string; challenges: string; results: string;
  technologies: string[]; cover: string; coverAlt: string; video: string; github: string; live: string;
  completionDate: string; status: 'draft' | 'published'; featured: boolean; sortOrder: number;
  updated_at?: string; media?: Media[];
}
export interface Media { id: string; url: string; name: string; mime: string; size: number; alt: string; sort_order: number; project_id: string | null; }
export interface Entry { id: string; title: string; subtitle: string; body: string; sortOrder: number; }
export interface Repository { id: number; name: string; description: string | null; html_url: string; language: string | null; updated_at: string; }