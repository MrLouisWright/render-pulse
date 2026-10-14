import type { Report, Rule } from './core.js';
export * from './core.js';
export interface RenderOptions { baseUrl?: string; include?: string[]; exclude?: string[]; cleanUrls?: boolean; maxCss?: number; toolVersion?: string; now?: Date }
export declare const RULES: Record<string, Rule>;
export declare function blocksRender(attrs: Record<string, string>): boolean;
export declare function check(dir: string, opts?: RenderOptions, config?: Record<string, unknown>, configFile?: string): Report;
