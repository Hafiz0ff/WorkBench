import Foundation
import AppKit
import Combine
import SwiftUI

enum WorkspaceSection: String, CaseIterable, Identifiable {
    case project
    case tasks
    case roles
    case extensions
    case registry
    case prompt
    case patches
    case policy
    case session
    case settings

    var id: String { rawValue }
}

struct ConsoleEntry: Identifiable, Hashable {
    enum Kind: String {
        case info
        case output
        case error
        case command
    }

    var id = UUID()
    var timestamp = Date()
    var kind: Kind
    var text: String
}

@MainActor
final class WorkspaceStore: ObservableObject {
    @Published var selectedSection: WorkspaceSection = .project
    @Published var selectedProjectRoot: URL?
    @Published var snapshot: WorkspaceSnapshot?
    @Published var console: [ConsoleEntry] = []
    @Published var promptInstruction: String = ""
    @Published var promptRoleOverride: String = ""
    @Published var taskTitle: String = ""
    @Published var taskRequest: String = ""
    @Published var taskNoteText: String = ""
    @Published var taskNoteKind: String = "finding"
    @Published var sessionInput: String = ""
    @Published var sessionOutputText: String = ""
    @Published var sessionIsRunning = false
    @Published var sessionProcessStatus: String = ""
    @Published var extensionSourceInput: String = ""
    @Published var extensionPathInput: String = ""
    @Published var extensionRefInput: String = ""
    let localeStore = LocalizationStore()
    @Published var isLoading = false
    @Published var selectedTaskId: String?
    @Published var selectedRoleName: String?
    @Published var selectedExtensionId: String?
    @Published var selectedRegistryId: String?
    @Published var roleActionMessage: String?

    let engineBridge: EngineBridge
    let commandRunner: any CLICommandRunning
    private var sessionProcess: Process?
    private var sessionInputPipe: Pipe?
    private var cancellables = Set<AnyCancellable>()

    init(
        engineBridge: EngineBridge? = nil,
        commandRunner: (any CLICommandRunning)? = nil,
        selectedProjectRoot: URL? = nil
    ) {
        let storedProjectRoot = UserDefaults.standard.string(forKey: "localcodex.projectRoot") ?? ""
        let storedEngineRootOverride = UserDefaults.standard.string(forKey: "localcodex.engineRootOverride") ?? ""
        let bundledEngineRoot = WorkspaceStore.resolveBundledEngineRoot()
        let engineRoot = WorkspaceStore.resolveEngineRoot(override: storedEngineRootOverride)
            ?? bundledEngineRoot
            ?? EngineBridge.detectEngineRoot()
            ?? URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        self.engineBridge = engineBridge ?? EngineBridge(engineRoot: engineRoot)
        self.commandRunner = commandRunner ?? self.engineBridge
        if let selectedProjectRoot {
            self.selectedProjectRoot = selectedProjectRoot
        } else if !storedProjectRoot.isEmpty {
            self.selectedProjectRoot = URL(fileURLWithPath: storedProjectRoot)
        }
        localeStore.objectWillChange
            .sink { [weak self] _ in
                self?.objectWillChange.send()
            }
            .store(in: &cancellables)
    }

    static func resolveEngineRoot(override: String) -> URL? {
        let trimmed = override.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return URL(fileURLWithPath: trimmed)
    }

    static func resolveBundledEngineRoot(resourceURL: URL? = Bundle.main.resourceURL) -> URL? {
        guard let resourceURL else { return nil }
        let marker = resourceURL.appendingPathComponent("engine-root.txt")
        guard let rawPath = try? String(contentsOf: marker, encoding: .utf8) else { return nil }
        let trimmed = rawPath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let url = URL(fileURLWithPath: trimmed)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    var engineRootDisplay: String {
        engineBridge.engineRoot.path
    }

    var projectRootDisplay: String {
        selectedProjectRoot?.path ?? localeStore.text("gui.project.noProjectSelected")
    }

    var currentRoleDisplay: String {
        snapshot?.state?.activeRole ?? localeStore.text("gui.common.notSet")
    }

    var currentModelDisplay: String {
        snapshot?.state?.selectedModel ?? localeStore.text("gui.common.notSet")
    }

    var currentTaskDisplay: String {
        if let taskId = snapshot?.state?.currentTaskId {
            return taskId
        }
        return localeStore.text("gui.common.notSet")
    }

    var currentTaskSummaryDisplay: String {
        guard let taskId = snapshot?.state?.currentTaskId else {
            return localeStore.text("gui.common.notSet")
        }
        let taskTitle = snapshot?.tasks.first(where: { $0.id == taskId })?.title
        if let taskTitle {
            return "\(taskId) — \(taskTitle)"
        }
        return taskId
    }

    var approvalModeDisplay: String {
        let mode = snapshot?.policy?.approvalMode ?? "on-request"
        switch mode {
        case "strict":
            return localeStore.text("gui.policy.strict")
        case "auto-safe":
            return localeStore.text("gui.policy.autoSafe")
        default:
            return localeStore.text("gui.policy.onRequest")
        }
    }

    var currentPatchStatusDisplay: String {
        guard let patch = snapshot?.pendingPatch else {
            return localeStore.text("gui.patch.noPending")
        }
        switch patch.status {
        case "pending":
            return localeStore.text("gui.patch.pending")
        case "applied":
            return localeStore.text("gui.patch.applied")
        case "rejected":
            return localeStore.text("gui.patch.rejected")
        case "conflict":
            return localeStore.text("gui.patch.conflict")
        default:
            return patch.status
        }
    }

    var taskCount: Int {
        snapshot?.tasks.count ?? 0
    }

    var roleCount: Int {
        snapshot?.roles.count ?? 0
    }

    var extensionCount: Int {
        snapshot?.extensions?.extensions?.count ?? 0
    }

    var enabledExtensionCount: Int {
        snapshot?.extensions?.extensions?.filter { $0.enabled == true }.count ?? 0
    }

    var extensionStateDisplay: String {
        return localeStore.text("gui.extensions.countLabel", extensionCount, enabledExtensionCount)
    }

    var registrySourceCount: Int {
        snapshot?.registrySources?.sources?.count ?? 0
    }

    var registryEntryCount: Int {
        snapshot?.registryCatalog?.entries?.count ?? 0
    }

    var reviewedRegistryEntryCount: Int {
        snapshot?.registryCatalog?.entries?.filter {
            ($0.reviewStatus == "reviewed" || $0.reviewStatus == "trusted") || $0.verifiedSource == true
        }.count ?? 0
    }

    var registryStateDisplay: String {
        localeStore.text("gui.registry.countLabel", registryEntryCount, reviewedRegistryEntryCount)
    }

    var hasPendingPatch: Bool {
        snapshot?.pendingPatch?.status == "pending"
    }

    var pendingPatchSummaryDisplay: String {
        guard let patch = snapshot?.pendingPatch else {
            return localeStore.text("gui.patch.noPending")
        }
        return patch.summary ?? localeStore.text("gui.patch.noPending")
    }

    var sessionStatusDisplay: String {
        if sessionIsRunning {
            return localeStore.text("gui.session.running")
        }
        return localeStore.text("gui.session.idle")
    }

    var appVersionDisplay: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String
        switch (version, build) {
        case let (version?, build?):
            return "\(version) (\(build))"
        case let (version?, nil):
            return version
        default:
            return localeStore.text("gui.common.notSet")
        }
    }

    var bundleIdentifierDisplay: String {
        Bundle.main.bundleIdentifier ?? localeStore.text("gui.common.notSet")
    }

    var releaseNotesPathDisplay: String {
        let root = engineBridge.engineRoot
        return root.appendingPathComponent("RELEASE_NOTES.md").path
    }

    func setProjectRoot(_ url: URL) {
        selectedProjectRoot = url
        UserDefaults.standard.set(url.path, forKey: "localcodex.projectRoot")
        selectedTaskId = snapshot?.state?.currentTaskId
        selectedRoleName = snapshot?.state?.activeRole
        Task { await refreshSnapshot() }
    }

    func chooseProjectFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.prompt = localeStore.text("gui.project.chooseButton")
        panel.message = localeStore.text("gui.project.chooseMessage")
        if panel.runModal() == .OK, let url = panel.url {
            setProjectRoot(url)
        }
    }

    func refreshSnapshot() async {
        guard let root = selectedProjectRoot else {
            snapshot = nil
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            snapshot = try WorkspaceSnapshot.load(projectRoot: root)
            selectedTaskId = snapshot?.state?.currentTaskId
            selectedRoleName = snapshot?.state?.activeRole
            if selectedRegistryId == nil {
                selectedRegistryId = snapshot?.registryCatalog?.entries?.first?.id
            }
        } catch {
            console.append(ConsoleEntry(kind: .error, text: localeStore.text("gui.errors.snapshotFailed", error.localizedDescription)))
        }
    }

    func appendConsole(_ text: String, kind: ConsoleEntry.Kind = .output) {
        let chunks = text
            .split(omittingEmptySubsequences: false, whereSeparator: \.isNewline)
            .map(String.init)
        for chunk in chunks {
            guard !chunk.isEmpty else { continue }
            console.append(ConsoleEntry(kind: kind, text: chunk))
        }
        sessionOutputText = console.map(\.text).joined(separator: "\n")
    }

    func runCLI(_ arguments: [String], refreshAfter: Bool = true) async {
        guard selectedProjectRoot != nil || arguments.first == "help" else {
            appendConsole(localeStore.text("gui.errors.chooseProjectFirst"), kind: .error)
            return
        }
        guard let root = selectedProjectRoot else { return }
        appendConsole("> app \(arguments.joined(separator: " "))", kind: .command)
        do {
            let result = try await commandRunner.runCLI(arguments: arguments, currentDirectory: root, environment: [:])
            if !result.stdout.isEmpty {
                appendConsole(result.stdout, kind: .output)
            }
            if !result.stderr.isEmpty {
                appendConsole(result.stderr, kind: .error)
            }
            if result.exitCode != 0 {
                appendConsole(localeStore.text("gui.errors.commandFailed", String(result.exitCode)), kind: .error)
            }
        } catch {
            appendConsole(localeStore.text("gui.errors.commandFailed", error.localizedDescription), kind: .error)
        }
        if refreshAfter {
            await refreshSnapshot()
        }
    }

    func initializeWorkspace() async {
        await runCLI(["project", "init"])
    }

    func refreshWorkspace() async {
        await runCLI(["project", "refresh"])
    }

    func inspectPrompt() async {
        var args = ["prompt", "inspect"]
        if !promptRoleOverride.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            args += ["--role", promptRoleOverride]
        }
        if !promptInstruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            args += ["--task", promptInstruction]
        }
        await runCLI(args, refreshAfter: false)
        selectedSection = .prompt
    }

    func inspectDiff() async {
        await runCLI(["diff"], refreshAfter: false)
        selectedSection = .patches
    }

    func patchStatus() async {
        await runCLI(["patch", "status"], refreshAfter: false)
        selectedSection = .patches
    }

    func applyPatch() async {
        await runCLI(["patch", "apply"])
        selectedSection = .patches
    }

    func rejectPatch() async {
        await runCLI(["patch", "reject"])
        selectedSection = .patches
    }

    func createTask() async {
        var args = ["task", "create", "--title", taskTitle]
        if !taskRequest.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            args += ["--request", taskRequest]
        }
        await runCLI(args)
        taskTitle = ""
        taskRequest = ""
        selectedSection = .tasks
    }

    func useTask(_ taskId: String) async {
        await runCLI(["task", "use", taskId])
        selectedTaskId = taskId
        selectedSection = .tasks
    }

    func archiveTask(_ taskId: String) async {
        await runCLI(["task", "archive", taskId])
    }

    func useRole(_ roleName: String) async {
        await runCLI(["roles", "use", roleName])
        selectedRoleName = roleName
        selectedSection = .roles
    }

    func inspectRole(_ roleName: String) async {
        await runCLI(["roles", "show", roleName], refreshAfter: false)
        selectedSection = .roles
    }

    func scaffoldRoles() async {
        roleActionMessage = nil
        await runCLI(["roles", "scaffold"])
        await refreshSnapshot()
        if roleCount > 0 {
            roleActionMessage = localeStore.text("gui.roles.scaffoldSuccess", roleCount)
        } else {
            roleActionMessage = localeStore.text("gui.roles.scaffoldWarning")
        }
        selectedSection = .roles
    }

    func installExtension() async {
        let source = extensionSourceInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !source.isEmpty else {
            appendConsole(localeStore.text("gui.errors.extensionSourceMissing"), kind: .error)
            return
        }
        var args = ["extensions", "install", source, "--yes"]
        if !extensionPathInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            args += ["--path", extensionPathInput]
        }
        if !extensionRefInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            args += ["--ref", extensionRefInput]
        }
        await runCLI(args)
        selectedSection = .extensions
    }

    func refreshExtensions() async {
        await runCLI(["extensions", "doctor"])
        selectedSection = .extensions
    }

    func refreshRegistry() async {
        await runCLI(["registry", "refresh"])
        selectedSection = .registry
    }

    func inspectExtension(_ extensionId: String) async {
        selectedExtensionId = extensionId
        await runCLI(["extensions", "inspect", extensionId], refreshAfter: false)
        selectedSection = .extensions
    }

    func enableExtension(_ extensionId: String) async {
        await runCLI(["extensions", "enable", extensionId, "--yes"])
        selectedSection = .extensions
    }

    func disableExtension(_ extensionId: String) async {
        await runCLI(["extensions", "disable", extensionId])
        selectedSection = .extensions
    }

    func updateExtension(_ extensionId: String) async {
        await runCLI(["extensions", "update", extensionId, "--yes"])
        selectedSection = .extensions
    }

    func removeExtension(_ extensionId: String) async {
        await runCLI(["extensions", "remove", extensionId, "--yes"])
        selectedSection = .extensions
    }

    func inspectRegistryEntry(_ entryId: String) async {
        selectedRegistryId = entryId
        await runCLI(["registry", "show", entryId], refreshAfter: false)
        selectedSection = .registry
    }

    func installRegistryEntry(_ entryId: String) async {
        await runCLI(["registry", "install", entryId, "--yes"])
        selectedSection = .registry
    }

    func startSession(with request: String) async {
        guard let root = selectedProjectRoot else {
            appendConsole(localeStore.text("gui.errors.chooseProjectFirst"), kind: .error)
            return
        }
        guard !sessionIsRunning else {
            sendSessionInput(request)
            return
        }

        let model = snapshot?.state?.selectedModel ?? "qwen2.5-coder:14b"
        let role = snapshot?.state?.activeRole ?? ""
        let arguments = ["start", root.path, "--model", model] + (role.isEmpty ? [] : ["--role", role])

        let process = Process()
        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        let stdinPipe = Pipe()
        let stdoutBuffer = OutputAccumulator()
        let stderrBuffer = OutputAccumulator()

        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["node", engineBridge.cliURL.path] + arguments
        process.currentDirectoryURL = engineBridge.engineRoot
        process.standardInput = stdinPipe
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe
        process.environment = ProcessInfo.processInfo.environment.merging(["LOCAL_CODEX_ENGINE_ROOT": engineBridge.engineRoot.path], uniquingKeysWith: { _, new in new })

        stdoutPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            guard let self else { return }
            stdoutBuffer.append(handle.availableData)
            let chunk = stdoutBuffer.drain()
            Task { @MainActor in
                if !chunk.isEmpty {
                    self.appendConsole(chunk, kind: .output)
                }
            }
        }
        stderrPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            guard let self else { return }
            stderrBuffer.append(handle.availableData)
            let chunk = stderrBuffer.drain()
            Task { @MainActor in
                if !chunk.isEmpty {
                    self.appendConsole(chunk, kind: .error)
                }
            }
        }

        process.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async {
                stdoutPipe.fileHandleForReading.readabilityHandler = nil
                stderrPipe.fileHandleForReading.readabilityHandler = nil
                self?.sessionIsRunning = false
                let statusText = self?.localeStore.text("gui.session.exited", proc.terminationStatus) ?? "Exited: \(proc.terminationStatus)"
                self?.sessionProcessStatus = statusText
                self?.appendConsole(statusText, kind: .info)
            }
        }

        do {
            try process.run()
            sessionProcess = process
            sessionInputPipe = stdinPipe
            sessionIsRunning = true
            sessionProcessStatus = localeStore.text("gui.session.running")
            appendConsole(localeStore.text("gui.session.started"), kind: .info)
            if !request.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                sendSessionInput(request)
            }
        } catch {
            appendConsole(localeStore.text("gui.errors.commandFailed", error.localizedDescription), kind: .error)
        }
    }

    func sendSessionInput(_ text: String) {
        guard let inputPipe = sessionInputPipe else { return }
        let line = text.hasSuffix("\n") ? text : "\(text)\n"
        if let data = line.data(using: .utf8) {
            inputPipe.fileHandleForWriting.write(data)
            appendConsole("> \(text)", kind: .command)
        }
    }

    func stopSession() {
        sessionProcess?.terminate()
        sessionProcess = nil
        sessionInputPipe = nil
        sessionIsRunning = false
        sessionProcessStatus = localeStore.text("gui.session.stopped")
    }
}
