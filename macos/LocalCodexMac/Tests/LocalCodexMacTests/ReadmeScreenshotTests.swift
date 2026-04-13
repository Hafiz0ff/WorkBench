import AppKit
import Foundation
import SwiftUI
import XCTest
@testable import LocalCodexMac

private actor ScreenshotMockRunner: CLICommandRunning {
    private(set) var calls: [[String]] = []

    func runCLI(arguments: [String], currentDirectory: URL?, environment: [String : String]) async throws -> EngineCommandResult {
        calls.append(arguments)
        let stdout: String
        if arguments.first == "prompt", arguments.dropFirst().first == "inspect" {
            stdout = """
            === Base System Instructions ===
            Keep responses concise, specific, and reviewable.

            === Role Profile ===
            Senior engineer: minimal diffs, safe refactors, explicit tradeoffs.

            === Project Memory ===
            Project overview loaded from .local-codex.

            === Task Context ===
            Review the demo project structure and identify the first implementation entry point.
            """
        } else {
            stdout = ""
        }

        return EngineCommandResult(
            command: "node",
            arguments: arguments,
            exitCode: 0,
            stdout: stdout,
            stderr: ""
        )
    }
}

@MainActor
final class ReadmeScreenshotTests: XCTestCase {
    func testGenerateReadmeScreenshots() async throws {
        guard ProcessInfo.processInfo.environment["GENERATE_README_SCREENSHOTS"] == "1" else {
            throw XCTSkip("Set GENERATE_README_SCREENSHOTS=1 to generate README screenshots.")
        }

        let repoRoot = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let outputRoot = repoRoot.appendingPathComponent("docs/screenshots", isDirectory: true)
        try FileManager.default.createDirectory(at: outputRoot, withIntermediateDirectories: true)

        let demoRoot = FileManager.default.temporaryDirectory.appendingPathComponent("WorkbenchReadmeDemo-\(UUID().uuidString)", isDirectory: true)
        try createDemoWorkspace(at: demoRoot)

        let runner = ScreenshotMockRunner()
        let store = WorkspaceStore(
            engineBridge: EngineBridge(engineRoot: demoRoot),
            commandRunner: runner,
            selectedProjectRoot: demoRoot
        )
        await store.openProjectRoot(demoRoot)
        await store.refreshSnapshot()
        store.selectedSection = .project
        store.selectedTaskId = store.snapshot?.state?.currentTaskId
        store.selectedRoleName = store.snapshot?.state?.activeRole
        store.selectedRegistryId = store.snapshot?.registryCatalog?.entries?.first?.id
        store.selectedExtensionId = store.snapshot?.extensions?.extensions?.first?.id

        try renderScreenshot(
            ContentView()
                .environmentObject(store)
                .environmentObject(store.localeStore)
                .environment(\.colorScheme, .light),
            size: CGSize(width: 1440, height: 980),
            output: outputRoot.appendingPathComponent("01-project-ready.png")
        )

        store.selectedSection = .tasks
        try renderScreenshot(
            ContentView()
                .environmentObject(store)
                .environmentObject(store.localeStore)
                .environment(\.colorScheme, .light),
            size: CGSize(width: 1440, height: 980),
            output: outputRoot.appendingPathComponent("02-tasks.png")
        )

        store.selectedSection = .roles
        try renderScreenshot(
            ContentView()
                .environmentObject(store)
                .environmentObject(store.localeStore)
                .environment(\.colorScheme, .light),
            size: CGSize(width: 1440, height: 980),
            output: outputRoot.appendingPathComponent("03-roles.png")
        )

        store.selectedSection = .extensions
        try renderScreenshot(
            ContentView()
                .environmentObject(store)
                .environmentObject(store.localeStore)
                .environment(\.colorScheme, .light),
            size: CGSize(width: 1440, height: 980),
            output: outputRoot.appendingPathComponent("04-extensions.png")
        )

        store.selectedSection = .registry
        try renderScreenshot(
            ContentView()
                .environmentObject(store)
                .environmentObject(store.localeStore)
                .environment(\.colorScheme, .light),
            size: CGSize(width: 1440, height: 980),
            output: outputRoot.appendingPathComponent("05-registry.png")
        )

        store.selectedSection = .prompt
        store.promptRoleOverride = "senior-engineer"
        store.promptInstruction = "Review the demo project structure and identify the first implementation entry point."
        store.console = []
        store.sessionOutputText = ""
        await store.inspectPrompt()
        try renderScreenshot(
            ContentView()
                .environmentObject(store)
                .environmentObject(store.localeStore)
                .environment(\.colorScheme, .light),
            size: CGSize(width: 1440, height: 980),
            output: outputRoot.appendingPathComponent("06-prompt.png")
        )

        store.selectedSection = .patches
        try renderScreenshot(
            ContentView()
                .environmentObject(store)
                .environmentObject(store.localeStore)
                .environment(\.colorScheme, .light),
            size: CGSize(width: 1440, height: 980),
            output: outputRoot.appendingPathComponent("07-patches.png")
        )

        store.selectedSection = .policy
        try renderScreenshot(
            ContentView()
                .environmentObject(store)
                .environmentObject(store.localeStore)
                .environment(\.colorScheme, .light),
            size: CGSize(width: 1440, height: 980),
            output: outputRoot.appendingPathComponent("08-policy.png")
        )

        store.selectedSection = .session
        store.sessionInput = "Audit the landing state and summarize next actions."
        store.sessionIsRunning = true
        store.sessionProcessStatus = "Mock session active"
        store.sessionOutputText = """
        > app prompt inspect
        === Base System Instructions ===
        Keep responses concise, specific, and reviewable.

        === Task Context ===
        Review the demo project structure and identify the first implementation entry point.
        """
        try renderScreenshot(
            ContentView()
                .environmentObject(store)
                .environmentObject(store.localeStore)
                .environment(\.colorScheme, .light),
            size: CGSize(width: 1440, height: 980),
            output: outputRoot.appendingPathComponent("09-session.png")
        )

        store.selectedSection = .settings
        try renderScreenshot(
            ContentView()
                .environmentObject(store)
                .environmentObject(store.localeStore)
                .environment(\.colorScheme, .light),
            size: CGSize(width: 1440, height: 980),
            output: outputRoot.appendingPathComponent("10-settings.png")
        )
    }

    private func createDemoWorkspace(at root: URL) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: root, withIntermediateDirectories: true)

        let sourceFiles: [(String, String)] = [
            ("README.md", "# Workbench Demo\n\nDemo workspace used to generate README screenshots for Workbench.\n"),
            ("package.json", """
            {
              "name": "workbench-demo",
              "private": true,
              "type": "module",
              "description": "Demo project for Workbench screenshots",
              "scripts": {
                "test": "echo 'demo'"
              }
            }
            """),
            ("src/index.ts", "export const entryPoint = \"index.ts\";\n"),
            ("src/app.ts", "export const appName = \"Workbench Demo\";\n"),
            ("src/auth.ts", "export const authMode = \"local\";\n"),
            ("tests/app.test.ts", """
            describe("demo", () => {
              it("is a demo workspace", () => {
                expect(true).toBe(true);
              });
            });
            """),
        ]

        for (relativePath, content) in sourceFiles {
            let url = root.appendingPathComponent(relativePath)
            try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try content.write(to: url, atomically: true, encoding: .utf8)
        }

        try createLocalCodexWorkspace(at: root)
        try createRoles(at: root)
        try createTasks(at: root)
        try createPolicy(at: root)
        try createPendingPatch(at: root)
        try createExtensions(at: root)
        try createRegistryCatalog(at: root)
    }

    private func createLocalCodexWorkspace(at root: URL) throws {
        let codexRoot = root.appendingPathComponent(".local-codex", isDirectory: true)
        try FileManager.default.createDirectory(at: codexRoot, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: codexRoot.appendingPathComponent("extensions", isDirectory: true), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: codexRoot.appendingPathComponent("tasks", isDirectory: true), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: codexRoot.appendingPathComponent("prompts/roles", isDirectory: true), withIntermediateDirectories: true)
        for name in [
            "project_overview.md",
            "architecture_notes.md",
            "decisions_log.md"
        ] {
            let url = codexRoot.appendingPathComponent(name)
            try "# Demo\n".write(to: url, atomically: true, encoding: .utf8)
        }
        try FileManager.default.createDirectory(at: codexRoot.appendingPathComponent("module_summaries", isDirectory: true), withIntermediateDirectories: true)
    }

    private func createRoles(at root: URL) throws {
        let rolesRoot = root
            .appendingPathComponent(".local-codex", isDirectory: true)
            .appendingPathComponent("prompts", isDirectory: true)
            .appendingPathComponent("roles", isDirectory: true)
        try FileManager.default.createDirectory(at: rolesRoot, withIntermediateDirectories: true)

        let roleData: [(String, String)] = [
            ("senior-engineer", "Practical engineering role."),
            ("software-architect", "Designs boundaries and migration paths."),
            ("code-reviewer", "Focuses on correctness and risk."),
            ("debugging-expert", "Narrows issues with evidence."),
            ("designer", "Improves UX clarity and hierarchy."),
            ("product-manager", "Slices work into outcomes."),
            ("frontend-engineer", "Builds polished UI surfaces."),
            ("backend-engineer", "Owns server-side logic and data flow."),
            ("test-engineer", "Creates strong validation coverage."),
            ("performance-optimizer", "Finds bottlenecks and reduces overhead."),
            ("refactoring-strategist", "Improves structure without changing behavior."),
            ("release-engineer", "Prepares stable shipping builds."),
            ("api-designer", "Shapes API contracts and payloads."),
            ("migration-engineer", "Moves data and code safely across versions."),
            ("qa-analyst", "Checks behavior against acceptance criteria."),
            ("bug-hunter", "Tracks failures to root cause."),
            ("devops-engineer", "Helps with delivery and infrastructure."),
            ("security-reviewer", "Looks for security and trust gaps."),
            ("documentation-engineer", "Keeps public docs crisp and current."),
            ("integration-engineer", "Connects components without surprises.")
        ]

        for (name, description) in roleData {
            let content = """
            ---
            name: \(name)
            description: \(description)
            goals:
              - Keep the demo sharp.
            behavioral rules:
              - Be concise.
            tool usage guidance:
              - Prefer safe local actions.
            output style:
              - Clear and practical.
            do/don't rules:
              - Do keep changes reviewable.
            ---

            \(description)
            """
            try content.write(to: rolesRoot.appendingPathComponent("\(name).md"), atomically: true, encoding: .utf8)
        }
    }

    private func createTasks(at root: URL) throws {
        let tasksRoot = root
            .appendingPathComponent(".local-codex", isDirectory: true)
            .appendingPathComponent("tasks", isDirectory: true)
        try FileManager.default.createDirectory(at: tasksRoot, withIntermediateDirectories: true)

        let json = """
        {
          "schemaVersion": 1,
          "createdAt": "2026-04-13T00:00:00.000Z",
          "updatedAt": "2026-04-13T00:00:00.000Z",
          "currentTaskId": "task-frontend",
          "tasks": [
            {
              "id": "task-frontend",
              "title": "Landing polish",
              "slug": "landing-polish",
              "status": "in_progress",
              "createdAt": "2026-04-13T00:00:00.000Z",
              "updatedAt": "2026-04-13T00:00:00.000Z",
              "role": "senior-engineer",
              "model": "qwen2.5-coder:14b",
              "summary": "Refine the landing state and composer flow.",
              "userRequest": "Polish the project landing experience.",
              "relevantFiles": ["macos/LocalCodexMac/Sources/LocalCodexMac/Sections.swift"],
              "lastRunNotes": [
                {
                  "kind": "finding",
                  "source": "assistant",
                  "text": "Composer should autofocus after project load.",
                  "createdAt": "2026-04-13T00:00:00.000Z"
                }
              ],
              "location": "active",
              "folder": "active/task-frontend"
            },
            {
              "id": "task-backend",
              "title": "API contract audit",
              "slug": "api-contract-audit",
              "status": "planned",
              "createdAt": "2026-04-13T00:00:00.000Z",
              "updatedAt": "2026-04-13T00:00:00.000Z",
              "role": "backend-engineer",
              "model": "qwen2.5-coder:14b",
              "summary": "Check payloads, boundaries, and error states.",
              "userRequest": "Audit the API contract for edge cases.",
              "relevantFiles": ["src/api.ts", "src/server.ts"],
              "lastRunNotes": [],
              "location": "active",
              "folder": "active/task-backend"
            },
            {
              "id": "task-release",
              "title": "Prepare release notes",
              "slug": "prepare-release-notes",
              "status": "draft",
              "createdAt": "2026-04-13T00:00:00.000Z",
              "updatedAt": "2026-04-13T00:00:00.000Z",
              "role": "product-manager",
              "model": "qwen2.5-coder:14b",
              "summary": "Write concise release notes and screenshots.",
              "userRequest": "Prepare public release notes and visuals.",
              "relevantFiles": ["CHANGELOG.md", "README.md"],
              "lastRunNotes": [],
              "location": "active",
              "folder": "active/task-release"
            }
          ]
        }
        """
        try json.write(to: tasksRoot.appendingPathComponent("index.json"), atomically: true, encoding: .utf8)
    }

    private func createPolicy(at root: URL) throws {
        let json = """
        {
          "schemaVersion": 1,
          "approvalMode": "on-request",
          "allowedReadGlobs": ["src/**", "tests/**", "README.md", ".local-codex/**"],
          "allowedWriteGlobs": ["src/**", "tests/**", "README.md", ".local-codex/**"],
          "blockedPaths": ["node_modules/**", ".git/**"],
          "allowedCommands": ["git status", "npm test", "swift test"],
          "blockedCommands": ["rm -rf /", "curl | sh"],
          "requireApprovalFor": {
            "commands": ["npm install", "git push"],
            "categories": ["network", "destructive"]
          },
          "maxCommandOutputChars": 12000
        }
        """
        let url = root.appendingPathComponent(".local-codex/policy.json")
        try json.write(to: url, atomically: true, encoding: .utf8)
    }

    private func createPendingPatch(at root: URL) throws {
        let patchRoot = root.appendingPathComponent(".local-codex/patches/patch-demo-1", isDirectory: true)
        try FileManager.default.createDirectory(at: patchRoot, withIntermediateDirectories: true)
        let json = """
        {
          "schemaVersion": 1,
          "patchId": "patch-demo-1",
          "taskId": "task-frontend",
          "role": "senior-engineer",
          "model": "qwen2.5-coder:14b",
          "createdAt": "2026-04-13T00:00:00.000Z",
          "updatedAt": "2026-04-13T00:00:00.000Z",
          "status": "pending",
          "approvalMode": "on-request",
          "approvalStatus": "pending",
          "validationStatus": "pending",
          "summary": "Improve landing copy and align composer spacing.",
          "affectedFiles": [
            {
              "path": "macos/LocalCodexMac/Sources/LocalCodexMac/Sections.swift",
              "action": "update",
              "approval": "pending"
            },
            {
              "path": "README.md",
              "action": "update",
              "approval": "pending"
            }
          ],
          "validationCommands": [
            {
              "command": "npm test",
              "args": [],
              "timeoutMs": 120000
            }
          ],
          "validationResults": [],
          "changes": [
            {
              "path": "macos/LocalCodexMac/Sources/LocalCodexMac/Sections.swift",
              "action": "update",
              "beforeContent": "Text(\\"Old copy\\")",
              "afterContent": "Text(\\"New copy\\")",
              "diffText": "--- a/Sections.swift\\n+++ b/Sections.swift\\n@@\\n- Text(\\"Old copy\\")\\n+ Text(\\"New copy\\")"
            }
          ],
          "diffPath": ".local-codex/patches/patch-demo-1/diff.txt",
          "patchPath": ".local-codex/patches/patch-demo-1/patch.json",
          "diffText": "--- a/Sections.swift\\n+++ b/Sections.swift\\n@@\\n- Text(\\"Old copy\\")\\n+ Text(\\"New copy\\")"
        }
        """
        try json.write(to: root.appendingPathComponent(".local-codex/pending-change.json"), atomically: true, encoding: .utf8)
        try "Demo patch diff".write(to: patchRoot.appendingPathComponent("diff.txt"), atomically: true, encoding: .utf8)
        try "Demo patch json".write(to: patchRoot.appendingPathComponent("patch.json"), atomically: true, encoding: .utf8)
    }

    private func createExtensions(at root: URL) throws {
        let json = """
        {
          "schemaVersion": 1,
          "createdAt": "2026-04-13T00:00:00.000Z",
          "updatedAt": "2026-04-13T00:00:00.000Z",
          "extensions": [
            {
              "id": "workbench.core-prompt-pack",
              "name": "Workbench Core Prompt Pack",
              "version": "1.0.0",
              "type": "skill",
              "author": "Workbench",
              "description": "Core prompt instructions for local development workflows.",
              "source": {
                "kind": "github",
                "owner": "Hafiz0ff",
                "repo": "workbench-core-prompt-pack",
                "ref": "main"
              },
              "manifestPath": ".local-codex/extensions/installed/workbench.core-prompt-pack/localcodex-extension.json",
              "installPath": ".local-codex/extensions/installed/workbench.core-prompt-pack",
              "entryPaths": ["prompts/core.md"],
              "capabilities": ["adds prompts"],
              "compatibility": {
                "app": ">=1.0.0",
                "schema": "1"
              },
              "localization": {
                "supportedLocales": ["en", "ru"],
                "defaultLocale": "en"
              },
              "publisher": "Workbench",
              "reviewStatus": "reviewed",
              "verifiedSource": true,
              "supportedAppVersions": [">=1.0.0"],
              "signature": "demo-signature",
              "lastCheckedAt": "2026-04-13T00:00:00.000Z",
              "trustLevel": "reviewed",
              "recommended": true,
              "registrySourceId": "workbench-curated",
              "registrySourceLabel": "Workbench Curated Registry",
              "registrySourceLocation": "extensions-registry.json",
              "registryEntryId": "workbench.core-prompt-pack",
              "installSourceType": "registry",
              "enabled": true,
              "status": "active",
              "warnings": [],
              "installedAt": "2026-04-13T00:00:00.000Z",
              "updatedAt": "2026-04-13T00:00:00.000Z",
              "lastValidatedAt": "2026-04-13T00:00:00.000Z"
            }
          ]
        }
        """
        let url = root.appendingPathComponent(".local-codex/extensions/registry.json")
        try json.write(to: url, atomically: true, encoding: .utf8)
    }

    private func createRegistryCatalog(at root: URL) throws {
        let json = """
        {
          "schemaVersion": 1,
          "createdAt": "2026-04-13T00:00:00.000Z",
          "updatedAt": "2026-04-13T00:00:00.000Z",
          "sources": [
            {
              "id": "workbench-curated",
              "location": "extensions-registry.json",
              "kind": "file",
              "label": "Workbench Curated Registry",
              "publisher": "Workbench",
              "reviewStatus": "reviewed",
              "verifiedSource": true,
              "trustLevel": "reviewed",
              "description": "Curated sample registry for README screenshots.",
              "enabled": true,
              "addedAt": "2026-04-13T00:00:00.000Z",
              "updatedAt": "2026-04-13T00:00:00.000Z",
              "lastCheckedAt": "2026-04-13T00:00:00.000Z",
              "entryCount": 3,
              "notes": "Demo registry source"
            }
          ],
          "entries": [
            {
              "id": "workbench.core-prompt-pack",
              "name": "Workbench Core Prompt Pack",
              "version": "1.0.0",
              "type": "skill",
              "author": "Workbench",
              "description": "Core prompt instructions for local development workflows.",
              "source": {
                "kind": "github",
                "owner": "Hafiz0ff",
                "repo": "workbench-core-prompt-pack",
                "ref": "main"
              },
              "manifestPath": ".local-codex/extensions/installed/workbench.core-prompt-pack/localcodex-extension.json",
              "entryPaths": ["prompts/core.md"],
              "capabilities": ["adds prompts"],
              "compatibility": {
                "app": ">=1.0.0",
                "schema": "1"
              },
              "installNotes": "Recommended for all local projects.",
              "publisher": "Workbench",
              "reviewStatus": "reviewed",
              "verifiedSource": true,
              "supportedAppVersions": [">=1.0.0"],
              "signature": "demo-signature",
              "trustLevel": "reviewed",
              "recommended": true,
              "lastCheckedAt": "2026-04-13T00:00:00.000Z",
              "validationStatus": "ok",
              "validationIssues": [],
              "registrySourceId": "workbench-curated",
              "registrySourceLabel": "Workbench Curated Registry",
              "registrySourceLocation": "extensions-registry.json",
              "registrySourceEnabled": true,
              "registryEntryId": "workbench.core-prompt-pack"
            },
            {
              "id": "workbench.role-pack.ui",
              "name": "Workbench UI Role Pack",
              "version": "0.9.0",
              "type": "role-pack",
              "author": "Workbench",
              "description": "Useful design and UI thinking roles for interface work.",
              "source": {
                "kind": "github",
                "owner": "Hafiz0ff",
                "repo": "workbench-ui-role-pack",
                "ref": "main"
              },
              "manifestPath": ".local-codex/extensions/installed/workbench.role-pack.ui/localcodex-extension.json",
              "entryPaths": ["prompts/roles"],
              "capabilities": ["adds roles"],
              "compatibility": {
                "app": ">=1.0.0",
                "schema": "1"
              },
              "installNotes": "Good for UI-heavy projects.",
              "publisher": "Workbench",
              "reviewStatus": "reviewed",
              "verifiedSource": true,
              "supportedAppVersions": [">=1.0.0"],
              "signature": "demo-signature",
              "trustLevel": "reviewed",
              "recommended": false,
              "lastCheckedAt": "2026-04-13T00:00:00.000Z",
              "validationStatus": "ok",
              "validationIssues": [],
              "registrySourceId": "workbench-curated",
              "registrySourceLabel": "Workbench Curated Registry",
              "registrySourceLocation": "extensions-registry.json",
              "registrySourceEnabled": true,
              "registryEntryId": "workbench.role-pack.ui"
            },
            {
              "id": "workbench.mcp.connector.demo",
              "name": "Demo MCP Connector Descriptor",
              "version": "0.1.0",
              "type": "mcp-connector",
              "author": "Workbench",
              "description": "Descriptor only; no executable behavior in this stage.",
              "source": {
                "kind": "github",
                "owner": "Hafiz0ff",
                "repo": "workbench-mcp-demo",
                "ref": "main"
              },
              "manifestPath": ".local-codex/extensions/installed/workbench.mcp.connector.demo/localcodex-extension.json",
              "entryPaths": ["connectors/demo.json"],
              "capabilities": ["adds connector descriptors"],
              "compatibility": {
                "app": ">=1.0.0",
                "schema": "1"
              },
              "installNotes": "Descriptor only; no executable integration.",
              "publisher": "Workbench",
              "reviewStatus": "experimental",
              "verifiedSource": false,
              "supportedAppVersions": [">=1.0.0"],
              "signature": null,
              "trustLevel": "experimental",
              "recommended": false,
              "lastCheckedAt": "2026-04-13T00:00:00.000Z",
              "validationStatus": "warning",
              "validationIssues": ["Descriptor only"],
              "registrySourceId": "workbench-curated",
              "registrySourceLabel": "Workbench Curated Registry",
              "registrySourceLocation": "extensions-registry.json",
              "registrySourceEnabled": true,
              "registryEntryId": "workbench.mcp.connector.demo"
            }
          ],
          "issues": [
            {
              "id": "registry-note-1",
              "sourceId": "workbench-curated",
              "severity": "info",
              "message": "Demo registry is read-only and intended for screenshots."
            }
          ]
        }
        """
        let url = root.appendingPathComponent(".local-codex/extensions/catalog.json")
        try json.write(to: url, atomically: true, encoding: .utf8)
    }

    private func renderScreenshot<V: View>(_ view: V, size: CGSize, output: URL) throws {
        let hostedView = view
            .frame(width: size.width, height: size.height)
            .background(Color(nsColor: .windowBackgroundColor))

        let window = NSWindow(
            contentRect: CGRect(origin: .zero, size: size),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        let aqua = NSAppearance(named: .aqua)
        window.appearance = aqua
        window.isOpaque = false
        window.backgroundColor = .windowBackgroundColor
        window.level = .normal
        let hostingView = NSHostingView(rootView: hostedView)
        hostingView.appearance = aqua
        window.contentView = hostingView
        window.makeKeyAndOrderFront(nil)
        window.orderFrontRegardless()
        window.contentView?.layoutSubtreeIfNeeded()
        window.displayIfNeeded()

        guard let contentView = window.contentView else {
            throw NSError(domain: "WorkbenchScreenshot", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing content view for \(output.lastPathComponent)"])
        }

        guard let representation = contentView.bitmapImageRepForCachingDisplay(in: contentView.bounds) else {
            throw NSError(domain: "WorkbenchScreenshot", code: 1, userInfo: [NSLocalizedDescriptionKey: "Failed to allocate bitmap for \(output.lastPathComponent)"])
        }
        contentView.cacheDisplay(in: contentView.bounds, to: representation)
        let cropPoints = Int(220 * (window.backingScaleFactor > 0 ? window.backingScaleFactor : 2))
        let croppedRepresentation: NSBitmapImageRep
        if cropPoints > 0,
           cropPoints < representation.pixelsWide,
           let cgImage = representation.cgImage,
           let croppedCGImage = cgImage.cropping(to: CGRect(
            x: cropPoints,
            y: 0,
            width: representation.pixelsWide - cropPoints,
            height: representation.pixelsHigh
           )) {
            croppedRepresentation = NSBitmapImageRep(cgImage: croppedCGImage)
        } else {
            croppedRepresentation = representation
        }

        guard let png = croppedRepresentation.representation(using: .png, properties: [:]) else {
            throw NSError(domain: "WorkbenchScreenshot", code: 1, userInfo: [NSLocalizedDescriptionKey: "Failed to encode screenshot for \(output.lastPathComponent)"])
        }

        try png.write(to: output)
    }
}
