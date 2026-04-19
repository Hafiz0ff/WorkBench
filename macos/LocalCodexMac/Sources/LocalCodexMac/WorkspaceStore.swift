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

enum WorkspaceInspectorTab: String, CaseIterable, Identifiable {
    case task
    case role
    case context
    case patch
    case logs
    case advanced

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
    @Published var projectComposerText: String = ""
    @Published var taskNoteText: String = ""
    @Published var taskNoteKind: String = "finding"
    @Published var sessionInput: String = ""
    @Published var sessionOutputText: String = ""
    @Published var sessionIsRunning = false
    @Published var sessionProcessStatus: String = ""
    @Published var modelOverrideInput: String = ""
    @Published var extensionSourceInput: String = ""
    @Published var extensionPathInput: String = ""
    @Published var extensionRefInput: String = ""
    let localeStore = LocalizationStore()
    @Published var isLoading = false
    @Published var selectedTaskId: String?
    @Published var taskActionMessage: String?
    @Published var selectedRoleName: String?
    @Published var selectedInspectorTab: WorkspaceInspectorTab = .task
    @Published var selectedExtensionId: String?
    @Published var selectedRegistryId: String?
    @Published var roleActionMessage: String?
    @Published var isProjectBootstrapping = false
    @Published var projectLaunchMessages: [String] = []
    @Published var projectLaunchBannerVisible = false
    @Published var projectComposerFocusToken: UUID?
    @Published var isProjectComposerSubmitting = false

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
            self.projectComposerFocusToken = UUID()
        } else if !storedProjectRoot.isEmpty {
            self.selectedProjectRoot = URL(fileURLWithPath: storedProjectRoot)
            self.projectComposerFocusToken = UUID()
        }
        localeStore.objectWillChange
            .sink { [weak self] _ in
                self?.objectWillChange.send()
            }
            .store(in: &cancellables)
        NotificationCenter.default.publisher(for: .workbenchOpenProject)
            .compactMap { $0.object as? URL }
            .sink { [weak self] url in
                Task { @MainActor in
                    await self?.openProjectRoot(url)
                }
            }
            .store(in: &cancellables)
    }

    static func resolveEngineRoot(override: String) -> URL? {
        let trimmed = override.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return URL(fileURLWithPath: trimmed)
    }

    static func resolveBundledEngineRoot(
        bundleURL: URL? = Bundle.main.bundleURL,
        resourceURL: URL? = Bundle.main.resourceURL
    ) -> URL? {
        if let resourceURL {
            let marker = resourceURL.appendingPathComponent("engine-root.txt")
            if let rawPath = try? String(contentsOf: marker, encoding: .utf8) {
                let trimmed = rawPath.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty {
                    let url = URL(fileURLWithPath: trimmed)
                    if FileManager.default.fileExists(atPath: url.path) {
                        return url
                    }
                }
            }
        }

        if let bundleURL, let resolved = boundedEngineRootSearch(startingAt: bundleURL) {
            return resolved
        }
        if let resourcesParent = resourceURL?.deletingLastPathComponent(),
           let resolved = boundedEngineRootSearch(startingAt: resourcesParent) {
            return resolved
        }

        return nil
    }

    private static func boundedEngineRootSearch(startingAt url: URL, maxDepth: Int = 8) -> URL? {
        let fm = FileManager.default
        var current = url.standardizedFileURL
        var remaining = maxDepth
        while remaining >= 0 {
            let cliCandidate = current.appendingPathComponent("src/cli.js")
            if fm.fileExists(atPath: cliCandidate.path) {
                return current
            }
            let parent = current.deletingLastPathComponent()
            if parent.path == current.path {
                break
            }
            current = parent
            remaining -= 1
        }
        return nil
    }

    var engineRootDisplay: String {
        engineBridge.engineRoot.path
    }

    var projectRootDisplay: String {
        selectedProjectRoot?.path ?? localeStore.text("gui.project.noProjectSelected")
    }

    var projectNameDisplay: String {
        selectedProjectRoot?.lastPathComponent ?? localeStore.text("gui.project.noProjectSelected")
    }

    var currentRoleDisplay: String {
        snapshot?.state?.activeRole ?? localeStore.text("gui.common.notSet")
    }

    var currentProviderDisplay: String {
        snapshot?.providers?.active
            ?? snapshot?.providers?.default
            ?? localeStore.text("gui.common.notSet")
    }

    var currentProviderName: String? {
        snapshot?.providers?.active
            ?? snapshot?.providers?.default
            ?? snapshot?.providers?.fallback
    }

    var currentModelDisplay: String {
        if let model = snapshot?.state?.selectedModel, !model.isEmpty {
            return model
        }
        if let provider = currentProviderName,
           let model = snapshot?.providers?.providers?[provider]?.model ?? snapshot?.providers?.providers?[provider]?.defaultModel,
           !model.isEmpty {
            return model
        }
        return localeStore.text("gui.common.notSet")
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

    var currentTaskEntry: TaskIndexEntry? {
        guard let taskId = selectedTaskId ?? snapshot?.state?.currentTaskId else {
            return nil
        }
        return snapshot?.tasks.first(where: { $0.id == taskId })
    }

    var currentTaskRequestDisplay: String {
        let request = currentTaskEntry?.userRequest?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return request.isEmpty ? localeStore.text("gui.common.notSet") : request
    }

    var currentTaskFilesDisplay: String {
        guard let files = currentTaskEntry?.relevantFiles, !files.isEmpty else {
            return localeStore.text("gui.common.notSet")
        }
        return files.prefix(3).joined(separator: ", ")
    }

    var currentTaskNotesDisplay: String {
        guard let notes = currentTaskEntry?.lastRunNotes, !notes.isEmpty else {
            return localeStore.text("gui.common.notSet")
        }
        return localeStore.text("gui.workspace.notesCount", notes.count)
    }

    var diagnosticsSummaryDisplay: String {
        guard !console.isEmpty else {
            return localeStore.text("gui.common.notSet")
        }
        let errorCount = console.filter { $0.kind == .error }.count
        return localeStore.text("gui.workspace.diagnosticsSummary", console.count, errorCount)
    }

    var sessionOutputExcerptDisplay: String {
        let lines = sessionOutputText
            .split(whereSeparator: \.isNewline)
            .prefix(4)
            .map(String.init)
        guard !lines.isEmpty else {
            return localeStore.text("gui.common.notSet")
        }
        return lines.joined(separator: "\n")
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
        let defaults = UserDefaults.standard
        if let override = defaults.string(forKey: "localcodex.appVersionOverride")?.trimmingCharacters(in: .whitespacesAndNewlines),
           !override.isEmpty {
            return override
        }
        if let envOverride = ProcessInfo.processInfo.environment["LOCAL_CODEX_APP_VERSION"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !envOverride.isEmpty {
            return envOverride
        }
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

    func chooseProjectFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.prompt = localeStore.text("gui.project.chooseButton")
        panel.message = localeStore.text("gui.project.chooseMessage")
        if panel.runModal() == .OK, let url = panel.url {
            Task { await openProjectRoot(url) }
        }
    }

    func openProjectRoot(_ url: URL) async {
        let normalizedURL = url.standardizedFileURL
        selectedProjectRoot = normalizedURL
        requestProjectComposerFocus()
        UserDefaults.standard.set(normalizedURL.path, forKey: "localcodex.projectRoot")
        selectedTaskId = snapshot?.state?.currentTaskId
        selectedRoleName = snapshot?.state?.activeRole
        selectedSection = .project
        isProjectBootstrapping = true
        projectComposerText = ""
        projectLaunchMessages = []
        projectLaunchBannerVisible = true
        defer { isProjectBootstrapping = false }

        await runCLI(["project", "init"])
        await runCLI(["roles", "scaffold"])
        if roleCount > 0 {
            roleActionMessage = localeStore.text("gui.roles.scaffoldSuccess", roleCount)
        } else {
            roleActionMessage = localeStore.text("gui.roles.scaffoldWarning")
        }
        projectLaunchMessages = [
            localeStore.text("gui.project.bannerLoaded"),
            localeStore.text("gui.project.bannerMemoryReady"),
            localeStore.text("gui.project.bannerRolesReady"),
        ]
        selectedSection = .project
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
            if modelOverrideInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                modelOverrideInput = currentModelDisplay
            }
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
        selectedInspectorTab = .context
        selectedSection = .project
    }

    func inspectDiff() async {
        await runCLI(["diff"], refreshAfter: false)
        selectedInspectorTab = .patch
        selectedSection = .project
    }

    func patchStatus() async {
        await runCLI(["patch", "status"], refreshAfter: false)
        selectedInspectorTab = .patch
        selectedSection = .project
    }

    func applyPatch() async {
        await runCLI(["patch", "apply"])
        selectedInspectorTab = .patch
        selectedSection = .project
    }

    func rejectPatch() async {
        await runCLI(["patch", "reject"])
        selectedInspectorTab = .patch
        selectedSection = .project
    }

    func createTask() async -> TaskIndexEntry? {
        let previousTaskIds = Set(snapshot?.tasks.map(\.id) ?? [])
        var args = ["task", "create", "--title", taskTitle]
        if !taskRequest.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            args += ["--request", taskRequest]
        }
        await runCLI(args)
        let createdTask = snapshot?.tasks.first(where: { !previousTaskIds.contains($0.id) })
        if createdTask != nil {
            taskTitle = ""
            taskRequest = ""
        }
        selectedSection = .project
        return createdTask
    }

    func dismissProjectLaunchBanner() {
        projectLaunchBannerVisible = false
    }

    func requestProjectComposerFocus() {
        projectComposerFocusToken = UUID()
    }

    func consumeProjectComposerFocus() {
        projectComposerFocusToken = nil
    }

    func startProjectTask() async {
        guard !isProjectComposerSubmitting else { return }
        let request = projectComposerText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !request.isEmpty else {
            appendConsole(localeStore.text("gui.project.composerEmpty"), kind: .error)
            return
        }

        isProjectComposerSubmitting = true
        defer { isProjectComposerSubmitting = false }

        let generatedTitle = deriveProjectTaskTitle(from: request)
        taskTitle = generatedTitle
        taskRequest = request
        guard let createdTask = await createTask() else {
            appendConsole(localeStore.text("gui.project.taskCreateFailed"), kind: .error)
            return
        }

        if createdTask.id != selectedTaskId {
            await useTask(createdTask.id)
        }

        projectComposerText = ""
        await startSession(with: request)
        selectedInspectorTab = .logs
        selectedSection = .project
    }

    func useTask(_ taskId: String) async {
        await runCLI(["task", "use", taskId])
        selectedTaskId = taskId
        if let task = snapshot?.tasks.first(where: { $0.id == taskId }) {
            taskActionMessage = localeStore.text("gui.tasks.activatedMessage", task.title)
        } else {
            taskActionMessage = localeStore.text("gui.tasks.activatedMessage", taskId)
        }
        selectedInspectorTab = .task
        selectedSection = .project
    }

    func archiveTask(_ taskId: String) async {
        await runCLI(["task", "archive", taskId])
    }

    func useRole(_ roleName: String) async {
        await runCLI(["roles", "use", roleName])
        selectedRoleName = roleName
        roleActionMessage = localeStore.text("gui.roles.activatedMessage", roleName)
        selectedInspectorTab = .role
        selectedSection = .project
    }

    func inspectRole(_ roleName: String) async {
        await runCLI(["roles", "show", roleName], refreshAfter: false)
        selectedRoleName = roleName
        roleActionMessage = localeStore.text("gui.roles.shownMessage", roleName)
        selectedInspectorTab = .role
        selectedSection = .project
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
        selectedInspectorTab = .role
        selectedSection = .project
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
        selectedInspectorTab = .advanced
        selectedSection = .project
    }

    func refreshExtensions() async {
        await runCLI(["extensions", "doctor"])
        selectedInspectorTab = .advanced
        selectedSection = .project
    }

    func refreshRegistry() async {
        await runCLI(["registry", "refresh"])
        selectedInspectorTab = .advanced
        selectedSection = .project
    }

    func inspectExtension(_ extensionId: String) async {
        selectedExtensionId = extensionId
        await runCLI(["extensions", "inspect", extensionId], refreshAfter: false)
        selectedInspectorTab = .advanced
        selectedSection = .project
    }

    func enableExtension(_ extensionId: String) async {
        await runCLI(["extensions", "enable", extensionId, "--yes"])
        selectedInspectorTab = .advanced
        selectedSection = .project
    }

    func disableExtension(_ extensionId: String) async {
        await runCLI(["extensions", "disable", extensionId])
        selectedInspectorTab = .advanced
        selectedSection = .project
    }

    func updateExtension(_ extensionId: String) async {
        await runCLI(["extensions", "update", extensionId, "--yes"])
        selectedInspectorTab = .advanced
        selectedSection = .project
    }

    func removeExtension(_ extensionId: String) async {
        await runCLI(["extensions", "remove", extensionId, "--yes"])
        selectedInspectorTab = .advanced
        selectedSection = .project
    }

    func inspectRegistryEntry(_ entryId: String) async {
        selectedRegistryId = entryId
        await runCLI(["registry", "show", entryId], refreshAfter: false)
        selectedInspectorTab = .advanced
        selectedSection = .project
    }

    func installRegistryEntry(_ entryId: String) async {
        await runCLI(["registry", "install", entryId, "--yes"])
        selectedInspectorTab = .advanced
        selectedSection = .project
    }

    func applyModelOverride() async {
        let model = modelOverrideInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !model.isEmpty else {
            appendConsole(localeStore.text("gui.errors.modelMissing"), kind: .error)
            return
        }
        guard let provider = currentProviderName else {
            appendConsole(localeStore.text("gui.errors.providerMissing"), kind: .error)
            return
        }
        await runCLI(["provider", "use", provider, "--model", model])
        modelOverrideInput = model
        selectedInspectorTab = .context
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

    private func deriveProjectTaskTitle(from request: String) -> String {
        let firstLine = request
            .split(whereSeparator: \.isNewline)
            .first?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: #"[.!?…]+$"#, with: "", options: .regularExpression)
        guard let firstLine, !firstLine.isEmpty else {
            return localeStore.text("gui.project.defaultTaskTitle")
        }
        let words = firstLine.split(whereSeparator: \.isWhitespace)
        return String(words.prefix(8).joined(separator: " ").prefix(64))
    }
}
