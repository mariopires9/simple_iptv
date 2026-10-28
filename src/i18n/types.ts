/**
 * Same key structure as `T`, with every string leaf widened to `string` and every message
 * function (interpolation, e.g. `(id: string) => string`) kept with the same parameters. Used
 * with `satisfies` in the non-base locales so that a missing or extra key (at any depth) is a
 * compile error (ADR-015).
 */
export type MessageShape<T> = {
  readonly [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends (...args: infer A) => string
      ? (...args: A) => string
      : MessageShape<T[K]>;
};
