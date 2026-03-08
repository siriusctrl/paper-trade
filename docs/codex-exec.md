# Delegating Work To Codex

Use `codex exec` when the task is concrete enough to hand off but large enough that parallel implementation or a mechanical pass is worth it.

## Good Fits

Use Codex when:
- the change is well scoped,
- the files to touch are already known,
- the behavior change is concrete,
- validation can be stated clearly.

Avoid delegation when:
- the task is mostly architectural exploration,
- the change is tiny and faster to do directly,
- the change is highly coupled to evolving local context that is hard to restate.

## Prompt Checklist

A good `codex exec` prompt should include:
- the exact files or packages to modify,
- the desired behavior,
- constraints and non-goals,
- any invariants that must not be broken,
- the validation commands to run at the end.

Assume Codex has no prior context unless you explicitly provide it.

## Recommended Template

```bash
codex exec --full-auto 'Update <files> to <behavior>.

Constraints:
- preserve current API response formats unless explicitly noted
- do not add new dependencies
- do not modify unrelated files
- keep market-agnostic behavior
- keep auth/admin boundaries intact

Validation:
- corepack pnpm typecheck
- corepack pnpm --filter <package> test
'
```

## Repository-Specific Guidance

When delegating in this repo:
- name the exact packages to touch,
- call out whether docs must be updated in the same change,
- mention whether changes affect user routes, admin routes, adapters, or core trading rules,
- specify whether backward-compatibility shims are unwanted,
- prefer package-specific validation when the scope is narrow.

## Example: Focused API Change

```bash
codex exec --full-auto 'In `packages/api/src/routes/markets.ts` and related tests, add support for returning a `priceHistory` discovery descriptor from `GET /api/markets`.

Constraints:
- preserve existing auth behavior
- preserve current error shapes
- do not add new dependencies
- update docs if the response contract changes
- do not touch unrelated frontend files

Validation:
- corepack pnpm --filter @unimarket/api test
- corepack pnpm --filter @unimarket/api typecheck
'
```

## Example: Multi-Package Change

```bash
codex exec --full-auto 'Implement agent-facing historical price reads for supported markets.

Modify only:
- `packages/core`
- `packages/markets`
- `packages/api`
- related docs/tests

Requirements:
- keep the system market-agnostic
- expose a consistent REST contract
- validate inputs strictly
- update docs and tests in the same change
- do not add new dependencies

Validation:
- corepack pnpm --filter @unimarket/core test
- corepack pnpm --filter @unimarket/markets test
- corepack pnpm --filter @unimarket/api test
- corepack pnpm typecheck
'
```
