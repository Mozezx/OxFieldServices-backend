import type { ToconlineJson } from './types/toconline.types';

export type ToconlineHttpContext = {
  baseUrl: string;
  getToken: () => Promise<string>;
};

export class ToconlineHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly bodySnippet: string,
  ) {
    super(message);
    this.name = 'ToconlineHttpError';
  }
}

function joinUrl(base: string, path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base.replace(/\/$/, '')}${p}`;
}

export async function toconlineFetchJson(
  ctx: ToconlineHttpContext,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const token = await ctx.getToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(joinUrl(ctx.baseUrl, path), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = { raw: text };
    }
  }
  if (!res.ok) {
    const snippet =
      typeof text === 'string' ? text.slice(0, 800) : JSON.stringify(parsed);
    throw new ToconlineHttpError(
      `TOConline ${method} ${path} → ${res.status}`,
      res.status,
      snippet,
    );
  }
  return parsed;
}

export function unwrapDataArray(root: unknown): ToconlineJson[] {
  if (!root || typeof root !== 'object') return [];
  const data = (root as ToconlineJson).data;
  if (Array.isArray(data)) return data as ToconlineJson[];
  if (data && typeof data === 'object') return [data as ToconlineJson];
  return [];
}

export function unwrapAttributes(node: ToconlineJson): ToconlineJson {
  const attrs = node.attributes;
  if (attrs && typeof attrs === 'object') return attrs as ToconlineJson;
  return {};
}
