
## Root config is a shared dependency no agent owns (orchestrator, wave 1)

`tsconfig.json` carried `"baseUrl": "."`, copied from the habitual Vite React
template. TypeScript **7.0.2** removed the option outright:

```
tsconfig.json:19:5 - error TS5102: Option 'baseUrl' has been removed.
```

This is a *config-level* error, so `tsc` fails **before reading a single source
file**. Every one of the four parallel agents inherited a typecheck that could
not pass no matter what they wrote, and none of them could fix it, because the
file partitioning that makes parallel work safe had explicitly put root config
outside all of their lanes. One agent diagnosed it and worked around it with a
scoped tsconfig in a temp directory; the cost was paid by all four.

**The mechanism:** file-ownership partitioning protects agents from each other
and leaves a shared root that belongs to nobody. A fault there is invisible in
each agent's local reasoning ("my files are fine") and fatal globally.

**The fix is ordering, not vigilance.** Before launching parallel agents, the
orchestrator runs the full verification command — typecheck, test, build — on a
trivial placeholder and sees it pass. A toolchain proven green on one file stays
green for twenty. Validating `vitest` this way caught nothing because it was
already correct; validating `tsc` would have cost one call and saved four agents
a false signal.

Removing `baseUrl` was sufficient: TS 5+ resolves `paths` relative to the
tsconfig's own directory, so `"@/*": ["./src/*"]` needs no base. Tree went from
"fails before parsing" to **0 errors** across 21 agent-written files.
