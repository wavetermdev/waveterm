# Contributing to Wave Terminal

Wave Terminal is an opinionated project with a single active maintainer. Contributions are welcome, but **alignment matters more than volume**.

This document helps you decide _whether_ and _how_ to contribute in a way that's likely to be accepted, saving both of us time.

## High-level expectations

- Wave has a strong product direction and centralized ownership.
- Review bandwidth is limited.
- Not all contributions can or will be accepted, even if they are technically correct.

This is normal for a solo-maintainer project.

## What makes a great contribution

The following are most likely to be accepted:

- **Bug fixes** - especially with clear reproduction steps
- **Documentation improvements** - typos, clarifications, examples
- **Discussed features** - after alignment in Discord
- **Small, focused changes** - easy to review and low risk

If your change is small and obvious (typo fix, narrowly-scoped bug fix, small docs improvement), you are welcome to open a pull request directly.

## Keep changes focused

**Only change what is necessary to accomplish your stated goal.**

If you're fixing a bug in `file.ts`, do not:

- Reformat other files
- Clean up unrelated code
- Fix style issues in files you didn't need to touch
- Combine multiple unrelated fixes in one PR

Even if these changes are "improvements," they make review harder and require unnecessary back-and-forth. If you want to clean up code, discuss it first and submit it as a separate, focused PR.

**One PR = one logical change.**

## Discuss first (required for larger changes)

For anything beyond a small fix, **discussion is required before opening a pull request**.

This includes:

- New features
- UI/UX changes or changes to default behavior
- Refactors or "cleanup" work
- Performance rewrites
- Architectural changes
- Changes that touch many files or systems

**Where to discuss:** Discord is the preferred place for these conversations -- https://discord.gg/XfvZ334gwU

Pull requests that introduce larger changes without prior discussion will be closed without detailed review.

This is not meant to discourage contribution — it is meant to ensure alignment before significant work is done.

## What this project is not

To set expectations clearly:

- Wave is not designed as a "first open source contribution" project
- We do not currently curate beginner-friendly or mentorship issues
- Large, unsolicited changes are unlikely to be accepted
- Mechanical refactors, broad style changes, or drive-by rewrites are not helpful
- AI-assisted contributions are welcome, but PRs must reflect clear understanding of context, existing patterns, and project direction. Low-effort or poorly supervised changes will be closed.

Being clear about this helps everyone spend their time effectively.

## FAQ

**Q: Should I ask before fixing a typo or obvious bug?**  
A: No, just open a PR for small, obvious fixes.

**Q: I have an idea for a new feature.**  
A: Great! Come discuss it in Discord first. Do not open a PR without prior discussion.

**Q: My PR was closed without detailed feedback.**  
A: This usually means it didn't align with project direction or required more review bandwidth than available. This is normal for a solo-maintained project.

**Q: Can I work on an open issue?**  
A: Comment on the issue first to confirm it's still relevant and that nobody else is working on it. For anything non-trivial, discuss your approach before implementing.

**Q: I noticed some code that could be cleaner while working on my fix.**  
A: Focus on your stated goal. Submit cleanup as a separate PR after discussion, if desired.

## Contributor License Agreement (CLA)

Contributions to this project must be accompanied by a Contributor License Agreement (CLA). You (or your employer) retain the copyright to your contribution; the CLA simply gives us permission to use and redistribute your contributions as part of the project.

On submission of your first pull request, you will be prompted to sign the CLA confirming that you own the intellectual property in your contribution.

**A signed CLA is required before a pull request can be reviewed.** If the CLA is not completed within a reasonable timeframe, the pull request may be closed.

## Style guide

The project uses American English. Please follow existing formatting and style conventions. Use gofmt and prettier where applicable.

## Development setup

To build and run Wave locally, see instructions at [Building Wave Terminal](./BUILD.md).

## Code of Conduct

All contributors are expected to follow the project's [Code of Conduct](./CODE_OF_CONDUCT.md).

---

Thank you for your interest in Wave Terminal. Clear expectations help keep the project moving quickly and sustainably.
