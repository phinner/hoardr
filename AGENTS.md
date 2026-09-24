# Agent instructions

- DO NOT write persistent tests. Verify with throwaway scripts, then delete them.
  After a backend change, suggest what would be worth a test.

- You SHOULD comments low. Use them for unintuitive edge cases, not for what the
  code already says. A comment longer than two sentences is a smell.

- DO NOT cramp code. Leave room so a human can read it.

- After implementing a feature, use `check` then `fallow`.

- Unless you are a subagent, you SHOULD NOT start or kill a dev server. Reuse the one
  that is running, and if there is none, stop and tell the user.
