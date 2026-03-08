Principles for agents contributing to this repository.

Keep this file high-level and durable. Avoid coupling instructions to folder names, temporary endpoints, or implementation details that may change.

## Mission

Build a reliable, market-agnostic paper trading platform that:
- simulates trading safely,
- is easy for humans and agents to integrate with through standard APIs,
- stays easy to extend to new markets.

## Product Invariants

1. **Simulation first**
   - Never execute real trades or require private exchange keys for core paper-trading flows.

2. **Market agnostic by default**
   - Core behavior must not depend on one market.
   - Add markets through adapters, not scattered market-specific branching.

3. **Explicit audit trail**
   - State-changing actions must carry rationale.
   - Preserve a readable timeline of what happened and why.

4. **Clear permission boundaries**
   - Keep user and admin operations clearly separated.
   - Authentication must map credentials to identity consistently.

5. **Self-describing integration**
   - Agents should discover capabilities at runtime when possible.
   - Avoid hardcoded client assumptions when discovery can be used.

## Engineering Rules

- Keep domain logic deterministic and testable; isolate network, storage, and framework side effects.
- Prefer composable interfaces and adapters over growing conditionals.
- Favor simple, observable data flow over clever abstractions.
- Be strict at system boundaries: validate external input and keep API errors consistent.
- Prefer the simplest current contract; avoid unnecessary shims, aliases, and duplicate paths unless explicitly requested.
- When behavior changes, update tests and docs in the same change.

## Collaboration Preferences

- Prefer direct engineering judgment over repeated "do you want me to..." prompts.
- Clearly state what is necessary, optional, or unnecessary, with a brief tradeoff when useful.
- Ask follow-up questions only when blocked, when scope/risk materially changes, or when intent cannot be inferred.
- Use readable Conventional Commit messages.
- Prefer multiple focused commits when a task contains distinct logical changes.

## Delegating To Codex

Use `codex exec --full-auto '<task>'` for large, well-scoped implementation tasks.

Rules:
- Treat Codex as starting with no prior context.
- Include exact file paths, required behavior, constraints, and non-goals.
- Preserve the product invariants and current API/error contracts unless the task explicitly says otherwise.
- Do not ask Codex to install new dependencies or change unrelated files unless explicitly required.
- End the prompt with validation steps such as `corepack pnpm test`, `corepack pnpm typecheck`, or narrower package-specific commands.
- Review Codex output before committing.

For longer examples and prompt patterns, read `docs/codex-exec.md`.

## Change Checklist

Before merging, confirm:
- market-agnostic behavior is still preserved,
- auditability is still preserved,
- auth and admin boundaries are still preserved,
- API and error contracts remain consistent,
- tests and docs were updated together when behavior changed.

If any answer is "no" or "unclear", stop and redesign before merging.
