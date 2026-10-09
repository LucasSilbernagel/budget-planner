// Core restates db enums as runtime tuples (it takes only types from @budget-planner/db); this pins both directions.
export type SameMembers<A, B> = [Exclude<A, B>, Exclude<B, A>] extends [never, never] ? true : never
