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
        XCTAssertEqual(store.selectedSection, .roles)
        XCTAssertEqual(store.snapshot?.roles.count, 1)
        XCTAssertEqual(store.snapshot?.roles.first?.name, "senior-engineer")
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

        await store.createTask()

        let calls = await runner.calls
        XCTAssertEqual(Array(calls.first?.prefix(3) ?? []), ["task", "create", "--title"])
        XCTAssertEqual(store.selectedSection, .tasks)
        XCTAssertEqual(store.taskTitle, "")
        XCTAssertEqual(store.taskRequest, "")
        XCTAssertEqual(store.snapshot?.tasks.count, 1)
        XCTAssertEqual(store.snapshot?.state?.currentTaskId, "task-1")
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
        XCTAssertEqual(store.selectedSection, .roles)
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
}
