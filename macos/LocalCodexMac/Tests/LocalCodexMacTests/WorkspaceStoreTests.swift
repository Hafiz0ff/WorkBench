import Foundation
import XCTest
@testable import LocalCodexMac

private struct TestProjectState: Encodable {
    var schemaVersion: Int = 1
    var createdAt: String = "2026-04-13T00:00:00.000Z"
    var updatedAt: String = "2026-04-13T00:00:00.000Z"
    var lastRefreshAt: String = "2026-04-13T00:00:00.000Z"
    var activeRole: String?
    var selectedModel: String?
    var currentTaskId: String?
    var projectRoot: String
}

private struct TestTaskIndex: Encodable {
    var schemaVersion: Int = 1
    var createdAt: String = "2026-04-13T00:00:00.000Z"
    var updatedAt: String = "2026-04-13T00:00:00.000Z"
    var currentTaskId: String?
    var tasks: [String] = []
}

private func writeProjectState(_ root: URL, activeRole: String? = nil, selectedModel: String? = nil, currentTaskId: String? = nil) throws {
    let memoryRoot = root.appendingPathComponent(".local-codex", isDirectory: true)
    try FileManager.default.createDirectory(at: memoryRoot, withIntermediateDirectories: true)
    let state = TestProjectState(
        activeRole: activeRole,
        selectedModel: selectedModel,
        currentTaskId: currentTaskId,
        projectRoot: root.path
    )
    let data = try JSONEncoder().encode(state)
    try data.write(to: memoryRoot.appendingPathComponent("state.json"))
}

private func writeEmptyTaskIndex(_ root: URL) throws {
    let memoryRoot = root.appendingPathComponent(".local-codex", isDirectory: true)
    let tasksRoot = memoryRoot.appendingPathComponent("tasks", isDirectory: true)
    try FileManager.default.createDirectory(at: memoryRoot, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: tasksRoot, withIntermediateDirectories: true)
    let index = TestTaskIndex(currentTaskId: nil, tasks: [])
    let data = try JSONEncoder().encode(index)
    try data.write(to: tasksRoot.appendingPathComponent("index.json"))
}

private func writeRoleFile(_ root: URL, name: String, description: String) throws {
    let rolesRoot = root
        .appendingPathComponent(".local-codex", isDirectory: true)
        .appendingPathComponent("prompts", isDirectory: true)
        .appendingPathComponent("roles", isDirectory: true)
    try FileManager.default.createDirectory(at: rolesRoot, withIntermediateDirectories: true)
    let content = """
    ---
    name: \(name)
    description: \(description)
    ---
    """
    try content.write(to: rolesRoot.appendingPathComponent("\(name).md"), atomically: true, encoding: .utf8)
}

actor MockCLICommandRunner: CLICommandRunning {
    private(set) var calls: [[String]] = []
    let projectRoot: URL
    let handler: @Sendable ([String], URL?, [String: String]) async throws -> Void

    init(
        projectRoot: URL,
        handler: @escaping @Sendable ([String], URL?, [String: String]) async throws -> Void = { _, _, _ in }
    ) {
        self.projectRoot = projectRoot
        self.handler = handler
    }

    func runCLI(arguments: [String], currentDirectory: URL?, environment: [String : String]) async throws -> EngineCommandResult {
        calls.append(arguments)
        try await handler(arguments, currentDirectory, environment)
        return EngineCommandResult(
            command: "node",
            arguments: arguments,
            exitCode: 0,
            stdout: "",
            stderr: ""
        )
    }
}

@MainActor
final class WorkspaceStoreTests: XCTestCase {
    func testScaffoldRolesRefreshesSnapshotAndUpdatesRoleList() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try writeProjectState(root)
        let runner = MockCLICommandRunner(projectRoot: root) { arguments, _, _ in
            if arguments == ["roles", "scaffold"] {
                try writeRoleFile(root, name: "senior-engineer", description: "Practical engineering role.")
            }
        }
        let store = WorkspaceStore(
            engineBridge: EngineBridge(engineRoot: root),
            commandRunner: runner,
            selectedProjectRoot: root
        )

        await store.refreshSnapshot()
        XCTAssertEqual(store.snapshot?.roles.count, 0)
        XCTAssertEqual(store.selectedSection, .project)

        await store.scaffoldRoles()

        let calls = await runner.calls
        XCTAssertEqual(calls, [["roles", "scaffold"]])
        XCTAssertEqual(store.selectedSection, .project)
        XCTAssertEqual(store.selectedInspectorTab, .role)
        XCTAssertEqual(store.snapshot?.roles.count, 1)
        XCTAssertEqual(store.snapshot?.roles.first?.name, "senior-engineer")
        XCTAssertEqual(store.roleActionMessage, store.localeStore.text("gui.roles.scaffoldSuccess", 1))
    }

    func testOpenProjectRootBootstrapsWorkspaceAndScaffoldsRoles() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let runner = MockCLICommandRunner(projectRoot: root) { arguments, _, _ in
            if arguments == ["project", "init"] {
                try writeProjectState(root)
                try writeEmptyTaskIndex(root)
            } else if arguments == ["roles", "scaffold"] {
                try writeRoleFile(root, name: "senior-engineer", description: "Practical engineering role.")
            }
        }
        let store = WorkspaceStore(
            engineBridge: EngineBridge(engineRoot: root),
            commandRunner: runner
        )

        await store.openProjectRoot(root)

        let calls = await runner.calls
        XCTAssertEqual(calls, [["project", "init"], ["roles", "scaffold"]])
        XCTAssertEqual(store.selectedProjectRoot, root.standardizedFileURL)
        XCTAssertEqual(store.selectedSection, .project)
        XCTAssertEqual(store.snapshot?.roles.count, 1)
        XCTAssertEqual(store.snapshot?.roles.first?.name, "senior-engineer")
        XCTAssertEqual(store.roleActionMessage, store.localeStore.text("gui.roles.scaffoldSuccess", 1))
        XCTAssertTrue(store.projectLaunchBannerVisible)
        XCTAssertEqual(store.projectLaunchMessages, [
            store.localeStore.text("gui.project.bannerLoaded"),
            store.localeStore.text("gui.project.bannerMemoryReady"),
            store.localeStore.text("gui.project.bannerRolesReady"),
        ])
        XCTAssertNotNil(store.projectComposerFocusToken)
        XCTAssertFalse(store.isProjectBootstrapping)
    }

    func testCreateTaskRefreshesSnapshotAndKeepsTaskStateVisible() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try writeProjectState(root)
        try writeEmptyTaskIndex(root)

        let runner = MockCLICommandRunner(projectRoot: root) { arguments, _, _ in
            guard arguments.first == "task", arguments.dropFirst().first == "create" else { return }
            let memoryRoot = root.appendingPathComponent(".local-codex", isDirectory: true)
            let taskIndex = """
            {
              "schemaVersion": 1,
              "createdAt": "2026-04-13T00:00:00.000Z",
              "updatedAt": "2026-04-13T00:00:00.000Z",
              "currentTaskId": "task-1",
              "tasks": [
                {
                  "id": "task-1",
                  "title": "Auth refactor",
                  "slug": "auth-refactor",
                  "status": "draft",
                  "createdAt": "2026-04-13T00:00:00.000Z",
                  "updatedAt": "2026-04-13T00:00:00.000Z",
                  "role": "senior-engineer",
                  "model": "qwen2.5-coder:14b",
                  "summary": "Refactor auth",
                  "userRequest": "Refactor auth",
                  "relevantFiles": ["src/auth.js"],
                  "lastRunNotes": [],
                  "location": "active",
                  "folder": "active/task-1"
                }
              ]
            }
            """
            try taskIndex.write(to: memoryRoot.appendingPathComponent("tasks/index.json"), atomically: true, encoding: .utf8)
            try writeProjectState(root, activeRole: "senior-engineer", selectedModel: "qwen2.5-coder:14b", currentTaskId: "task-1")
        }

        let store = WorkspaceStore(
            engineBridge: EngineBridge(engineRoot: root),
            commandRunner: runner,
            selectedProjectRoot: root
        )
        store.taskTitle = "Auth refactor"
        store.taskRequest = "Refactor auth"

        _ = await store.createTask()

        let calls = await runner.calls
        XCTAssertEqual(Array(calls.first?.prefix(3) ?? []), ["task", "create", "--title"])
        XCTAssertEqual(store.selectedSection, .project)
        XCTAssertEqual(store.taskTitle, "")
        XCTAssertEqual(store.taskRequest, "")
        XCTAssertEqual(store.snapshot?.tasks.count, 1)
        XCTAssertEqual(store.snapshot?.state?.currentTaskId, "task-1")
    }

    func testUseTaskRefreshesSelectionAndShowsFeedback() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try writeProjectState(root, currentTaskId: "task-1")

        let memoryRoot = root.appendingPathComponent(".local-codex", isDirectory: true)
        let tasksRoot = memoryRoot.appendingPathComponent("tasks", isDirectory: true)
        try FileManager.default.createDirectory(at: tasksRoot, withIntermediateDirectories: true)
        let taskIndex = """
        {
          "schemaVersion": 1,
          "createdAt": "2026-04-13T00:00:00.000Z",
          "updatedAt": "2026-04-13T00:00:00.000Z",
          "currentTaskId": "task-1",
          "tasks": [
            {
              "id": "task-1",
              "title": "Initial task",
              "slug": "initial-task",
              "status": "draft",
              "createdAt": "2026-04-13T00:00:00.000Z",
              "updatedAt": "2026-04-13T00:00:00.000Z",
              "role": "senior-engineer",
              "model": "qwen2.5-coder:14b",
              "summary": "First task",
              "userRequest": "First task",
              "relevantFiles": [],
              "lastRunNotes": [],
              "location": "active",
              "folder": "active/task-1"
            },
            {
              "id": "task-2",
              "title": "Follow-up task",
              "slug": "follow-up-task",
              "status": "draft",
              "createdAt": "2026-04-13T00:00:00.000Z",
              "updatedAt": "2026-04-13T00:00:00.000Z",
              "role": "senior-engineer",
              "model": "qwen2.5-coder:14b",
              "summary": "Second task",
              "userRequest": "Second task",
              "relevantFiles": [],
              "lastRunNotes": [],
              "location": "active",
              "folder": "active/task-2"
            }
          ]
        }
        """
        try taskIndex.write(to: tasksRoot.appendingPathComponent("index.json"), atomically: true, encoding: .utf8)

        let runner = MockCLICommandRunner(projectRoot: root) { arguments, _, _ in
            if arguments == ["task", "use", "task-2"] {
                try writeProjectState(root, currentTaskId: "task-2")
                try taskIndex.write(to: tasksRoot.appendingPathComponent("index.json"), atomically: true, encoding: .utf8)
            }
        }

        let store = WorkspaceStore(
            engineBridge: EngineBridge(engineRoot: root),
            commandRunner: runner,
            selectedProjectRoot: root
        )

        await store.refreshSnapshot()
        XCTAssertEqual(store.snapshot?.state?.currentTaskId, "task-1")

        await store.useTask("task-2")

        let calls = await runner.calls
        XCTAssertEqual(calls, [["task", "use", "task-2"]])
        XCTAssertEqual(store.selectedTaskId, "task-2")
        XCTAssertEqual(store.snapshot?.state?.currentTaskId, "task-2")
        XCTAssertEqual(store.taskActionMessage, store.localeStore.text("gui.tasks.activatedMessage", "Follow-up task"))
        XCTAssertEqual(store.selectedSection, .project)
        XCTAssertEqual(store.selectedInspectorTab, .task)
    }

    func testProjectComposerSubmissionGuardPreventsDuplicateStart() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try writeProjectState(root)
        try writeEmptyTaskIndex(root)

        let runner = MockCLICommandRunner(projectRoot: root) { _, _, _ in
            XCTFail("No CLI calls should be issued while a submission is already in progress")
        }

        let store = WorkspaceStore(
            engineBridge: EngineBridge(engineRoot: root),
            commandRunner: runner,
            selectedProjectRoot: root
        )
        store.projectComposerText = "Inspect startup flow"
        store.isProjectComposerSubmitting = true

        await store.startProjectTask()

        let calls = await runner.calls
        XCTAssertTrue(calls.isEmpty)
        XCTAssertEqual(store.projectComposerText, "Inspect startup flow")
        XCTAssertTrue(store.isProjectComposerSubmitting)
    }

    func testUseRoleRefreshesSnapshotAndPersistsSelection() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try writeProjectState(root, activeRole: "senior-engineer", selectedModel: "qwen2.5-coder:14b")

        let runner = MockCLICommandRunner(projectRoot: root) { arguments, _, _ in
            guard arguments == ["roles", "use", "designer"] else { return }
            try writeProjectState(root, activeRole: "designer", selectedModel: "qwen2.5-coder:14b")
        }

        let store = WorkspaceStore(
            engineBridge: EngineBridge(engineRoot: root),
            commandRunner: runner,
            selectedProjectRoot: root
        )

        await store.refreshSnapshot()
        XCTAssertEqual(store.currentRoleDisplay, "senior-engineer")

        await store.useRole("designer")

        let calls = await runner.calls
        XCTAssertEqual(calls, [["roles", "use", "designer"]])
        XCTAssertEqual(store.selectedSection, .project)
        XCTAssertEqual(store.selectedInspectorTab, .role)
        XCTAssertEqual(store.snapshot?.state?.activeRole, "designer")
        XCTAssertEqual(store.currentRoleDisplay, "designer")
    }

    func testInstallExtensionWithoutSourceShowsErrorAndSkipsCLI() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try writeProjectState(root)
        let runner = MockCLICommandRunner(projectRoot: root)

        let store = WorkspaceStore(
            engineBridge: EngineBridge(engineRoot: root),
            commandRunner: runner,
            selectedProjectRoot: root
        )
        store.extensionSourceInput = "   "

        await store.installExtension()

        let calls = await runner.calls
        XCTAssertTrue(calls.isEmpty)
        XCTAssertEqual(store.console.last?.kind.rawValue, ConsoleEntry.Kind.error.rawValue)
        XCTAssertEqual(store.console.last?.text, store.localeStore.text("gui.errors.extensionSourceMissing"))
    }

    func testProjectInitAndRefreshRefreshSnapshotAfterFilesystemChanges() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let runner = MockCLICommandRunner(projectRoot: root) { arguments, _, _ in
            if arguments == ["project", "init"] {
                try writeProjectState(root, activeRole: "senior-engineer", selectedModel: "qwen2.5-coder:14b")
                try writeEmptyTaskIndex(root)
            }
            if arguments == ["project", "refresh"] {
                try writeProjectState(root, activeRole: "software-architect", selectedModel: "qwen2.5-coder:14b")
            }
        }

        let store = WorkspaceStore(
            engineBridge: EngineBridge(engineRoot: root),
            commandRunner: runner,
            selectedProjectRoot: root
        )

        await store.initializeWorkspace()
        XCTAssertTrue(store.snapshot?.memoryExists == true)
        XCTAssertEqual(store.selectedSection, .project)

        await store.refreshWorkspace()

        let calls = await runner.calls
        XCTAssertEqual(calls, [["project", "init"], ["project", "refresh"]])
        XCTAssertEqual(store.snapshot?.state?.activeRole, "software-architect")
    }

    func testPromptInspectRoutesRoleAndTaskIntoCLI() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try writeProjectState(root, activeRole: "senior-engineer", selectedModel: "qwen2.5-coder:14b")

        let runner = MockCLICommandRunner(projectRoot: root)
        let store = WorkspaceStore(
            engineBridge: EngineBridge(engineRoot: root),
            commandRunner: runner,
            selectedProjectRoot: root
        )
        store.promptRoleOverride = "code-reviewer"
        store.promptInstruction = "Review the auth flow"

        await store.inspectPrompt()

        let calls = await runner.calls
        XCTAssertEqual(calls.first, ["prompt", "inspect", "--role", "code-reviewer", "--task", "Review the auth flow"])
        XCTAssertEqual(store.selectedSection, .project)
        XCTAssertEqual(store.selectedInspectorTab, .context)
    }

    func testPatchActionsRouteAndRefreshState() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try writeProjectState(root, activeRole: "senior-engineer", selectedModel: "qwen2.5-coder:14b")
        let memoryRoot = root.appendingPathComponent(".local-codex", isDirectory: true)
        try FileManager.default.createDirectory(at: memoryRoot, withIntermediateDirectories: true)
        try """
        {
          "schemaVersion": 1,
          "patchId": "patch-1",
          "status": "pending",
          "taskId": "task-1",
          "role": "senior-engineer",
          "model": "qwen2.5-coder:14b",
          "summary": "Update auth",
          "approvalMode": "on-request",
          "approvalStatus": "required",
          "validationStatus": "pending",
          "affectedFiles": [],
          "validationCommands": []
        }
        """.write(to: memoryRoot.appendingPathComponent("pending-change.json"), atomically: true, encoding: .utf8)

        let runner = MockCLICommandRunner(projectRoot: root) { arguments, _, _ in
            if arguments == ["patch", "apply"] {
                try writeProjectState(root, activeRole: "senior-engineer", selectedModel: "qwen2.5-coder:14b")
                try """
                {
                  "schemaVersion": 1,
                  "patchId": "patch-1",
                  "status": "applied",
                  "taskId": "task-1",
                  "role": "senior-engineer",
                  "model": "qwen2.5-coder:14b",
                  "summary": "Update auth",
                  "approvalMode": "on-request",
                  "approvalStatus": "approved",
                  "validationStatus": "passed",
                  "affectedFiles": [],
                  "validationCommands": []
                }
                """.write(to: memoryRoot.appendingPathComponent("pending-change.json"), atomically: true, encoding: .utf8)
            }
            if arguments == ["patch", "reject"] {
                try """
                {
                  "schemaVersion": 1,
                  "patchId": "patch-1",
                  "status": "rejected",
                  "taskId": "task-1",
                  "role": "senior-engineer",
                  "model": "qwen2.5-coder:14b",
                  "summary": "Update auth",
                  "approvalMode": "on-request",
                  "approvalStatus": "rejected",
                  "validationStatus": "skipped",
                  "affectedFiles": [],
                  "validationCommands": []
                }
                """.write(to: memoryRoot.appendingPathComponent("pending-change.json"), atomically: true, encoding: .utf8)
            }
        }

        let store = WorkspaceStore(
            engineBridge: EngineBridge(engineRoot: root),
            commandRunner: runner,
            selectedProjectRoot: root
        )
        await store.refreshSnapshot()
        XCTAssertEqual(store.snapshot?.pendingPatch?.status, "pending")

        await store.applyPatch()
        XCTAssertEqual(store.selectedSection, .project)
        XCTAssertEqual(store.selectedInspectorTab, .patch)
        XCTAssertEqual(store.snapshot?.pendingPatch?.status, "applied")

        await store.rejectPatch()
        XCTAssertEqual(store.snapshot?.pendingPatch?.status, "rejected")
    }

    func testExtensionAndRegistryActionsRouteToExpectedCommands() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try writeProjectState(root)
        let runner = MockCLICommandRunner(projectRoot: root) { arguments, _, _ in
            if arguments == ["extensions", "doctor"] {
                return
            }
            if arguments == ["registry", "refresh"] {
                let memoryRoot = root.appendingPathComponent(".local-codex", isDirectory: true)
                try FileManager.default.createDirectory(at: memoryRoot.appendingPathComponent("extensions", isDirectory: true), withIntermediateDirectories: true)
                let catalog = """
                {
                  "schemaVersion": 1,
                  "createdAt": "2026-04-13T00:00:00.000Z",
                  "updatedAt": "2026-04-13T00:00:00.000Z",
                  "sources": [],
                  "entries": [],
                  "issues": []
                }
                """
                try catalog.write(to: memoryRoot.appendingPathComponent("extensions/catalog.json"), atomically: true, encoding: .utf8)
            }
        }

        let store = WorkspaceStore(
            engineBridge: EngineBridge(engineRoot: root),
            commandRunner: runner,
            selectedProjectRoot: root
        )
        store.extensionSourceInput = "owner/repo"
        store.extensionPathInput = "packs/demo"
        store.extensionRefInput = "main"

        await store.installExtension()
        await store.refreshExtensions()
        await store.refreshRegistry()

        let calls = await runner.calls
        XCTAssertEqual(calls[0], ["extensions", "install", "owner/repo", "--yes", "--path", "packs/demo", "--ref", "main"])
        XCTAssertEqual(calls[1], ["extensions", "doctor"])
        XCTAssertEqual(calls[2], ["registry", "refresh"])
        XCTAssertEqual(store.selectedSection, .project)
        XCTAssertEqual(store.selectedInspectorTab, .advanced)
    }

    func testInspectExtensionAndRegistrySelectionStateUpdatesImmediately() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try writeProjectState(root)

        let memoryRoot = root.appendingPathComponent(".local-codex", isDirectory: true)
        try FileManager.default.createDirectory(at: memoryRoot.appendingPathComponent("extensions", isDirectory: true), withIntermediateDirectories: true)

        let extensionsJSON = """
        {
          "schemaVersion": 1,
          "createdAt": "2026-04-13T00:00:00.000Z",
          "updatedAt": "2026-04-13T00:00:00.000Z",
          "extensions": [
            {
              "id": "ext.demo",
              "name": "Demo Extension",
              "type": "skill",
              "reviewStatus": "trusted",
              "trustLevel": "high",
              "installSourceType": "registry",
              "enabled": true,
              "manifestPath": "extensions/demo/manifest.json",
              "installPath": "extensions/demo",
              "capabilities": ["task", "inspect"]
            }
          ]
        }
        """
        try extensionsJSON.write(to: memoryRoot.appendingPathComponent("extensions/registry.json"), atomically: true, encoding: .utf8)

        let catalogJSON = """
        {
          "schemaVersion": 1,
          "createdAt": "2026-04-13T00:00:00.000Z",
          "updatedAt": "2026-04-13T00:00:00.000Z",
          "sources": [],
          "entries": [
            {
              "id": "catalog.demo",
              "name": "Demo Catalog",
              "type": "skill",
              "reviewStatus": "reviewed",
              "registrySourceLabel": "demo",
              "recommended": true
            }
          ],
          "issues": []
        }
        """
        try catalogJSON.write(to: memoryRoot.appendingPathComponent("extensions/catalog.json"), atomically: true, encoding: .utf8)

        let runner = MockCLICommandRunner(projectRoot: root) { arguments, _, _ in
            if arguments == ["extensions", "inspect", "ext.demo"] {
                return
            }
            if arguments == ["registry", "show", "catalog.demo"] {
                return
            }
        }

        let store = WorkspaceStore(
            engineBridge: EngineBridge(engineRoot: root),
            commandRunner: runner,
            selectedProjectRoot: root
        )

        await store.refreshSnapshot()
        XCTAssertEqual(store.snapshot?.extensions?.extensions?.count, 1)
        XCTAssertEqual(store.snapshot?.registryCatalog?.entries?.count, 1)

        await store.inspectExtension("ext.demo")
        XCTAssertEqual(store.selectedExtensionId, "ext.demo")
        XCTAssertEqual(store.selectedSection, .project)
        XCTAssertEqual(store.selectedInspectorTab, .advanced)

        await store.inspectRegistryEntry("catalog.demo")
        XCTAssertEqual(store.selectedRegistryId, "catalog.demo")
        XCTAssertEqual(store.selectedSection, .project)
        XCTAssertEqual(store.selectedInspectorTab, .advanced)
    }
}
