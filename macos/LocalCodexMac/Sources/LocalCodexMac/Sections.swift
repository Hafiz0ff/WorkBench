import SwiftUI

struct ProjectView: View {
    @EnvironmentObject private var store: WorkspaceStore
    @State private var composerFocused = false
    @State private var composerAutofocusTask: Task<Void, Never>?
    let compact: Bool

    init(compact: Bool = false) {
        self.compact = compact
    }

    var body: some View {
        SectionShell(title: store.localeStore.text("gui.project.title"), compact: compact) {
            VStack(alignment: .leading, spacing: compact ? 10 : 14) {
                if store.selectedProjectRoot != nil {
                    if !compact, store.projectLaunchBannerVisible, !store.projectLaunchMessages.isEmpty {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: "checkmark.seal.fill")
                                .foregroundStyle(.green)
                                .font(.title3)
                                .padding(.top, 1)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(store.localeStore.text("gui.project.loaded"))
                                    .font(.headline)
                                ForEach(store.projectLaunchMessages, id: \.self) { message in
                                    Text(message)
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Spacer(minLength: 12)
                            Button(store.localeStore.text("gui.project.bannerDismiss")) {
                                store.dismissProjectLaunchBanner()
                            }
                            .buttonStyle(.intent(.text))
                            .foregroundStyle(.secondary)
                        }
                        .padding(12)
                        .glassSurface(
                            cornerRadius: 14,
                            material: .ultraThinMaterial,
                            tint: Color.primary.opacity(0.02),
                            border: Color.primary.opacity(0.10),
                            shadowRadius: 8
                        )
                        .transition(.move(edge: .top).combined(with: .opacity))
                        .animation(IntentMotion.reveal, value: store.projectLaunchBannerVisible)
                    }

                    VStack(alignment: .leading, spacing: compact ? 10 : 12) {
                        ZStack(alignment: .topLeading) {
                            ProjectComposerTextView(
                                text: $store.projectComposerText,
                                isFocused: composerFocused,
                                onSubmit: {
                                    Task { await store.startProjectTask() }
                                }
                            )
                            .frame(minHeight: compact ? 116 : 130)
                            .glassSurface(
                                cornerRadius: 8,
                                material: .ultraThinMaterial,
                                tint: Color.primary.opacity(0.01),
                                border: Color.primary.opacity(0.10),
                                shadowRadius: 0,
                                shadowY: 0
                            )
                            if store.projectComposerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                Text(store.localeStore.text("gui.project.composerPlaceholder"))
                                    .foregroundStyle(.secondary)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 12)
                                    .allowsHitTesting(false)
                            }
                        }
                        .contentShape(Rectangle())
                        .onTapGesture {
                            composerFocused = true
                            store.requestProjectComposerFocus()
                        }
                    }
                } else {
                    EmptyStateView(
                        title: store.localeStore.text("gui.project.empty"),
                        message: store.localeStore.text("gui.project.emptyHint"),
                        systemImage: "folder"
                    )
                }
            }
        }
        .onAppear {
            scheduleComposerAutofocus()
        }
        .onChange(of: store.projectComposerFocusToken) { _, _ in
            scheduleComposerAutofocus()
        }
        .onChange(of: store.isProjectBootstrapping) { _, _ in
            scheduleComposerAutofocus()
        }
        .onDisappear {
            cancelComposerAutofocus()
        }
    }

    private func scheduleComposerAutofocus() {
        composerAutofocusTask?.cancel()
        guard store.selectedProjectRoot != nil,
              !store.isProjectBootstrapping,
              store.projectComposerFocusToken != nil else {
            return
        }

        composerAutofocusTask = Task { @MainActor in
            defer {
                composerAutofocusTask = nil
            }

            try? await Task.sleep(nanoseconds: 140_000_000)
            guard !Task.isCancelled else { return }
            guard store.selectedProjectRoot != nil,
                  !store.isProjectBootstrapping,
                  store.projectComposerFocusToken != nil else {
                return
            }

            composerFocused = true
            store.consumeProjectComposerFocus()
        }
    }

    private func cancelComposerAutofocus() {
        composerAutofocusTask?.cancel()
        composerAutofocusTask = nil
        composerFocused = false
        if store.projectComposerFocusToken != nil {
            store.consumeProjectComposerFocus()
        }
    }
}

private struct QuickActionButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .frame(maxWidth: .infinity, alignment: .leading)
                .lineLimit(2)
        }
        .buttonStyle(.intent(.secondary))
    }
}

struct TasksView: View {
    @EnvironmentObject private var store: WorkspaceStore

    var body: some View {
        SectionShell(title: store.localeStore.text("gui.tasks.title")) {
            VStack(alignment: .leading, spacing: 14) {
                if store.snapshot?.tasks.isEmpty ?? true {
                    EmptyStateView(
                        title: store.localeStore.text("gui.tasks.empty"),
                        message: store.localeStore.text("gui.tasks.emptyHint"),
                        systemImage: "list.bullet.rectangle",
                        primaryActionTitle: store.localeStore.text("gui.sidebar.project"),
                        primaryAction: {
                            store.selectedSection = .project
                            store.requestProjectComposerFocus()
                        }
                    )
                }

                GroupBox(store.localeStore.text("gui.tasks.list")) {
                    if let tasks = store.snapshot?.tasks, !tasks.isEmpty {
                        if let message = store.taskActionMessage {
                            HStack(spacing: 8) {
                                Image(systemName: "checkmark.seal")
                                Text(message)
                            }
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .padding(.bottom, 4)
                        }
                        LazyVStack(alignment: .leading, spacing: 10) {
                            ForEach(tasks) { task in
                                TaskCardView(
                                    task: task,
                                    isSelected: task.id == store.selectedTaskId || task.id == store.snapshot?.state?.currentTaskId,
                                    onUse: {
                                        Task { await store.useTask(task.id) }
                                    },
                                    onArchive: {
                                        Task { await store.archiveTask(task.id) }
                                    }
                                )
                            }
                        }
                        if let selectedTask = selectedTaskSnapshot {
                            GroupBox(store.localeStore.text("gui.tasks.details")) {
                                VStack(alignment: .leading, spacing: 8) {
                                    keyValueRow(store.localeStore.text("gui.tasks.name"), selectedTask.title)
                                    keyValueRow(store.localeStore.text("gui.task.status"), selectedTask.status)
                                    keyValueRow(store.localeStore.text("gui.task.role"), selectedTask.role ?? store.localeStore.text("gui.common.notSet"))
                                    keyValueRow(store.localeStore.text("gui.task.model"), selectedTask.model ?? store.localeStore.text("gui.common.notSet"))
                                    keyValueRow(store.localeStore.text("gui.task.summary"), selectedTask.summary ?? store.localeStore.text("gui.common.notSet"))
                                    keyValueRow(store.localeStore.text("gui.tasks.request"), selectedTask.userRequest ?? store.localeStore.text("gui.common.notSet"))
                                    keyValueRow(store.localeStore.text("gui.tasks.files"), selectedTask.relevantFiles?.joined(separator: ", ") ?? store.localeStore.text("gui.common.notSet"))
                                    if let notes = selectedTask.lastRunNotes, !notes.isEmpty {
                                        keyValueRow(store.localeStore.text("gui.tasks.notes"), "\(notes.count)")
                                    }
                                }
                            }
                        }
                    } else {
                        EmptyStateView(
                            title: store.localeStore.text("gui.tasks.empty"),
                            message: store.localeStore.text("gui.tasks.emptyHint"),
                            systemImage: "list.bullet.rectangle",
                            primaryActionTitle: nil,
                            primaryAction: nil
                        )
                    }
                }
            }
        }
        .animation(IntentMotion.selection, value: store.selectedTaskId)
    }

    private var selectedTaskSnapshot: TaskIndexEntry? {
        let tasks = store.snapshot?.tasks ?? []
        if let selectedId = store.selectedTaskId {
            return tasks.first(where: { $0.id == selectedId })
        }
        return tasks.first(where: { $0.id == store.snapshot?.state?.currentTaskId }) ?? tasks.first
    }
}

private struct TaskCardView: View {
    @EnvironmentObject private var store: WorkspaceStore
    let task: TaskIndexEntry
    let isSelected: Bool
    let onUse: () -> Void
    let onArchive: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(task.title)
                        .font(.headline)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Text(task.id)
                        .foregroundStyle(.secondary)
                        .font(.caption)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer()
                if isSelected {
                    Text(store.localeStore.text("gui.tasks.currentBadge"))
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Color.accentColor)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .glassSurface(
                            cornerRadius: 999,
                            material: .ultraThinMaterial,
                            tint: Color.accentColor.opacity(0.04),
                            border: Color.accentColor.opacity(0.22),
                            borderWidth: 0.9,
                            shadowColor: .clear,
                            shadowRadius: 0,
                            shadowY: 0
                        )
                        .clipShape(Capsule())
                }
            }

            keyValueRow(store.localeStore.text("gui.task.status"), task.status)
            keyValueRow(store.localeStore.text("gui.task.role"), task.role ?? store.localeStore.text("gui.common.notSet"))
            keyValueRow(store.localeStore.text("gui.task.model"), task.model ?? store.localeStore.text("gui.common.notSet"))
            keyValueRow(store.localeStore.text("gui.task.summary"), task.summary ?? store.localeStore.text("gui.common.notSet"))

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) {
                    Button(store.localeStore.text("gui.tasks.use"), action: onUse)
                        .buttonStyle(.intent(.secondary))
                    Button(store.localeStore.text("gui.tasks.archive"), action: onArchive)
                        .buttonStyle(.intent(.danger))
                    Spacer()
                }
                VStack(alignment: .leading, spacing: 8) {
                    Button(store.localeStore.text("gui.tasks.use"), action: onUse)
                        .buttonStyle(.intent(.secondary))
                    Button(store.localeStore.text("gui.tasks.archive"), action: onArchive)
                        .buttonStyle(.intent(.danger))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .glassSurface(
            cornerRadius: 14,
            material: .ultraThinMaterial,
            tint: isSelected ? Color.accentColor.opacity(0.05) : Color.primary.opacity(0.015),
            border: isSelected ? Color.accentColor.opacity(0.28) : Color.primary.opacity(0.10),
            shadowRadius: 8
        )
    }
}

struct RolesView: View {
    @EnvironmentObject private var store: WorkspaceStore
    @State private var filterText = ""

    var body: some View {
        SectionShell(title: store.localeStore.text("gui.roles.title")) {
            VStack(alignment: .leading, spacing: 14) {
                ViewThatFits(in: .horizontal) {
                    HStack {
                        Spacer(minLength: 12)
                        TextField(store.localeStore.text("gui.roles.filterPlaceholder"), text: $filterText)
                            .textFieldStyle(.roundedBorder)
                            .frame(minWidth: 180, idealWidth: 220, maxWidth: 280, alignment: .trailing)
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        TextField(store.localeStore.text("gui.roles.filterPlaceholder"), text: $filterText)
                            .textFieldStyle(.roundedBorder)
                    }
                }

                if let message = store.roleActionMessage {
                    HStack(spacing: 8) {
                        Image(systemName: store.roleCount > 0 ? "checkmark.seal" : "exclamationmark.triangle")
                        Text(message)
                    }
                    .font(.callout)
                    .foregroundStyle(store.roleCount > 0 ? .green : .orange)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .glassSurface(
                        cornerRadius: 12,
                        material: .ultraThinMaterial,
                        tint: Color.primary.opacity(0.02),
                        border: Color.primary.opacity(0.10),
                        shadowRadius: 6
                    )
                }

                let roles = store.snapshot?.roles ?? []
                let visibleRoles = filterText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    ? roles
                    : roles.filter { $0.name.localizedCaseInsensitiveContains(filterText) || $0.description.localizedCaseInsensitiveContains(filterText) }

                if !visibleRoles.isEmpty {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        ForEach(visibleRoles) { role in
                            RoleCardView(
                                role: role,
                                isSelected: role.name == store.selectedRoleName,
                                onActivate: {
                                    Task { await store.useRole(role.name) }
                                },
                                onInspect: {
                                    Task { await store.inspectRole(role.name) }
                                }
                            )
                        }
                    }
                } else {
                    EmptyStateView(
                        title: store.localeStore.text("gui.roles.empty"),
                        message: store.localeStore.text("gui.roles.emptyHint"),
                        systemImage: "person.2",
                        primaryActionTitle: nil,
                        primaryAction: nil
                    )
                }

                if let selectedRole = selectedRoleSnapshot {
                    GroupBox(store.localeStore.text("gui.roles.details")) {
                        VStack(alignment: .leading, spacing: 10) {
                            keyValueRow(store.localeStore.text("gui.roles.name"), selectedRole.name)
                            keyValueRow(store.localeStore.text("gui.roles.file"), selectedRole.fileURL.path)
                            keyValueRow(store.localeStore.text("gui.roles.description"), selectedRole.description)
                            TextEditor(text: .constant(selectedRole.rawContent))
                                .font(.system(.body, design: .monospaced))
                                .frame(minHeight: 220)
                                .glassSurface(
                                    cornerRadius: 8,
                                    material: .ultraThinMaterial,
                                    tint: Color.primary.opacity(0.01),
                                    border: Color.primary.opacity(0.10),
                                    shadowRadius: 0,
                                    shadowY: 0
                                )
                                .disabled(true)
                        }
                    }
                }
            }
        }
        .animation(IntentMotion.selection, value: store.selectedRoleName)
    }

    private var selectedRoleSnapshot: RoleFileSnapshot? {
        let roles = store.snapshot?.roles ?? []
        if let selectedName = store.selectedRoleName {
            return roles.first(where: { $0.name == selectedName })
        }
        return roles.first(where: { $0.name == store.snapshot?.state?.activeRole }) ?? roles.first
    }
}

private struct RoleCardView: View {
    @EnvironmentObject private var store: WorkspaceStore
    let role: RoleFileSnapshot
    let isSelected: Bool
    let onActivate: () -> Void
    let onInspect: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(role.name)
                .font(.headline)
                .lineLimit(1)
                .truncationMode(.tail)
            Text(role.description)
                .foregroundStyle(.secondary)
                .font(.subheadline)
                .lineLimit(2)
                .truncationMode(.tail)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) {
                    Button(store.localeStore.text("gui.roles.use"), action: onActivate)
                        .buttonStyle(.intent(.secondary))
                    Button(store.localeStore.text("gui.roles.inspect"), action: onInspect)
                        .buttonStyle(.intent(.text))
                    Spacer()
                }
                VStack(alignment: .leading, spacing: 8) {
                    Button(store.localeStore.text("gui.roles.use"), action: onActivate)
                        .buttonStyle(.intent(.secondary))
                    Button(store.localeStore.text("gui.roles.inspect"), action: onInspect)
                        .buttonStyle(.intent(.text))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .glassSurface(
            cornerRadius: 14,
            material: .ultraThinMaterial,
            tint: isSelected ? Color.accentColor.opacity(0.05) : Color.primary.opacity(0.015),
            border: isSelected ? Color.accentColor.opacity(0.28) : Color.primary.opacity(0.10),
            shadowRadius: 8
        )
        .overlay(alignment: .topTrailing) {
            if isSelected {
                Text(store.localeStore.text("gui.roles.selectedBadge"))
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .glassSurface(
                        cornerRadius: 999,
                        material: .ultraThinMaterial,
                        tint: Color.accentColor.opacity(0.04),
                        border: Color.accentColor.opacity(0.22),
                        borderWidth: 0.9,
                        shadowColor: .clear,
                        shadowRadius: 0,
                        shadowY: 0
                    )
                    .padding(8)
            }
        }
    }
}

struct ExtensionsView: View {
    @EnvironmentObject private var store: WorkspaceStore
    @State private var filterText = ""

    var body: some View {
        SectionShell(title: store.localeStore.text("gui.extensions.title")) {
            VStack(alignment: .leading, spacing: 14) {
                StatusRibbon(items: [
                    .init(label: store.localeStore.text("gui.extensions.total"), value: "\(store.extensionCount)", tint: .blue, symbol: "puzzlepiece.extension"),
                    .init(label: store.localeStore.text("gui.extensions.enabled"), value: "\(store.enabledExtensionCount)", tint: .green, symbol: "checkmark.seal"),
                    .init(label: store.localeStore.text("gui.extensions.state"), value: store.extensionStateDisplay, tint: .orange, symbol: "shippingbox"),
                ])

                GroupBox(store.localeStore.text("gui.extensions.install")) {
                    VStack(alignment: .leading, spacing: 10) {
                        TextField(store.localeStore.text("gui.extensions.sourcePlaceholder"), text: $store.extensionSourceInput)
                        ViewThatFits(in: .horizontal) {
                            HStack {
                                TextField(store.localeStore.text("gui.extensions.pathPlaceholder"), text: $store.extensionPathInput)
                                TextField(store.localeStore.text("gui.extensions.refPlaceholder"), text: $store.extensionRefInput)
                            }
                            VStack(alignment: .leading, spacing: 8) {
                                TextField(store.localeStore.text("gui.extensions.pathPlaceholder"), text: $store.extensionPathInput)
                                TextField(store.localeStore.text("gui.extensions.refPlaceholder"), text: $store.extensionRefInput)
                            }
                        }
                        ViewThatFits(in: .horizontal) {
                            HStack {
                                Button {
                                    Task { await store.installExtension() }
                                } label: {
                                    Label(store.localeStore.text("gui.extensions.installButton"), systemImage: "arrow.down.circle")
                                }
                                .buttonStyle(.intent(.primary))
                                Text(store.localeStore.text("gui.extensions.installHint"))
                                    .foregroundStyle(.secondary)
                            }
                            VStack(alignment: .leading, spacing: 8) {
                                Button {
                                    Task { await store.installExtension() }
                                } label: {
                                    Label(store.localeStore.text("gui.extensions.installButton"), systemImage: "arrow.down.circle")
                                }
                                .buttonStyle(.intent(.primary))
                                Text(store.localeStore.text("gui.extensions.installHint"))
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Label(store.localeStore.text("gui.extensions.rawGitHubWarning"), systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                    }
                }

                HStack {
                    TextField(store.localeStore.text("gui.extensions.filterPlaceholder"), text: $filterText)
                        .textFieldStyle(.roundedBorder)
                    Spacer()
                    Button {
                        Task { await store.refreshExtensions() }
                    } label: {
                        Label(store.localeStore.text("gui.extensions.doctor"), systemImage: "stethoscope")
                    }
                }

                let extensions = store.snapshot?.extensions?.extensions ?? []
                let visibleExtensions = filterText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    ? extensions
                    : extensions.filter {
                        $0.name?.localizedCaseInsensitiveContains(filterText) == true
                        || $0.id.localizedCaseInsensitiveContains(filterText)
                        || $0.type?.localizedCaseInsensitiveContains(filterText) == true
                    }

                if !visibleExtensions.isEmpty {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        ForEach(visibleExtensions, id: \.id) { entry in
                            ExtensionCardView(
                                entry: entry,
                                isSelected: entry.id == store.selectedExtensionId,
                                onInspect: {
                                    Task { await store.inspectExtension(entry.id) }
                                },
                                onEnable: {
                                    Task { await store.enableExtension(entry.id) }
                                },
                                onDisable: {
                                    Task { await store.disableExtension(entry.id) }
                                },
                                onUpdate: {
                                    Task { await store.updateExtension(entry.id) }
                                },
                                onRemove: {
                                    Task { await store.removeExtension(entry.id) }
                                },
                                sourceLabel: extensionSourceLabel(entry)
                            )
                        }
                    }
                } else {
                    EmptyStateView(
                        title: store.localeStore.text("gui.extensions.empty"),
                        message: store.localeStore.text("gui.extensions.emptyHint"),
                        systemImage: "puzzlepiece.extension",
                        primaryActionTitle: nil,
                        primaryAction: nil
                    )
                }

                if let selected = selectedExtension {
                    GroupBox(store.localeStore.text("gui.extensions.details")) {
                        VStack(alignment: .leading, spacing: 8) {
                            keyValueRow(store.localeStore.text("gui.extensions.name"), selected.name ?? selected.id)
                            keyValueRow(store.localeStore.text("gui.extensions.id"), selected.id)
                            keyValueRow(store.localeStore.text("gui.extensions.type"), selected.type ?? store.localeStore.text("gui.common.notSet"))
                            keyValueRow(store.localeStore.text("gui.extensions.status"), selected.enabled == true ? store.localeStore.text("gui.extensions.statusEnabled") : store.localeStore.text("gui.extensions.statusDisabled"))
                            keyValueRow(store.localeStore.text("gui.extensions.manifestPath"), selected.manifestPath ?? store.localeStore.text("gui.common.notSet"))
                            keyValueRow(store.localeStore.text("gui.extensions.installPath"), selected.installPath ?? store.localeStore.text("gui.common.notSet"))
                            keyValueRow(store.localeStore.text("gui.extensions.source"), selected.source?.url ?? selected.source?.repo ?? store.localeStore.text("gui.common.notSet"))
                            keyValueRow(store.localeStore.text("gui.extensions.installSourceType"), selected.installSourceType ?? store.localeStore.text("gui.common.notSet"))
                            keyValueRow(store.localeStore.text("gui.extensions.publisher"), selected.publisher ?? store.localeStore.text("gui.common.notSet"))
                            keyValueRow(store.localeStore.text("gui.extensions.verifiedSource"), selected.verifiedSource == true ? store.localeStore.text("gui.common.yes") : selected.verifiedSource == false ? store.localeStore.text("gui.common.no") : store.localeStore.text("gui.common.notSet"))
                            keyValueRow(store.localeStore.text("gui.extensions.supportedAppVersions"), selected.supportedAppVersions?.joined(separator: ", ") ?? store.localeStore.text("gui.common.notSet"))
                            keyValueRow(store.localeStore.text("gui.extensions.lastCheckedAt"), selected.lastCheckedAt ?? store.localeStore.text("gui.common.notSet"))
                            keyValueRow(store.localeStore.text("gui.extensions.capabilities"), selected.capabilities?.joined(separator: ", ") ?? store.localeStore.text("gui.common.notSet"))
                            if let warnings = selected.warnings, !warnings.isEmpty {
                                keyValueRow(store.localeStore.text("gui.extensions.warnings"), warnings.joined(separator: ", "))
                            }
                        }
                    }
                }
            }
        }
        .animation(IntentMotion.selection, value: store.selectedExtensionId)
    }

    private var selectedExtension: ExtensionRegistryEntry? {
        let extensions = store.snapshot?.extensions?.extensions ?? []
        if let selectedId = store.selectedExtensionId {
            return extensions.first(where: { $0.id == selectedId })
        }
        return extensions.first
    }

    private func extensionSourceLabel(_ entry: ExtensionRegistryEntry) -> String {
        if entry.installSourceType == "registry" {
            return "\(store.localeStore.text("gui.extensions.sourceRegistry")): \(entry.registrySourceLabel ?? entry.registrySourceLocation ?? store.localeStore.text("gui.common.notSet"))"
        }
        return store.localeStore.text("gui.extensions.sourceGitHub")
    }
}

struct RegistryView: View {
    @EnvironmentObject private var store: WorkspaceStore
    @State private var filterText = ""

    var body: some View {
        SectionShell(title: store.localeStore.text("gui.registry.title")) {
            VStack(alignment: .leading, spacing: 14) {
                StatusRibbon(items: [
                    .init(label: store.localeStore.text("gui.registry.total"), value: "\(store.registryEntryCount)", tint: .blue, symbol: "book.closed"),
                    .init(label: store.localeStore.text("gui.registry.reviewed"), value: "\(store.reviewedRegistryEntryCount)", tint: .green, symbol: "checkmark.seal"),
                    .init(label: store.localeStore.text("gui.registry.sources"), value: "\(store.registrySourceCount)", tint: .orange, symbol: "shippingbox"),
                    .init(label: store.localeStore.text("gui.registry.state"), value: store.registryStateDisplay, tint: .purple, symbol: "checklist"),
                ])

                ViewThatFits(in: .horizontal) {
                    HStack {
                        Button {
                            Task { await store.refreshRegistry() }
                        } label: {
                            Label(store.localeStore.text("gui.registry.refresh"), systemImage: "arrow.clockwise")
                        }
                        Spacer(minLength: 12)
                        TextField(store.localeStore.text("gui.registry.filterPlaceholder"), text: $filterText)
                            .textFieldStyle(.roundedBorder)
                            .frame(minWidth: 180, idealWidth: 240, maxWidth: 320, alignment: .trailing)
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Button {
                            Task { await store.refreshRegistry() }
                        } label: {
                            Label(store.localeStore.text("gui.registry.refresh"), systemImage: "arrow.clockwise")
                        }
                        TextField(store.localeStore.text("gui.registry.filterPlaceholder"), text: $filterText)
                            .textFieldStyle(.roundedBorder)
                    }
                }

                let entries = store.snapshot?.registryCatalog?.entries ?? []
                let visibleEntries = filterText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    ? entries
                    : entries.filter {
                        ($0.name ?? "").localizedCaseInsensitiveContains(filterText)
                        || $0.id.localizedCaseInsensitiveContains(filterText)
                        || ($0.reviewStatus ?? "").localizedCaseInsensitiveContains(filterText)
                        || ($0.registrySourceLabel ?? "").localizedCaseInsensitiveContains(filterText)
                    }

                if !visibleEntries.isEmpty {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        ForEach(visibleEntries, id: \.id) { entry in
                            RegistryCardView(
                                entry: entry,
                                isSelected: entry.id == store.selectedRegistryId,
                                onInspect: {
                                    Task { await store.inspectRegistryEntry(entry.id) }
                                },
                                onInstall: {
                                    Task { await store.installRegistryEntry(entry.id) }
                                },
                                trustLabel: registryTrustLabel(entry),
                                trustTint: registryTrustColor(entry)
                            )
                        }
                    }
                } else {
                    EmptyStateView(
                        title: store.localeStore.text("gui.registry.empty"),
                        message: store.localeStore.text("gui.registry.emptyHint"),
                        systemImage: "shippingbox",
                        primaryActionTitle: store.localeStore.text("gui.registry.refresh"),
                        primaryAction: { Task { await store.refreshRegistry() } }
                    )
                }

                if let selected = selectedRegistry {
                    GroupBox(store.localeStore.text("gui.registry.details")) {
                        VStack(alignment: .leading, spacing: 8) {
                            keyValueRow(store.localeStore.text("gui.registry.name"), selected.name ?? selected.id)
                            keyValueRow(store.localeStore.text("gui.registry.id"), selected.id)
                            keyValueRow(store.localeStore.text("gui.registry.type"), selected.type ?? store.localeStore.text("gui.common.notSet"))
                            keyValueRow(store.localeStore.text("gui.registry.publisher"), selected.publisher ?? store.localeStore.text("gui.common.notSet"))
                            keyValueRow(store.localeStore.text("gui.registry.reviewStatus"), selected.reviewStatus ?? store.localeStore.text("gui.common.notSet"))
                            keyValueRow(store.localeStore.text("gui.registry.verifiedSource"), selected.verifiedSource == true ? store.localeStore.text("gui.common.yes") : selected.verifiedSource == false ? store.localeStore.text("gui.common.no") : store.localeStore.text("gui.common.notSet"))
                            keyValueRow(store.localeStore.text("gui.registry.trustLevel"), selected.trustLevel ?? store.localeStore.text("gui.common.notSet"))
                            keyValueRow(store.localeStore.text("gui.registry.sourceLocation"), selected.registrySourceLocation ?? store.localeStore.text("gui.common.notSet"))
                            keyValueRow(store.localeStore.text("gui.registry.manifestPath"), selected.manifestPath ?? store.localeStore.text("gui.common.notSet"))
                            keyValueRow(store.localeStore.text("gui.registry.supportedAppVersions"), selected.supportedAppVersions?.joined(separator: ", ") ?? store.localeStore.text("gui.common.notSet"))
                            keyValueRow(store.localeStore.text("gui.registry.installNotes"), selected.installNotes ?? store.localeStore.text("gui.common.notSet"))
                            keyValueRow(store.localeStore.text("gui.registry.validationStatus"), selected.validationStatus ?? store.localeStore.text("gui.common.notSet"))
                            if let issues = selected.validationIssues, !issues.isEmpty {
                                keyValueRow(store.localeStore.text("gui.registry.validationIssues"), issues.joined(separator: ", "))
                            }
                        }
                    }
                }
            }
        }
        .animation(IntentMotion.selection, value: store.selectedRegistryId)
    }

    private var selectedRegistry: RegistryCatalogEntryFile? {
        let entries = store.snapshot?.registryCatalog?.entries ?? []
        if let selectedId = store.selectedRegistryId {
            return entries.first(where: { $0.id == selectedId })
        }
        return entries.first
    }

    private func registryTrustLabel(_ entry: RegistryCatalogEntryFile) -> String {
        if entry.recommended == true {
            return store.localeStore.text("gui.registry.recommended")
        }
        if entry.reviewStatus == "reviewed" || entry.reviewStatus == "trusted" || entry.verifiedSource == true {
            return store.localeStore.text("gui.registry.reviewed")
        }
        return store.localeStore.text("gui.registry.experimental")
    }

    private func registryTrustColor(_ entry: RegistryCatalogEntryFile) -> Color {
        if entry.recommended == true {
            return .green
        }
        if entry.reviewStatus == "reviewed" || entry.reviewStatus == "trusted" || entry.verifiedSource == true {
            return .blue
        }
        return .orange
    }
}

private struct ExtensionCardView: View {
    @EnvironmentObject private var store: WorkspaceStore
    let entry: ExtensionRegistryEntry
    let isSelected: Bool
    let onInspect: () -> Void
    let onEnable: () -> Void
    let onDisable: () -> Void
    let onUpdate: () -> Void
    let onRemove: () -> Void
    let sourceLabel: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Button(entry.name ?? entry.id, action: onInspect)
                        .buttonStyle(.intent(.text))
                        .font(.headline)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Text(entry.id)
                        .foregroundStyle(.secondary)
                        .font(.caption)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 6) {
                    Text(entry.enabled == true ? store.localeStore.text("gui.extensions.statusEnabled") : store.localeStore.text("gui.extensions.statusDisabled"))
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .glassSurface(
                            cornerRadius: 999,
                            material: .ultraThinMaterial,
                            tint: entry.enabled == true ? Color.green.opacity(0.05) : Color.secondary.opacity(0.04),
                            border: entry.enabled == true ? Color.green.opacity(0.18) : Color.secondary.opacity(0.14),
                            borderWidth: 0.9,
                            shadowColor: .clear,
                            shadowRadius: 0,
                            shadowY: 0
                        )
                        .clipShape(Capsule())
                    if isSelected {
                        Text(store.localeStore.text("gui.extensions.selectedBadge"))
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Color.accentColor)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .glassSurface(
                                cornerRadius: 999,
                                material: .ultraThinMaterial,
                                tint: Color.accentColor.opacity(0.04),
                                border: Color.accentColor.opacity(0.22),
                                borderWidth: 0.9,
                                shadowColor: .clear,
                                shadowRadius: 0,
                                shadowY: 0
                            )
                            .clipShape(Capsule())
                    }
                }
            }

            keyValueRow(store.localeStore.text("gui.extensions.type"), entry.type ?? store.localeStore.text("gui.common.notSet"))
            keyValueRow(store.localeStore.text("gui.extensions.source"), sourceLabel)
            keyValueRow(store.localeStore.text("gui.extensions.trust"), entry.reviewStatus ?? entry.trustLevel ?? store.localeStore.text("gui.common.notSet"))
            keyValueRow(store.localeStore.text("gui.extensions.installSourceType"), entry.installSourceType ?? store.localeStore.text("gui.common.notSet"))
            keyValueRow(store.localeStore.text("gui.extensions.capabilities"), entry.capabilities?.joined(separator: ", ") ?? store.localeStore.text("gui.common.notSet"))

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) {
                    Button(store.localeStore.text("gui.extensions.enable"), action: onEnable)
                        .buttonStyle(.intent(.secondary))
                    Button(store.localeStore.text("gui.extensions.disable"), action: onDisable)
                        .buttonStyle(.intent(.danger))
                    Button(store.localeStore.text("gui.extensions.update"), action: onUpdate)
                        .buttonStyle(.intent(.secondary))
                    Button(store.localeStore.text("gui.extensions.remove"), action: onRemove)
                        .buttonStyle(.intent(.danger))
                    Spacer()
                }
                VStack(alignment: .leading, spacing: 8) {
                    Button(store.localeStore.text("gui.extensions.enable"), action: onEnable)
                        .buttonStyle(.intent(.secondary))
                    Button(store.localeStore.text("gui.extensions.disable"), action: onDisable)
                        .buttonStyle(.intent(.danger))
                    Button(store.localeStore.text("gui.extensions.update"), action: onUpdate)
                        .buttonStyle(.intent(.secondary))
                    Button(store.localeStore.text("gui.extensions.remove"), action: onRemove)
                        .buttonStyle(.intent(.danger))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .glassSurface(
            cornerRadius: 14,
            material: .ultraThinMaterial,
            tint: isSelected ? Color.accentColor.opacity(0.05) : Color.primary.opacity(0.015),
            border: isSelected ? Color.accentColor.opacity(0.28) : Color.primary.opacity(0.10),
            shadowRadius: 8
        )
    }
}

private struct RegistryCardView: View {
    @EnvironmentObject private var store: WorkspaceStore
    let entry: RegistryCatalogEntryFile
    let isSelected: Bool
    let onInspect: () -> Void
    let onInstall: () -> Void
    let trustLabel: String
    let trustTint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Button(entry.name ?? entry.id, action: onInspect)
                        .buttonStyle(.intent(.text))
                        .font(.headline)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Text(entry.id)
                        .foregroundStyle(.secondary)
                        .font(.caption)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 6) {
                    Text(trustLabel)
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .glassSurface(
                            cornerRadius: 999,
                            material: .ultraThinMaterial,
                            tint: trustTint.opacity(0.05),
                            border: trustTint.opacity(0.20),
                            borderWidth: 0.9,
                            shadowColor: .clear,
                            shadowRadius: 0,
                            shadowY: 0
                        )
                        .clipShape(Capsule())
                    if isSelected {
                        Text(store.localeStore.text("gui.registry.selectedBadge"))
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Color.accentColor)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .glassSurface(
                                cornerRadius: 999,
                                material: .ultraThinMaterial,
                                tint: Color.accentColor.opacity(0.04),
                                border: Color.accentColor.opacity(0.22),
                                borderWidth: 0.9,
                                shadowColor: .clear,
                                shadowRadius: 0,
                                shadowY: 0
                            )
                            .clipShape(Capsule())
                    }
                }
            }

            keyValueRow(store.localeStore.text("gui.registry.publisher"), entry.publisher ?? store.localeStore.text("gui.common.notSet"))
            keyValueRow(store.localeStore.text("gui.registry.reviewStatus"), entry.reviewStatus ?? store.localeStore.text("gui.common.notSet"))
            keyValueRow(store.localeStore.text("gui.registry.source"), entry.registrySourceLabel ?? entry.registrySourceLocation ?? store.localeStore.text("gui.common.notSet"))
            keyValueRow(store.localeStore.text("gui.registry.capabilities"), entry.capabilities?.joined(separator: ", ") ?? store.localeStore.text("gui.common.notSet"))

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) {
                    Button(store.localeStore.text("gui.registry.install"), action: onInstall)
                        .buttonStyle(.intent(.primary))
                    Button(store.localeStore.text("gui.registry.inspect"), action: onInspect)
                        .buttonStyle(.intent(.text))
                    Spacer()
                }
                VStack(alignment: .leading, spacing: 8) {
                    Button(store.localeStore.text("gui.registry.install"), action: onInstall)
                        .buttonStyle(.intent(.primary))
                    Button(store.localeStore.text("gui.registry.inspect"), action: onInspect)
                        .buttonStyle(.intent(.text))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .glassSurface(
            cornerRadius: 14,
            material: .ultraThinMaterial,
            tint: isSelected ? Color.accentColor.opacity(0.05) : Color.primary.opacity(0.015),
            border: isSelected ? Color.accentColor.opacity(0.28) : Color.primary.opacity(0.10),
            shadowRadius: 8
        )
    }
}

struct PromptInspectorView: View {
    @EnvironmentObject private var store: WorkspaceStore

    var body: some View {
        SectionShell(title: store.localeStore.text("gui.prompt.title")) {
            VStack(alignment: .leading, spacing: 14) {
                GroupBox(store.localeStore.text("gui.prompt.inputs")) {
                    VStack(alignment: .leading, spacing: 10) {
                        TextField(store.localeStore.text("gui.prompt.rolePlaceholder"), text: $store.promptRoleOverride)
                            .textFieldStyle(.roundedBorder)
                        TextEditor(text: $store.promptInstruction)
                            .frame(minHeight: 110)
                            .glassSurface(
                                cornerRadius: 8,
                                material: .ultraThinMaterial,
                                tint: Color.primary.opacity(0.01),
                                border: Color.primary.opacity(0.10),
                                shadowRadius: 0,
                                shadowY: 0
                            )
                    }
                }
                ViewThatFits(in: .horizontal) {
                    HStack {
                        Button {
                            Task { await store.inspectPrompt() }
                        } label: {
                            Label(store.localeStore.text("gui.prompt.inspect"), systemImage: "wand.and.stars")
                        }
                        .buttonStyle(.intent(.primary))
                        Text(store.localeStore.text("gui.prompt.hint"))
                            .foregroundStyle(.secondary)
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Button {
                            Task { await store.inspectPrompt() }
                        } label: {
                            Label(store.localeStore.text("gui.prompt.inspect"), systemImage: "wand.and.stars")
                        }
                        .buttonStyle(.intent(.primary))
                        Text(store.localeStore.text("gui.prompt.hint"))
                            .foregroundStyle(.secondary)
                    }
                }
                GroupBox(store.localeStore.text("gui.prompt.output")) {
                    if store.console.isEmpty {
                        EmptyStateView(
                            title: store.localeStore.text("gui.prompt.empty"),
                            message: store.localeStore.text("gui.prompt.emptyHint"),
                            systemImage: "wand.and.stars",
                            primaryActionTitle: store.localeStore.text("gui.prompt.inspect"),
                            primaryAction: { Task { await store.inspectPrompt() } }
                        )
                    } else {
                        TextEditor(text: .constant(store.console.map { $0.text }.joined(separator: "\n")))
                            .font(.system(.body, design: .monospaced))
                            .frame(minHeight: 300)
                            .glassSurface(
                                cornerRadius: 8,
                                material: .ultraThinMaterial,
                                tint: Color.primary.opacity(0.01),
                                border: Color.primary.opacity(0.10),
                                shadowRadius: 0,
                                shadowY: 0
                            )
                            .disabled(true)
                    }
                }
            }
        }
        .animation(IntentMotion.selection, value: store.currentPatchStatusDisplay)
    }
}

struct PatchesView: View {
    @EnvironmentObject private var store: WorkspaceStore

    var body: some View {
        SectionShell(title: store.localeStore.text("gui.patch.title")) {
            VStack(alignment: .leading, spacing: 14) {
                StatusRibbon(items: [
                    .init(label: store.localeStore.text("gui.patch.status"), value: store.currentPatchStatusDisplay, tint: store.hasPendingPatch ? .red : .green, symbol: "doc.on.doc"),
                    .init(label: store.localeStore.text("gui.patch.approvalMode"), value: store.approvalModeDisplay, tint: .purple, symbol: "shield"),
                    .init(label: store.localeStore.text("gui.patch.validation"), value: store.snapshot?.pendingPatch?.validationStatus ?? store.localeStore.text("gui.common.notSet"), tint: .teal, symbol: "checkmark.seal"),
                ])

                keyValueRow(store.localeStore.text("gui.patch.status"), store.currentPatchStatusDisplay)
                keyValueRow(store.localeStore.text("gui.patch.summary"), store.pendingPatchSummaryDisplay)
                keyValueRow(store.localeStore.text("gui.patch.approvalMode"), store.approvalModeDisplay)
                keyValueRow(store.localeStore.text("gui.patch.validation"), store.snapshot?.pendingPatch?.validationStatus ?? store.localeStore.text("gui.common.notSet"))

                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) {
                        Button {
                            Task { await store.inspectDiff() }
                        } label: {
                            Label(store.localeStore.text("gui.patch.inspectDiff"), systemImage: "doc.plaintext")
                        }
                        .buttonStyle(.intent(.secondary))
                        Button {
                            Task { await store.patchStatus() }
                        } label: {
                            Label(store.localeStore.text("gui.patch.statusButton"), systemImage: "arrow.triangle.2.circlepath")
                        }
                        .buttonStyle(.intent(.secondary))
                        Button {
                            Task { await store.applyPatch() }
                        } label: {
                            Label(store.localeStore.text("gui.patch.apply"), systemImage: "checkmark.circle")
                        }
                        .buttonStyle(.intent(.primary))
                        Button {
                            Task { await store.rejectPatch() }
                        } label: {
                            Label(store.localeStore.text("gui.patch.reject"), systemImage: "xmark.circle")
                        }
                        .buttonStyle(.intent(.danger))
                        Spacer()
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 12) {
                            Button {
                                Task { await store.inspectDiff() }
                            } label: {
                                Label(store.localeStore.text("gui.patch.inspectDiff"), systemImage: "doc.plaintext")
                            }
                            .buttonStyle(.intent(.secondary))
                            Button {
                                Task { await store.patchStatus() }
                            } label: {
                                Label(store.localeStore.text("gui.patch.statusButton"), systemImage: "arrow.triangle.2.circlepath")
                            }
                            .buttonStyle(.intent(.secondary))
                        }
                        HStack(spacing: 12) {
                            Button {
                                Task { await store.applyPatch() }
                            } label: {
                                Label(store.localeStore.text("gui.patch.apply"), systemImage: "checkmark.circle")
                            }
                            .buttonStyle(.intent(.primary))
                            Button {
                                Task { await store.rejectPatch() }
                            } label: {
                                Label(store.localeStore.text("gui.patch.reject"), systemImage: "xmark.circle")
                            }
                            .buttonStyle(.intent(.danger))
                        }
                    }
                }

                GroupBox(store.localeStore.text("gui.patch.diff")) {
                    if let diff = store.snapshot?.pendingPatch?.diffText, !diff.isEmpty {
                        TextEditor(text: .constant(diff))
                            .font(.system(.body, design: .monospaced))
                            .frame(minHeight: 320)
                            .glassSurface(
                                cornerRadius: 8,
                                material: .ultraThinMaterial,
                                tint: Color.primary.opacity(0.01),
                                border: Color.primary.opacity(0.10),
                                shadowRadius: 0,
                                shadowY: 0
                            )
                            .disabled(true)
                    } else {
                        EmptyStateView(
                            title: store.localeStore.text("gui.patch.noPending"),
                            message: store.localeStore.text("gui.patch.noPendingHint"),
                            systemImage: "doc.on.doc",
                            primaryActionTitle: store.localeStore.text("gui.patch.statusButton"),
                            primaryAction: { Task { await store.patchStatus() } }
                        )
                    }
                }
            }
        }
        .animation(IntentMotion.selection, value: store.sessionIsRunning)
    }
}

struct PolicyView: View {
    @EnvironmentObject private var store: WorkspaceStore

    var body: some View {
        SectionShell(title: store.localeStore.text("gui.policy.title")) {
            VStack(alignment: .leading, spacing: 14) {
                StatusRibbon(items: [
                    .init(label: store.localeStore.text("gui.policy.approvalMode"), value: store.approvalModeDisplay, tint: .purple, symbol: "shield.lefthalf.filled"),
                    .init(label: store.localeStore.text("gui.policy.allowedCommands"), value: store.snapshot?.policy?.allowedCommands?.count.description ?? store.localeStore.text("gui.common.notSet"), tint: .blue, symbol: "terminal"),
                    .init(label: store.localeStore.text("gui.policy.blockedCommands"), value: store.snapshot?.policy?.blockedCommands?.count.description ?? store.localeStore.text("gui.common.notSet"), tint: .red, symbol: "nosign"),
                ])

                keyValueRow(store.localeStore.text("gui.policy.approvalMode"), store.approvalModeDisplay)
                keyValueRow(store.localeStore.text("gui.policy.file"), policyPath)
                keyValueRow(store.localeStore.text("gui.policy.allowedCommands"), store.snapshot?.policy?.allowedCommands?.joined(separator: ", ") ?? store.localeStore.text("gui.common.notSet"))
                keyValueRow(store.localeStore.text("gui.policy.blockedCommands"), store.snapshot?.policy?.blockedCommands?.joined(separator: ", ") ?? store.localeStore.text("gui.common.notSet"))

                TextEditor(text: .constant(policyJSON))
                    .font(.system(.body, design: .monospaced))
                    .frame(minHeight: 360)
                    .glassSurface(
                        cornerRadius: 8,
                        material: .ultraThinMaterial,
                        tint: Color.primary.opacity(0.01),
                        border: Color.primary.opacity(0.10),
                        shadowRadius: 0,
                        shadowY: 0
                    )
                    .disabled(true)
            }
        }
    }

    private var policyJSON: String {
        guard let snapshot = store.snapshot else {
            return store.localeStore.text("gui.common.notSet")
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let policy = snapshot.policy, let data = try? encoder.encode(policy), let text = String(data: data, encoding: .utf8) {
            return text
        }
        return store.localeStore.text("gui.common.notSet")
    }

    private var policyPath: String {
        guard let projectRoot = store.selectedProjectRoot else {
            return store.localeStore.text("gui.common.notSet")
        }
        return projectRoot
            .appendingPathComponent(".local-codex", isDirectory: true)
            .appendingPathComponent("policy.json")
            .path
    }
}

struct SessionView: View {
    @EnvironmentObject private var store: WorkspaceStore

    var body: some View {
        SectionShell(title: store.localeStore.text("gui.session.title")) {
            VStack(alignment: .leading, spacing: 14) {
                StatusRibbon(items: [
                    .init(label: store.localeStore.text("gui.session.model"), value: store.currentModelDisplay, tint: .teal, symbol: "cpu"),
                    .init(label: store.localeStore.text("gui.session.role"), value: store.currentRoleDisplay, tint: .blue, symbol: "person.fill"),
                    .init(label: store.localeStore.text("gui.session.task"), value: store.currentTaskSummaryDisplay, tint: .orange, symbol: "checkmark.circle"),
                    .init(label: store.localeStore.text("gui.session.approvalMode"), value: store.approvalModeDisplay, tint: .purple, symbol: "shield.checkered"),
                    .init(label: store.localeStore.text("gui.session.status"), value: store.sessionStatusDisplay, tint: store.sessionIsRunning ? .green : .secondary, symbol: store.sessionIsRunning ? "play.fill" : "pause.fill"),
                ])

                TextField(store.localeStore.text("gui.session.inputPlaceholder"), text: $store.sessionInput)
                    .textFieldStyle(.roundedBorder)

                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) {
                        Button {
                            let request = store.sessionInput
                            Task { await store.startSession(with: request) }
                        } label: {
                            Label(store.localeStore.text("gui.session.start"), systemImage: "play.circle")
                        }
                        .buttonStyle(.intent(.primary))
                        Button {
                            store.sendSessionInput(store.sessionInput)
                        } label: {
                            Label(store.localeStore.text("gui.session.send"), systemImage: "arrow.up.circle")
                        }
                        .buttonStyle(.intent(.secondary))
                        Button {
                            store.stopSession()
                        } label: {
                            Label(store.localeStore.text("gui.session.stop"), systemImage: "stop.circle")
                        }
                        .buttonStyle(.intent(.danger))
                        Spacer()
                        Text(store.sessionProcessStatus.isEmpty ? store.localeStore.text("gui.session.idle") : store.sessionProcessStatus)
                            .foregroundStyle(.secondary)
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 12) {
                            Button {
                                let request = store.sessionInput
                                Task { await store.startSession(with: request) }
                            } label: {
                                Label(store.localeStore.text("gui.session.start"), systemImage: "play.circle")
                            }
                            .buttonStyle(.intent(.primary))
                            Button {
                                store.sendSessionInput(store.sessionInput)
                            } label: {
                                Label(store.localeStore.text("gui.session.send"), systemImage: "arrow.up.circle")
                            }
                            .buttonStyle(.intent(.secondary))
                        }
                        HStack(spacing: 12) {
                            Button {
                                store.stopSession()
                            } label: {
                                Label(store.localeStore.text("gui.session.stop"), systemImage: "stop.circle")
                            }
                            .buttonStyle(.intent(.danger))
                            Text(store.sessionProcessStatus.isEmpty ? store.localeStore.text("gui.session.idle") : store.sessionProcessStatus)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 160, maximum: 240), spacing: 12)], spacing: 12) {
                    Button {
                        Task { await store.inspectPrompt() }
                    } label: {
                        Label(store.localeStore.text("gui.session.inspectPrompt"), systemImage: "wand.and.stars")
                    }
                    Button {
                        Task { await store.inspectDiff() }
                    } label: {
                        Label(store.localeStore.text("gui.session.inspectDiff"), systemImage: "doc.plaintext")
                    }
                    Button {
                        Task { await store.applyPatch() }
                    } label: {
                        Label(store.localeStore.text("gui.session.applyPatch"), systemImage: "checkmark.circle")
                    }
                    Button {
                        Task { await store.rejectPatch() }
                    } label: {
                        Label(store.localeStore.text("gui.session.rejectPatch"), systemImage: "xmark.circle")
                    }
                }

                GroupBox(store.localeStore.text("gui.session.output")) {
                    if store.sessionOutputText.isEmpty {
                        EmptyStateView(
                            title: store.localeStore.text("gui.session.empty"),
                            message: store.localeStore.text("gui.session.emptyHint"),
                            systemImage: "terminal",
                            primaryActionTitle: store.localeStore.text("gui.session.start"),
                            primaryAction: {
                                let request = store.sessionInput
                                Task { await store.startSession(with: request) }
                            }
                        )
                    } else {
                        ScrollView {
                            TypewriterTextView(
                                text: store.sessionOutputText,
                                isActive: store.sessionIsRunning,
                                font: .system(.body, design: .monospaced)
                            )
                            .padding(8)
                        }
                        .frame(minHeight: 260)
                        .glassSurface(
                            cornerRadius: 8,
                            material: .ultraThinMaterial,
                            tint: Color.primary.opacity(0.015),
                            border: Color.primary.opacity(0.10),
                            shadowRadius: 8
                        )
                    }
                }
            }
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject private var store: WorkspaceStore
    @EnvironmentObject private var localeStore: LocalizationStore

    var body: some View {
        SectionShell(title: store.localeStore.text("gui.settings.title")) {
            Form {
                Picker(store.localeStore.text("gui.settings.language"), selection: $localeStore.locale) {
                    ForEach(AppLocale.allCases) { locale in
                        Text(locale.displayName).tag(locale)
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text(store.localeStore.text("gui.settings.engineRoot"))
                    Text(store.engineRootDisplay)
                        .font(.system(.body, design: .monospaced))
                        .textSelection(.enabled)
                    Text(store.localeStore.text("gui.settings.engineRootHint"))
                        .foregroundStyle(.secondary)
                }

                GroupBox(store.localeStore.text("gui.settings.about")) {
                    VStack(alignment: .leading, spacing: 8) {
                        keyValueRow(store.localeStore.text("gui.settings.productName"), store.localeStore.text("gui.app.title"))
                        keyValueRow(store.localeStore.text("gui.settings.version"), store.appVersionDisplay)
                        keyValueRow(store.localeStore.text("gui.settings.bundleIdentifier"), store.bundleIdentifierDisplay)
                        keyValueRow(store.localeStore.text("gui.settings.releaseNotes"), store.releaseNotesPathDisplay)
                        keyValueRow(store.localeStore.text("gui.settings.helperName"), store.localeStore.text("gui.settings.helperNameValue"))
                        Text(store.localeStore.text("gui.settings.helperHint"))
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .animation(IntentMotion.selection, value: localeStore.locale)
        }
    }
}

struct SectionShell<Content: View>: View {
    let title: String
    var compact: Bool = false
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: compact ? 10 : 14) {
                Text(title)
                    .font(compact ? .headline : .title2.weight(.semibold))
                    .padding(.bottom, compact ? 0 : 2)
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(compact ? 12 : 18)
            .glassSurface(
                cornerRadius: compact ? 18 : 24,
                material: .ultraThinMaterial,
                tint: Color.primary.opacity(compact ? 0.012 : 0.015),
                border: Color.primary.opacity(compact ? 0.08 : 0.10),
                shadowRadius: compact ? 8 : 14
            )
        }
        .scrollContentBackground(.hidden)
        .buttonStyle(.intent(.text))
    }
}

struct StatusChip: View {
    let label: String
    let value: String
    let tint: Color
    let symbol: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(label, systemImage: symbol)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.subheadline.weight(.semibold))
                .lineLimit(2)
                .truncationMode(.tail)
        }
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassSurface(
            cornerRadius: 14,
            material: .ultraThinMaterial,
            tint: tint.opacity(0.04),
            border: tint.opacity(0.22),
            shadowRadius: 8
        )
        .animation(IntentMotion.selection, value: value)
    }
}

struct StatusRibbon: View {
    struct Item {
        let label: String
        let value: String
        let tint: Color
        let symbol: String
    }

    let items: [Item]

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 180, maximum: 260), spacing: 12)], spacing: 12) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                StatusChip(label: item.label, value: item.value, tint: item.tint, symbol: item.symbol)
            }
        }
    }
}

struct EmptyStateView: View {
    let title: String
    let message: String
    let systemImage: String
    var primaryActionTitle: String? = nil
    var primaryAction: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(Color.primary.opacity(0.08))
                    .frame(width: 54, height: 54)
                Image(systemName: systemImage)
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
            VStack(spacing: 4) {
                Text(title)
                    .font(.headline)
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 420)
            }
            if let primaryActionTitle, let primaryAction {
                Button(primaryActionTitle, action: primaryAction)
                    .buttonStyle(.intent(.primary))
            }
        }
        .frame(maxWidth: .infinity, minHeight: 210, alignment: .center)
        .padding(.vertical, 18)
        .padding(.horizontal, 20)
        .glassSurface(
            cornerRadius: 16,
            material: .ultraThinMaterial,
            tint: Color.primary.opacity(0.02),
            border: Color.primary.opacity(0.10),
            shadowRadius: 10
        )
        .animation(IntentMotion.selection, value: primaryActionTitle)
    }
}

private func keyValueRow(_ label: String, _ value: String, compact: Bool = false) -> some View {
    ViewThatFits(in: .horizontal) {
        HStack(alignment: .top, spacing: 12) {
            Text(label)
                .font(compact ? .caption : .subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(minWidth: compact ? 110 : 140, idealWidth: compact ? 140 : 180, maxWidth: compact ? 180 : 220, alignment: .leading)
            Text(value)
                .font(compact ? .caption : .subheadline)
                .lineLimit(2)
                .truncationMode(.tail)
            Spacer()
        }
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(compact ? .caption : .subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(compact ? .caption : .subheadline)
                .lineLimit(3)
                .truncationMode(.tail)
        }
    }
}

private func keyValueInline(label: String, value: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
        Text(label).font(.caption2).foregroundStyle(.secondary)
        Text(value)
            .font(.subheadline.weight(.semibold))
            .lineLimit(1)
            .truncationMode(.tail)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
}
