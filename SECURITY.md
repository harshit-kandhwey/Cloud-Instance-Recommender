# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| Latest  | ✅ Yes    |

## Reporting a Vulnerability

This is a **client-side only** static web application. All data processing happens entirely in your browser — no data is sent to any server.

### What to Report

- Vulnerabilities in the HTML/JavaScript that could affect users (e.g., XSS through crafted CSV input)
- Sensitive data exposure in the codebase (API keys, credentials)
- Issues that allow malicious CSV files to execute arbitrary code

### How to Report

Please **do not** open a public issue for security vulnerabilities.

Use GitHub's **Private Vulnerability Reporting** feature:
1. Go to the [Security tab](../../security) of this repository
2. Click **"Report a vulnerability"**
3. Fill in the details

Alternatively, email: **harshitkandhwey@gmail.com** with the subject line `[SECURITY] Cloud Instance Recommender`.

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

| Stage | Timeline |
|-------|----------|
| Acknowledgement | Within 48 hours |
| Status update | Within 7 days |
| Fix / Resolution | Within 30 days (depending on severity) |

### Scope

**In scope:**
- XSS vulnerabilities from CSV parsing
- Data leakage through third-party script injection
- Content Security Policy bypasses

**Out of scope:**
- GitHub Pages infrastructure vulnerabilities (report to GitHub)
- Browser-specific security bugs (report to browser vendors)
- Social engineering attacks
