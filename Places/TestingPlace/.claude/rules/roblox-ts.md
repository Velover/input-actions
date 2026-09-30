---
paths:
  - "src/**/*.{ts,tsx}"
---

# roblox-ts differences that bite

- **Sorting:** the comparator returns a boolean meaning "a goes first", as Luau's `table.sort`
  does, not a number: `list.sort((a, b) => a < b)`.
- **No `splice`, `reverse`, `slice` or `concat` on arrays.** Use `array.remove(index)`,
  `array.insert(index, value)` and `push`, or build a new array: walk backwards to reverse, copy a
  range with `array.move(from, to, 0, [])` (0-based, `to` included), and join with `[...a, ...b]`.
- **Characters by index:** strings are Luau strings. For the character at 0-based `index`, use
  `str.sub(index + 1, index + 1)`.
- **No `Object.keys`, `Object.values` or `Object.entries`:**
  - for a Map, `[...map]` gives the entries, and `.map(([key, value]) => value)` or
    `.map(([key]) => key)` gives the values or keys;
  - for a plain object, use `for (const [key, value] of pairs(obj))`.
- **No `null`:** use `undefined`.
- **No using `any`:** a value typed `any` can be stored and passed on, but calling it, indexing it
  or using it with an operator is a compile error. Type it `unknown` and narrow it with `typeIs`.
- **No `undefined` inside arrays:** it leaves a hole in the Luau table, and an `Array<T | undefined>`
  cannot call `push`, `forEach`, `map`, `join`, `sort` or most other methods (they require
  `Array<defined>`). Keep every element defined, use a Map, or drop the holes with
  `filterUndefined()`.
