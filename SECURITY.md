# Security Policy

## Reporting a vulnerability

Please do not disclose exploitable vulnerabilities in a public issue.

Use GitHub's private vulnerability reporting for this repository. Include the affected version, impact, reproduction steps, and any suggested mitigation. If private reporting is unavailable, open a public issue containing no exploit details and ask the maintainer for a private contact channel.

## Supported versions

Security fixes are provided for the latest stable release. Users should run a versioned container image instead of an unpinned development build and should keep `ACS_AUTH_SECRET` private.

## Deployment guidance

- Restrict ports `55210` and `55211` to trusted networks whenever possible.
- Use a unique random `ACS_AUTH_SECRET` for each deployment.
- Back up the `data` directory before upgrading.
- Verify release files against `SHA256SUMS.txt`.
