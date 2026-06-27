# Contributing to Cloud Instance Recommender

Thank you for your interest in contributing! This document explains how to get involved.

## Ways to Contribute

- **Bug reports** — Found something broken? Open an issue using the bug report template.
- **Feature requests** — Have an idea? Open an issue using the feature request template.
- **Data updates** — Cloud pricing changes frequently. PRs to refresh instance data are welcome.
- **UI/UX improvements** — Suggest or implement better user experience.
- **Documentation** — Improve the README, user guide, or inline code comments.

## Getting Started

This is a **pure static website** — no build tools or npm required.

```bash
git clone https://github.com/YOUR_USERNAME/Cloud-Instance-Recommender.git
cd Cloud-Instance-Recommender
# Open any HTML file directly in a browser, or use a local server:
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
├── css/
│   ├── style.css           # Main styles
│   └── index_style.css     # Landing page styles
└── js/
    ├── base/               # Shared logic (main-script, base-selector, factory)
    ├── aws/                # AWS-specific selector, data, and UI
    ├── azure/              # Azure-specific selector, data, and UI
    └── gcp/                # GCP-specific selector, data, and UI
```

## Updating Instance Data

Instance pricing data comes from [instances.vantage.sh](https://instances.vantage.sh). The data files are auto-generated — do not edit them manually.

To refresh the data:
1. Download the latest JSON from vantage.sh APIs
2. Run the PowerShell generation scripts (documented in the internal wiki)
3. Verify the output with spot checks before submitting a PR

## Pull Request Guidelines

1. **Fork** the repository and create a branch from `main`
2. **Describe** what you changed and why in the PR description
3. **Test** your changes in Chrome, Firefox, and Edge (it's a static site — no unit tests currently)
4. **Keep PRs focused** — one logical change per PR
5. **Do not** commit generated data files unless you are refreshing pricing data

## Code Style

- Plain HTML5, CSS3, and vanilla JavaScript (ES6+)
- No frameworks, no build steps, no npm
- Keep functions small and focused
- Prefer `const` over `let`; avoid `var`
- Use descriptive variable names

## Reporting Bugs

Please use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.yml). Include:
- Browser and OS
- Steps to reproduce
- What you expected vs. what happened
- A sample CSV if relevant (anonymize sensitive data)

## Questions?

Open a [Discussion](../../discussions) or reach out at harshitkandhwey@gmail.com.
