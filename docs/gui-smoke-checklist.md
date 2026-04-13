# GUI Smoke Checklist

Use this checklist for a release-candidate smoke pass of the macOS app.

## App Launch

- [ ] Built `.app` launches from Finder or `open`
- [ ] Window title is correct
- [ ] Russian UI is visible by default
- [ ] App icon appears in the Dock / bundle

## Open / Select Project

- [ ] Project folder chooser opens
- [ ] Selected project is remembered
- [ ] Project root is shown in the Project view
- [ ] `.local-codex/` init works from the GUI

## Sidebar Navigation

- [ ] Sidebar sections are visible
- [ ] Sidebar badges/counts look correct
- [ ] Current section is obvious
- [ ] Navigation does not flicker or blank the detail pane
- [ ] Sidebar subtitles stay compact and do not wrap awkwardly

## Project Status View

- [ ] Current role is visible
- [ ] Current model is visible
- [ ] Current task is visible
- [ ] Approval mode is visible
- [ ] Pending patch state is visible

## Tasks View

- [ ] Task list loads
- [ ] Create task works
- [ ] Select/use task works
- [ ] Archive task works
- [ ] Empty state is clear when there are no tasks

## Roles View

- [ ] Built-in roles are visible
- [ ] Activate role works
- [ ] Inspect role works
- [ ] Empty state is clear when roles are missing

## Prompt Inspector

- [ ] Prompt preview opens
- [ ] Role override field works
- [ ] Task instruction field works
- [ ] Final prompt view is readable

## Patches / Pending Changes

- [ ] Patch status loads
- [ ] Diff panel is readable
- [ ] Apply patch action is visible
- [ ] Reject patch action is visible
- [ ] Validation status is shown clearly

## Extensions / Registry

- [ ] Installed extensions load
- [ ] Registry catalog loads
- [ ] Raw GitHub warning is visible
- [ ] Reviewed / trusted status is distinguishable
- [ ] Install, inspect, enable, disable, update, remove actions are visible

## Settings / Localization

- [ ] Settings view opens
- [ ] Language selector is visible
- [ ] Russian labels are used by default
- [ ] Engine root hint is readable
- [ ] About section is clear

## Session Panel

- [ ] Session panel opens
- [ ] Input field is visible
- [ ] Output area is readable
- [ ] Current model / role / task are visible
- [ ] Start / stop actions are visible

## Empty States

- [ ] Tasks empty state is understandable
- [ ] Extensions empty state is understandable
- [ ] Registry empty state is understandable
- [ ] Prompt / patch empty states are not confusing
- [ ] Empty states include a clear next action when appropriate

## Russian-First Labels / Messages

- [ ] Sidebar labels are Russian-first
- [ ] Buttons are Russian-first
- [ ] Errors are Russian-first
- [ ] Registry and extension trust labels are Russian-first

## Error / Warning States

- [ ] Missing project produces a clear warning
- [ ] Missing task or extension produces a clear warning
- [ ] Less-trusted raw GitHub install warning is visible
- [ ] Registry trust/review warnings are visible

## Notes

- Build version:
- Tester:
- Date / time:
- Environment:
- Overall result:
