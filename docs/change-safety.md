# ASOC change-safety contract

Every feature change stays inside its named module whenever possible. Changes to
`server.js`, `js/app.js`, `js/player.js`, the two entry HTML files, or a shared
chat module require a matching regression test in the same commit.

Before merging:

1. Start from a clean `main` and create a focused branch.
2. Keep unrelated local files out of the staged diff.
3. Run `npm run verify:scope -- <base-sha>` and the relevant focused suites.
4. Run `npm test` before push.
5. Verify `/api/build` reports the expected commit after deployment.
6. Use Backdoor → Runtime Diagnostics when a command, socket, state update, or
   full-screen effect behaves unexpectedly.
7. Enable Safe Mode to disable optional visual effects without interrupting
   chat, authentication, persistence, or game state.

Critical transactions must not rely on optimistic UI alone. The server persists
first, emits an explicit acknowledgement, and then publishes refreshed state.
Clients reject state revisions older than the newest revision already applied.
