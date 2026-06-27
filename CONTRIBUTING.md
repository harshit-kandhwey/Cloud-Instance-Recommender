# Contributing to Cloud Instance Recommender

Thank you for your interest in contributing! This document explains how to get involved.

## Ways to Contribute

- **Bug reports** — Found something broken? Open an issue using the bug report template.
- **Feature requests** — Have an idea? Open an issue using the feature request template.
- **Data updates** — Cloud instance data changes with new generation releases. PRs to refresh instance data are welcome.
- **UI/UX improvements** — Suggest or implement better user experience.
- **Documentation** — Improve the README, user guide, or inline code comments.

## Getting Started

This is a **pure static website** — no build tools, no npm, no compilation.

```bash
git clone https://github.com/harshit-kandhwey/Cloud-Instance-Recommender.git
cd Cloud-Instance-Recommender
# Open any HTML file directly in a browser, or serve with:
python -m http.server 8080
# Then visit http://localhost:8080
```

## Project Structure

```
├── index.html              # Landing page
├── aws.html                # AWS recommender
├── azure.html              # Azure recommender
├── gcp.html                # GCP recommender
├── multicloud.html         # Multi-cloud comparison
├── user-guide.html         # Interactive user guide
├── user-guide.pdf          # PDF user guide
│
├── css/
│   ├── style.css           # Main styles
│   └── index_style.css     # Landing page styles
│
└── js/
    ├── base/               # Shared logic
    │   ├── base-instance-selector.js
    │   ├── instance-selector-factory.js
    │   ├── optimized_file_handler.js
    │   └── main-script.js
    ├── aws/                # AWS-specific selector, data, and UI
    ├── azure/              # Azure-specific selector, data, and UI
    └── gcp/                # GCP-specific selector, data, and UI
```

## Updating Instance Data

Instance data files (`aws-data.js`, `azure-data.js`, `gcp-data.js`) are auto-generated from provider APIs — do not edit them manually.

To refresh the data:

1. Download the latest instance JSON from the relevant provider APIs
2. Run the PowerShell generation scripts (documented in the internal wiki)
3. Verify the output with spot-checks on known instance types before submitting a PR

## Pull Request Guidelines

1. **Fork** the repository and create a branch from `main`
2. **Describe** what you changed and why in the PR description
3. **Test** your changes in Chrome, Firefox, and Edge (no unit test suite — test the full flow with a sample CSV)
4. **Keep PRs focused** — one logical change per PR
5. **Do not** commit generated data files unless you are refreshing instance data

## Code Style

- Plain HTML5, CSS3, and vanilla JavaScript (ES6+)
- No frameworks, no build steps, no npm
- Keep functions small and focused
- Prefer `const` over `let`; avoid `var`
- Use descriptive variable names
- No comments explaining _what_ the code does — only add a comment when the _why_ is non-obvious

## CSV Format (v3.0)

The accepted input format includes these optional columns added in v3.0:
`ENV`, `OS`, `Workload`, `Compliance`, `Min Gen`

Any sample CSV templates in the repo or in the HTML `<pre>` previews should include all columns.

## Reporting Bugs

Please use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.yml). Include:

- Browser and OS
- Steps to reproduce
- What you expected vs. what happened
- A sample CSV if relevant (anonymize sensitive data)

## Questions?

Open a [Discussion](../../discussions) or reach out at harshitkandhwey@gmail.com.
