/**
 * Same key structure as `T`, with every leaf widened to `string`. Used with `satisfies` in the
 * non-base locales so that a missing or extra key (at any depth) is a compile error (ADR-015).
 */
export type MessageShape<T> = {
  readonly [K in keyof T]: T[K] extends string ? string : MessageShape<T[K]>;
};
