import { customType } from "drizzle-orm/pg-core";

export const EMBEDDING_DIMENSIONS = 768;

export const vector768 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return `vector(${EMBEDDING_DIMENSIONS})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    const trimmed = value.replace(/^\[|\]$/g, "");
    if (!trimmed) return [];
    return trimmed.split(",").map((part) => Number(part.trim()));
  },
});

export function toPgVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}
