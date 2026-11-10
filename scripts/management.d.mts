export const projectRef: string;
export function management(path: string, options?: {method?: string;body?: Record<string, unknown>}): Promise<unknown>;
export function sql(query: string, readOnly?: boolean): Promise<Record<string, unknown>[]>;
