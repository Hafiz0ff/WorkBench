import Foundation
import XCTest
@testable import LocalCodexMac

actor MockCLICommandRunner: CLICommandRunning {
    private(set) var calls: [[String]] = []
    let projectRoot: URL

    init(projectRoot: URL) {
        self.projectRoot = projectRoot
    }

    func runCLI(arguments: [String], currentDirectory: URL?, environment: [String : String]) async throws -> EngineCommandResult {
        calls.append(arguments)
        if arguments == ["roles", "scaffold"] {
            let rolesRoot = projectRoot
                .appendingPathComponent(".local-codex", isDirectory: true)
                .appendingPathComponent("prompts", isDirectory: true)
                .appendingPathComponent("roles", isDirectory: true)
            try FileManager.default.createDirectory(at: rolesRoot, withIntermediateDirectories: true)
            let roleFile = rolesRoot.appendingPathComponent("senior-engineer.md")
            let content = """
            ---
            name: senior-engineer
            description: Practical engineering role.
            ---
            """
            try content.write(to: roleFile, atomically: true, encoding: .utf8)
        }

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
        let memoryRoot = root.appendingPathComponent(".local-codex", isDirectory: true)
        let rolesRoot = memoryRoot.appendingPathComponent("prompts", isDirectory: true).appendingPathComponent("roles", isDirectory: true)
        try FileManager.default.createDirectory(at: rolesRoot, withIntermediateDirectories: true)

        let runner = MockCLICommandRunner(projectRoot: root)
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
}
