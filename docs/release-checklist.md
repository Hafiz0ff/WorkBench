# Release Checklist

Use this checklist before shipping a macOS build.

## Versioning
- Bump the version in `package.json`.
- Confirm the same version is reflected in the app bundle metadata and release notes.
- Update `CHANGELOG.md` with the release summary.

## Validation
- Run `npm test`.
- Run `cd macos/LocalCodexMac && swift test`.
- Run CLI smoke checks:
  - `node ./src/cli.js project status`
  - `node ./src/cli.js extensions doctor`
  - `node ./src/cli.js registry doctor`
- Run GUI smoke checks:
  - open the built `.app`
  - verify project, tasks, roles, extensions, registry, prompt, patch, policy, session, and settings views

## Packaging
- Build the `.app` bundle.
- Create the DMG artifact.
- Verify the artifact names and locations in `dist/macos/`.

## Signing
- Run `scripts/sign_macos_app.sh`.
- Confirm the app bundle is signed with the expected Developer ID.
- Keep signing credentials outside the repository.

## Notarization
- Run `scripts/notarize_macos_app.sh`.
- Staple the app bundle with `scripts/staple_macos_app.sh`.
- Validate the stapled app with `scripts/validate_notarized_app.sh`.

## Gatekeeper / Distribution Validation
- Test on a clean machine or clean user account if possible.
- Verify the app launches from Finder after quarantine is removed by the OS.
- Run `spctl --assess --type execute --verbose=4` on the final bundle.

## Extensions
- Run `node ./src/cli.js registry refresh`.
- Run `node ./src/cli.js registry doctor`.
- Confirm raw GitHub installs remain visibly less trusted than registry installs.
- Confirm disabled extensions stay disabled until manually enabled.

## Review
- Read the release notes.
- Review README installation steps and helper instructions.
- Confirm the helper install path and uninstall instructions are current.
