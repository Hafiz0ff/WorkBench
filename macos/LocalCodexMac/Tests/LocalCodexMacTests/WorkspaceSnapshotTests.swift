import XCTest
@testable import LocalCodexMac

final class WorkspaceSnapshotTests: XCTestCase {
    func testLoadsExistingLocalCodexFiles() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let memoryRoot = root.appendingPathComponent(".local-codex", isDirectory: true)
        try FileManager.default.createDirectory(at: memoryRoot.appendingPathComponent("prompts/roles", isDirectory: true), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: memoryRoot.appendingPathComponent("tasks/active/task-1", isDirectory: true), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: memoryRoot.appendingPathComponent("module_summaries", isDirectory: true), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: memoryRoot.appendingPathComponent("extensions", isDirectory: true), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: memoryRoot.appendingPathComponent("extensions/catalog-cache", isDirectory: true), withIntermediateDirectories: true)

        try """
        {
          "schemaVersion": 1,
          "createdAt": "2026-04-13T00:00:00.000Z",
          "updatedAt": "2026-04-13T00:00:00.000Z",
          "lastRefreshAt": "2026-04-13T00:00:00.000Z",
          "activeRole": "senior-engineer",
          "selectedModel": "qwen2.5-coder:14b",
          "currentTaskId": "task-1",
          "projectRoot": "\(root.path)"
        }
        """.write(to: memoryRoot.appendingPathComponent("state.json"), atomically: true, encoding: .utf8)

        try """
        {
          "schemaVersion": 1,
          "approvalMode": "on-request"
        }
        """.write(to: memoryRoot.appendingPathComponent("policy.json"), atomically: true, encoding: .utf8)

        try """
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
        """.write(to: memoryRoot.appendingPathComponent("tasks/index.json"), atomically: true, encoding: .utf8)

        try """
        ---
        name: senior-engineer
        description: Practical engineering role.
        ---
        """.write(to: memoryRoot.appendingPathComponent("prompts/roles/senior-engineer.md"), atomically: true, encoding: .utf8)

        try """
        {
          "schemaVersion": 1,
          "createdAt": "2026-04-13T00:00:00.000Z",
          "updatedAt": "2026-04-13T00:00:00.000Z",
          "extensions": [
            {
              "id": "sample.role-pack",
              "name": "Sample Pack",
              "version": "1.0.0",
              "type": "role-pack",
              "author": "Codex Team",
              "description": "Sample extension pack.",
              "enabled": true,
              "status": "enabled",
              "entryPaths": ["roles"],
              "capabilities": ["adds roles"],
              "manifestPath": ".local-codex/extensions/installed/sample.role-pack/manifest.json",
              "installPath": ".local-codex/extensions/installed/sample.role-pack"
            }
          ]
        }
        """.write(to: memoryRoot.appendingPathComponent("extensions/registry.json"), atomically: true, encoding: .utf8)

        try """
        {
          "schemaVersion": 1,
          "createdAt": "2026-04-13T00:00:00.000Z",
          "updatedAt": "2026-04-13T00:00:00.000Z",
          "sources": [
            {
              "id": "source-1",
              "location": "\(root.path)/extensions-registry.json",
              "kind": "file",
              "label": "Workbench Curated Registry",
              "publisher": "Workbench",
              "reviewStatus": "reviewed",
              "verifiedSource": true,
              "trustLevel": "reviewed",
              "enabled": true,
              "addedAt": "2026-04-13T00:00:00.000Z",
              "updatedAt": "2026-04-13T00:00:00.000Z",
              "lastCheckedAt": "2026-04-13T00:00:00.000Z",
              "entryCount": 1
            }
          ],
          "entries": [
            {
              "id": "sample.reviewed",
              "name": "Sample Reviewed",
              "version": "1.0.0",
              "type": "role-pack",
              "author": "Codex Team",
              "description": "Reviewed sample.",
              "source": {
                "kind": "github",
                "owner": "octo",
                "repo": "sample",
                "ref": "main",
                "subdirectory": "packs/demo",
                "url": "https://github.com/octo/sample/tree/main/packs/demo"
              },
              "manifestPath": "localcodex-extension.json",
              "capabilities": ["adds roles"],
              "compatibility": {
                "app": ">=0.1.0",
                "schema": "1"
              },
              "publisher": "Codex Team",
              "reviewStatus": "reviewed",
              "verifiedSource": true,
              "supportedAppVersions": [">=0.1.0"],
              "trustLevel": "reviewed",
              "recommended": true,
              "lastCheckedAt": "2026-04-13T00:00:00.000Z",
              "validationStatus": "valid",
              "validationIssues": [],
              "registrySourceId": "source-1",
              "registrySourceLabel": "Workbench Curated Registry",
              "registrySourceLocation": "\(root.path)/extensions-registry.json",
              "registrySourceEnabled": true,
              "registryEntryId": "sample.reviewed"
            }
          ],
          "issues": []
        }
        """.write(to: memoryRoot.appendingPathComponent("extensions/catalog.json"), atomically: true, encoding: .utf8)

        try "summary".write(to: memoryRoot.appendingPathComponent("module_summaries/network.md"), atomically: true, encoding: .utf8)
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
        """.write(to: root.appendingPathComponent(".local-codex/pending-change.json"), atomically: true, encoding: .utf8)

        let snapshot = try WorkspaceSnapshot.load(projectRoot: root)
        XCTAssertTrue(snapshot.memoryExists)
        XCTAssertEqual(snapshot.state?.activeRole, "senior-engineer")
        XCTAssertEqual(snapshot.policy?.approvalMode, "on-request")
        XCTAssertEqual(snapshot.tasks.count, 1)
        XCTAssertEqual(snapshot.roles.count, 1)
        XCTAssertEqual(snapshot.extensions?.extensions?.count, 1)
        XCTAssertEqual(snapshot.extensions?.extensions?.first?.enabled, true)
        XCTAssertEqual(snapshot.pendingPatch?.status, "pending")
        XCTAssertEqual(snapshot.moduleSummaryCount, 1)
    }
}
