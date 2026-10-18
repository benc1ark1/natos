# Known issues

Tests that were already failing before a change. Not investigated (speed rules in CLAUDE.md).

- **12 Oct 2026** · `tests/build-o-chat.test.mjs` "O3: plan my week…" and `tests/jarvis-d2-chat.test.mjs` "plan my week: gym sessions placed…": expect `📚 Physics homework` on the Your week card, but the card says "Didn't fit: Physics homework (Mon)". Already failing before the school-as-one-line change (8368fe4); seems to depend on today's date.
- **13 Oct 2026** · `tests/build-n-chat.test.mjs` "N: when’s best for upper body and Owen lower/plyo?" (expects 🔴 Sat high · Match in the load view) and "N: his week typed out is read…" (gets "I couldn’t find days and times in that."): already failing before the planner + maths build; seem to depend on today's date.
- The two Your week "Physics homework" tests above pass again as of 13 Oct.
