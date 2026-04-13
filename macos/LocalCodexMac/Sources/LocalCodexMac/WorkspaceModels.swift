import Foundation

struct ProjectStateFile: Codable {
    var schemaVersion: Int?
    var createdAt: String?
    var updatedAt: String?
    var lastRefreshAt: String?
    var activeRole: String?
    var selectedModel: String?
    var currentTaskId: String?
    var projectRoot: String?
}

struct PolicyRequirementFile: Codable {
    var commands: [String]?
    var categories: [String]?
}

struct PolicyFile: Codable {
    var schemaVersion: Int?
    var approvalMode: String?
    var allowedReadGlobs: [String]?
    var allowedWriteGlobs: [String]?
    var blockedPaths: [String]?
    var allowedCommands: [String]?
    var blockedCommands: [String]?
    var requireApprovalFor: PolicyRequirementFile?
    var maxCommandOutputChars: Int?
}

struct ExtensionSourceFile: Codable, Hashable {
    var kind: String?
    var owner: String?
    var repo: String?
    var ref: String?
    var subdirectory: String?
    var url: String?
}

struct ExtensionCompatibilityFile: Codable, Hashable {
    var app: String?
    var schema: String?
}

struct ExtensionLocalizationFile: Codable, Hashable {
    var supportedLocales: [String]?
    var defaultLocale: String?
}

struct ExtensionRegistryEntry: Codable, Identifiable, Hashable {
    var id: String
    var name: String?
    var version: String?
    var type: String?
    var author: String?
    var description: String?
    var source: ExtensionSourceFile?
    var manifestPath: String?
    var installPath: String?
    var entryPaths: [String]?
    var capabilities: [String]?
    var compatibility: ExtensionCompatibilityFile?
    var localization: ExtensionLocalizationFile?
    var publisher: String?
    var reviewStatus: String?
    var verifiedSource: Bool?
    var supportedAppVersions: [String]?
    var signature: String?
    var lastCheckedAt: String?
    var trustLevel: String?
    var recommended: Bool?
    var registrySourceId: String?
    var registrySourceLabel: String?
    var registrySourceLocation: String?
    var registryEntryId: String?
    var installSourceType: String?
    var enabled: Bool?
    var status: String?
    var warnings: [String]?
    var installedAt: String?
    var updatedAt: String?
    var lastValidatedAt: String?
}

struct ExtensionRegistryFile: Codable {
    var schemaVersion: Int?
    var createdAt: String?
    var updatedAt: String?
    var extensions: [ExtensionRegistryEntry]?
}

struct RegistrySourceFile: Codable, Identifiable, Hashable {
    var id: String
    var location: String
    var kind: String?
    var label: String?
    var publisher: String?
    var reviewStatus: String?
    var verifiedSource: Bool?
    var trustLevel: String?
    var description: String?
    var enabled: Bool?
    var addedAt: String?
    var updatedAt: String?
    var lastCheckedAt: String?
    var lastError: String?
    var entryCount: Int?
    var notes: String?
}

struct RegistryCatalogEntryFile: Codable, Identifiable, Hashable {
    var id: String
    var name: String?
    var version: String?
    var type: String?
    var author: String?
    var description: String?
    var source: ExtensionSourceFile?
    var manifestPath: String?
    var entryPaths: [String]?
    var capabilities: [String]?
    var compatibility: ExtensionCompatibilityFile?
    var installNotes: String?
    var localization: ExtensionLocalizationFile?
    var hashes: RegistryHashesFile?
    var publisher: String?
    var reviewStatus: String?
    var verifiedSource: Bool?
    var supportedAppVersions: [String]?
    var signature: String?
    var trustLevel: String?
    var recommended: Bool?
    var lastCheckedAt: String?
    var validationStatus: String?
    var validationIssues: [String]?
    var registrySourceId: String?
    var registrySourceLabel: String?
    var registrySourceLocation: String?
    var registrySourceEnabled: Bool?
    var registryEntryId: String?
}

struct RegistryCatalogFile: Codable {
    var schemaVersion: Int?
    var createdAt: String?
    var updatedAt: String?
    var sources: [RegistrySourceFile]?
    var entries: [RegistryCatalogEntryFile]?
    var issues: [RegistryIssueFile]?
}

struct RegistryHashesFile: Codable, Hashable {
    var manifest: String?
    var entries: [String: String]?
}

struct RegistryIssueFile: Codable, Hashable {
    var id: String?
    var sourceId: String?
    var severity: String?
    var message: String
}

struct TaskIndexEntry: Codable, Identifiable, Hashable {
    var id: String
    var title: String
    var slug: String
    var status: String
    var createdAt: String?
    var updatedAt: String?
    var role: String?
    var model: String?
    var summary: String?
    var userRequest: String?
    var relevantFiles: [String]?
    var lastRunNotes: [TaskNoteEntry]?
    var location: String?
    var folder: String?
}

struct TaskIndexFile: Codable {
    var schemaVersion: Int?
    var createdAt: String?
    var updatedAt: String?
    var currentTaskId: String?
    var tasks: [TaskIndexEntry]?
}

struct TaskNoteEntry: Codable, Hashable {
    var kind: String
    var source: String
    var text: String
    var createdAt: String
}

struct TaskStatusFile: Codable {
    var schemaVersion: Int?
    var id: String?
    var title: String?
    var slug: String?
    var status: String?
    var createdAt: String?
    var updatedAt: String?
    var role: String?
    var model: String?
    var summary: String?
    var userRequest: String?
    var relevantFiles: [String]?
    var lastRunNotes: [TaskNoteEntry]?
}

struct PendingPatchChangeFile: Codable, Hashable {
    var path: String
    var action: String
    var beforeContent: String?
    var afterContent: String?
    var diffText: String?
}

struct PendingPatchFile: Codable {
    var schemaVersion: Int?
    var patchId: String
    var taskId: String?
    var role: String?
    var model: String?
    var createdAt: String?
    var updatedAt: String?
    var status: String
    var approvalMode: String?
    var approvalStatus: String?
    var validationStatus: String?
    var summary: String?
    var affectedFiles: [PatchAffectedFile]?
    var validationCommands: [ValidationCommand]?
    var validationResults: [ValidationResult]?
    var changes: [PendingPatchChangeFile]?
    var appliedAt: String?
    var rejectedAt: String?
    var diffPath: String?
    var patchPath: String?
    var diffText: String?
}

struct PatchAffectedFile: Codable, Hashable {
    var path: String
    var action: String
    var approval: String?
}

struct ValidationCommand: Codable, Hashable {
    var command: String
    var args: [String]?
    var timeoutMs: Int?
}

struct ValidationResult: Codable, Hashable {
    var command: String
    var args: [String]?
    var ok: Bool?
    var decision: String?
    var category: String?
    var stdout: String?
    var stderr: String?
    var reason: String?
    var skipped: Bool?
}

struct RoleFileSnapshot: Identifiable, Hashable {
    var id: String { name }
    var name: String
    var description: String
    var fileURL: URL
    var rawContent: String
}

struct WorkspaceSnapshot {
    var projectRoot: URL
    var memoryExists: Bool
    var state: ProjectStateFile?
    var policy: PolicyFile?
    var extensions: ExtensionRegistryFile?
    var registrySources: RegistryCatalogFile?
    var registryCatalog: RegistryCatalogFile?
    var taskIndex: TaskIndexFile?
    var tasks: [TaskIndexEntry]
    var roles: [RoleFileSnapshot]
    var pendingPatch: PendingPatchFile?
    var moduleSummaryCount: Int
}

extension WorkspaceSnapshot {
    static func load(projectRoot: URL) throws -> WorkspaceSnapshot {
        let fileManager = FileManager.default
        let memoryRoot = projectRoot.appendingPathComponent(".local-codex", isDirectory: true)
        let decoder = JSONDecoder()
        let codexRoot = memoryRoot

        func readText(_ relativePath: String) -> String? {
            let url = relativePath
                .split(separator: "/")
                .reduce(projectRoot) { partialResult, component in
                    partialResult.appendingPathComponent(String(component))
                }
            guard fileManager.fileExists(atPath: url.path) else { return nil }
            return try? String(contentsOf: url, encoding: .utf8)
        }

        func readJSON<T: Decodable>(_ relativePath: String, as type: T.Type) -> T? {
            guard let text = readText(relativePath), let data = text.data(using: .utf8) else { return nil }
            return try? decoder.decode(T.self, from: data)
        }

        let state = readJSON(".local-codex/state.json", as: ProjectStateFile.self)
        let policy = readJSON(".local-codex/policy.json", as: PolicyFile.self)
        let extensions = readJSON(".local-codex/extensions/registry.json", as: ExtensionRegistryFile.self)
        let registrySources = readJSON(".local-codex/extensions/sources.json", as: RegistryCatalogFile.self)
        let registryCatalog = readJSON(".local-codex/extensions/catalog.json", as: RegistryCatalogFile.self)
        let index = readJSON(".local-codex/tasks/index.json", as: TaskIndexFile.self)
        let pendingPatch = readJSON(".local-codex/pending-change.json", as: PendingPatchFile.self)

        let tasks = index?.tasks ?? []

        let moduleSummaryRoot = codexRoot.appendingPathComponent("module_summaries", isDirectory: true)
        let moduleSummaryCount = (try? fileManager.contentsOfDirectory(atPath: moduleSummaryRoot.path).count) ?? 0

        let rolesRoot = codexRoot.appendingPathComponent("prompts", isDirectory: true).appendingPathComponent("roles", isDirectory: true)
        let roleURLs = ((try? fileManager.contentsOfDirectory(at: rolesRoot, includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.pathExtension.lowercased() == "md" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }

        let roles = roleURLs.map { url -> RoleFileSnapshot in
            let content = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
            let name = WorkspaceSnapshot.parseRoleName(from: content) ?? url.deletingPathExtension().lastPathComponent
            let description = WorkspaceSnapshot.parseRoleDescription(from: content) ?? url.lastPathComponent
            return RoleFileSnapshot(name: name, description: description, fileURL: url, rawContent: content)
        }

        return WorkspaceSnapshot(
            projectRoot: projectRoot,
            memoryExists: fileManager.fileExists(atPath: memoryRoot.path),
            state: state,
            policy: policy,
            extensions: extensions,
            registrySources: registrySources,
            registryCatalog: registryCatalog,
            taskIndex: index,
            tasks: tasks,
            roles: roles,
            pendingPatch: pendingPatch,
            moduleSummaryCount: moduleSummaryCount
        )
    }

    static func parseRoleName(from content: String) -> String? {
        parseFrontmatterValue(named: "name", in: content)
    }

    static func parseRoleDescription(from content: String) -> String? {
        parseFrontmatterValue(named: "description", in: content)
    }

    private static func parseFrontmatterValue(named key: String, in content: String) -> String? {
        let lines = content.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        guard let start = lines.firstIndex(of: "---") else { return nil }
        guard let end = lines.dropFirst(start + 1).firstIndex(of: "---") else { return nil }
        let body = lines[(start + 1)..<end]
        for line in body {
            let prefix = "\(key):"
            if line.lowercased().hasPrefix(prefix) {
                return line.dropFirst(prefix.count).trimmingCharacters(in: .whitespaces)
            }
        }
        return nil
    }
}
