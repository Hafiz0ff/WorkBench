import SwiftUI

struct ProjectView: View {
    @EnvironmentObject private var store: WorkspaceStore

    var body: some View {
        SectionShell(title: store.localeStore.text("gui.project.title")) {
            VStack(alignment: .leading, spacing: 14) {
                StatusRibbon(items: [
                    .init(label: store.localeStore.text("gui.project.currentRole"), value: store.currentRoleDisplay, tint: .blue, symbol: "person.fill"),
                    .init(label: store.localeStore.text("gui.project.currentModel"), value: store.currentModelDisplay, tint: .teal, symbol: "cpu.fill"),
                    .init(label: store.localeStore.text("gui.project.currentTask"), value: store.currentTaskSummaryDisplay, tint: .orange, symbol: "checklist"),
                    .init(label: store.localeStore.text("gui.project.approvalMode"), value: store.approvalModeDisplay, tint: .purple, symbol: "shield.checkered"),
                    .init(label: store.localeStore.text("gui.project.currentPatch"), value: store.currentPatchStatusDisplay, tint: store.hasPendingPatch ? .red : .secondary, symbol: "doc.on.doc"),
                ])

                keyValueRow(store.localeStore.text("gui.project.root"), store.projectRootDisplay)
                keyValueRow(store.localeStore.text("gui.project.engineRoot"), store.engineRootDisplay)
                keyValueRow(store.localeStore.text("gui.project.memory"), store.snapshot?.memoryExists == true ? store.localeStore.text("gui.common.yes") : store.localeStore.text("gui.common.no"))

                ViewThatFits(in: .horizontal) {
                    HStack {
                        Button {
                            store.chooseProjectFolder()
                        } label: {
                            Label(store.localeStore.text("gui.project.chooseProject"), systemImage: "folder")
                        }
                        Button {
                            Task { await store.initializeWorkspace() }
                        } label: {
                            Label(store.localeStore.text("gui.project.init"), systemImage: "plus.circle")
                        }
                        Button {
                            Task { await store.refreshWorkspace() }
                        } label: {
                            Label(store.localeStore.text("gui.project.refresh"), systemImage: "arrow.clockwise")
                        }
                        Spacer(minLength: 12)
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Button {
                            store.chooseProjectFolder()
                        } label: {
                            Label(store.localeStore.text("gui.project.chooseProject"), systemImage: "folder")
                        }
                        HStack(spacing: 12) {
                            Button {
                                Task { await store.initializeWorkspace() }
                            } label: {
                                Label(store.localeStore.text("gui.project.init"), systemImage: "plus.circle")
                            }
                            Button {
                                Task { await store.refreshWorkspace() }
                            } label: {
                                Label(store.localeStore.text("gui.project.refresh"), systemImage: "arrow.clockwise")
                            }
                        }
                    }
                }

                if let state = store.snapshot?.state {
                    Text("\(store.localeStore.text("gui.project.lastRefresh")): \(state.lastRefreshAt ?? store.localeStore.text("gui.common.notSet"))")
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

struct TasksView: View {
    @EnvironmentObject private var store: WorkspaceStore

    var body: some View {
        SectionShell(title: store.localeStore.text("gui.tasks.title")) {
            VStack(alignment: .leading, spacing: 14) {
                GroupBox(store.localeStore.text("gui.tasks.create")) {
                    VStack(alignment: .leading, spacing: 10) {
                        TextField(store.localeStore.text("gui.tasks.titlePlaceholder"), text: $store.taskTitle)
                        TextField(store.localeStore.text("gui.tasks.requestPlaceholder"), text: $store.taskRequest, axis: .vertical)
                            .lineLimit(4, reservesSpace: true)
                        ViewThatFits(in: .horizontal) {
                            HStack {
                                Button {
                                    Task { await store.createTask() }
                                } label: {
                                    Label(store.localeStore.text("gui.tasks.createButton"), systemImage: "plus")
                                }
                                Spacer(minLength: 12)
                                Text(store.localeStore.text("gui.tasks.createHint"))
                                    .foregroundStyle(.secondary)
                            }
                            VStack(alignment: .leading, spacing: 8) {
                                Button {
                                    Task { await store.createTask() }
                                } label: {
                                    Label(store.localeStore.text("gui.tasks.createButton"), systemImage: "plus")
                                }
                                Text(store.localeStore.text("gui.tasks.createHint"))
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .disabled(store.taskTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }

                GroupBox(store.localeStore.text("gui.tasks.list")) {
                    if let tasks = store.snapshot?.tasks, !tasks.isEmpty {
                        List(tasks, id: \.id) { task in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Text(task.title)
                                        .font(.headline)
                                        .lineLimit(1)
                                        .truncationMode(.tail)
                                    Spacer()
                                    if task.id == store.snapshot?.state?.currentTaskId {
                                        Text(store.localeStore.text("gui.tasks.currentBadge"))
                                            .font(.caption)
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 2)
                                            .background(.quaternary)
                                            .clipShape(Capsule())
                                    }
                                }
                                Text(task.id)
                                    .foregroundStyle(.secondary)
                                    .font(.caption)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                Text("\(store.localeStore.text("gui.task.status")): \(task.status)")
                                    .font(.subheadline)
                                    .lineLimit(1)
                                Text("\(store.localeStore.text("gui.task.role")): \(task.role ?? store.localeStore.text("gui.common.notSet"))")
                                    .font(.subheadline)
                                    .lineLimit(1)
                                Text("\(store.localeStore.text("gui.task.model")): \(task.model ?? store.localeStore.text("gui.common.notSet"))")
                                    .font(.subheadline)
                                    .lineLimit(1)
                                Text("\(store.localeStore.text("gui.task.summary")): \(task.summary ?? store.localeStore.text("gui.common.notSet"))")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                                    .truncationMode(.tail)
                                ViewThatFits(in: .horizontal) {
                                    HStack(spacing: 12) {
                                        Button(store.localeStore.text("gui.tasks.use")) {
                                            Task { await store.useTask(task.id) }
                                        }
                                        Button(store.localeStore.text("gui.tasks.archive")) {
                                            Task { await store.archiveTask(task.id) }
                                        }
                                        Spacer()
                                    }
                                    VStack(alignment: .leading, spacing: 8) {
                                        Button(store.localeStore.text("gui.tasks.use")) {
                                            Task { await store.useTask(task.id) }
                                        }
                                        Button(store.localeStore.text("gui.tasks.archive")) {
                                            Task { await store.archiveTask(task.id) }
                                        }
                                    }
                                }
                            }
                            .padding(.vertical, 6)
                        }
                        .frame(maxWidth: .infinity, alignment: .topLeading)
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
                        Button {
                            Task { await store.scaffoldRoles() }
                        } label: {
                            Label(store.localeStore.text("gui.roles.scaffold"), systemImage: "square.grid.2x2")
                        }
                        Spacer(minLength: 12)
                        TextField(store.localeStore.text("gui.roles.filterPlaceholder"), text: $filterText)
                            .textFieldStyle(.roundedBorder)
                            .frame(minWidth: 180, idealWidth: 220, maxWidth: 280, alignment: .trailing)
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Button {
                            Task { await store.scaffoldRoles() }
                        } label: {
                            Label(store.localeStore.text("gui.roles.scaffold"), systemImage: "square.grid.2x2")
                        }
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
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }

                let roles = store.snapshot?.roles ?? []
                let visibleRoles = filterText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    ? roles
                    : roles.filter { $0.name.localizedCaseInsensitiveContains(filterText) || $0.description.localizedCaseInsensitiveContains(filterText) }

                if !visibleRoles.isEmpty {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        ForEach(visibleRoles) { role in
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
                                        Button(store.localeStore.text("gui.roles.use")) {
                                            Task { await store.useRole(role.name) }
                                        }
                                        Button(store.localeStore.text("gui.roles.inspect")) {
                                            Task { await store.inspectRole(role.name) }
                                        }
                                        Spacer()
                                    }
                                    VStack(alignment: .leading, spacing: 8) {
                                        Button(store.localeStore.text("gui.roles.use")) {
                                            Task { await store.useRole(role.name) }
                                        }
                                        Button(store.localeStore.text("gui.roles.inspect")) {
                                            Task { await store.inspectRole(role.name) }
                                        }
                                    }
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(.quaternary.opacity(0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(.quaternary.opacity(0.7)))
                        }
                    }
                } else {
                    EmptyStateView(
                        title: store.localeStore.text("gui.roles.empty"),
                        message: store.localeStore.text("gui.roles.emptyHint"),
                        systemImage: "person.2",
                        primaryActionTitle: store.localeStore.text("gui.roles.scaffold"),
                        primaryAction: { Task { await store.scaffoldRoles() } }
                    )
                }
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
                                Text(store.localeStore.text("gui.extensions.installHint"))
                                    .foregroundStyle(.secondary)
                            }
                            VStack(alignment: .leading, spacing: 8) {
                                Button {
                                    Task { await store.installExtension() }
                                } label: {
                                    Label(store.localeStore.text("gui.extensions.installButton"), systemImage: "arrow.down.circle")
                                }
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
                    List(visibleExtensions, id: \.id) { entry in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Button {
                                    Task { await store.inspectExtension(entry.id) }
                                } label: {
                                    Text(entry.name ?? entry.id)
                                        .font(.headline)
                                        .lineLimit(1)
                                        .truncationMode(.tail)
                                }
                                .buttonStyle(.plain)
                                Spacer()
                                Text(entry.enabled == true ? store.localeStore.text("gui.extensions.statusEnabled") : store.localeStore.text("gui.extensions.statusDisabled"))
                                    .font(.caption)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(entry.enabled == true ? Color.green.opacity(0.15) : Color.secondary.opacity(0.12))
                                    .clipShape(Capsule())
                            }
                            Text(entry.id)
                                .foregroundStyle(.secondary)
                                .font(.caption)
                                .lineLimit(1)
                                .truncationMode(.middle)
                            Text("\(store.localeStore.text("gui.extensions.type")): \(entry.type ?? store.localeStore.text("gui.common.notSet"))")
                                .font(.subheadline)
                                .lineLimit(1)
                            Text("\(store.localeStore.text("gui.extensions.source")): \(extensionSourceLabel(entry))")
                                .font(.subheadline)
                                .lineLimit(1)
                            Text("\(store.localeStore.text("gui.extensions.trust")): \(entry.reviewStatus ?? entry.trustLevel ?? store.localeStore.text("gui.common.notSet"))")
                                .font(.subheadline)
                                .lineLimit(1)
                            Text("\(store.localeStore.text("gui.extensions.installSourceType")): \(entry.installSourceType ?? store.localeStore.text("gui.common.notSet"))")
                                .font(.subheadline)
                                .lineLimit(1)
                            Text("\(store.localeStore.text("gui.extensions.capabilities")): \(entry.capabilities?.joined(separator: ", ") ?? store.localeStore.text("gui.common.notSet"))")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                            ViewThatFits(in: .horizontal) {
                                HStack(spacing: 12) {
                                    Button(store.localeStore.text("gui.extensions.enable")) {
                                        Task { await store.enableExtension(entry.id) }
                                    }
                                    Button(store.localeStore.text("gui.extensions.disable")) {
                                        Task { await store.disableExtension(entry.id) }
                                    }
                                    Button(store.localeStore.text("gui.extensions.update")) {
                                        Task { await store.updateExtension(entry.id) }
                                    }
                                    Button(store.localeStore.text("gui.extensions.remove")) {
                                        Task { await store.removeExtension(entry.id) }
                                    }
                                    Spacer()
                                }
                                VStack(alignment: .leading, spacing: 8) {
                                    Button(store.localeStore.text("gui.extensions.enable")) {
                                        Task { await store.enableExtension(entry.id) }
                                    }
                                    Button(store.localeStore.text("gui.extensions.disable")) {
                                        Task { await store.disableExtension(entry.id) }
                                    }
                                    Button(store.localeStore.text("gui.extensions.update")) {
                                        Task { await store.updateExtension(entry.id) }
                                    }
                                    Button(store.localeStore.text("gui.extensions.remove")) {
                                        Task { await store.removeExtension(entry.id) }
                                    }
                                }
                            }
                        }
                        .padding(.vertical, 6)
                    }
                    .frame(maxWidth: .infinity, alignment: .topLeading)
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
                    List(visibleEntries, id: \.id) { entry in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Button {
                                    Task { await store.inspectRegistryEntry(entry.id) }
                                } label: {
                                    Text(entry.name ?? entry.id)
                                        .font(.headline)
                                        .lineLimit(1)
                                        .truncationMode(.tail)
                                }
                                .buttonStyle(.plain)
                                Spacer()
                                Text(registryTrustLabel(entry))
                                    .font(.caption)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(registryTrustColor(entry).opacity(0.15))
                                    .clipShape(Capsule())
                            }
                            Text(entry.id)
                                .foregroundStyle(.secondary)
                                .font(.caption)
                                .lineLimit(1)
                                .truncationMode(.middle)
                            Text("\(store.localeStore.text("gui.registry.publisher")): \(entry.publisher ?? store.localeStore.text("gui.common.notSet"))")
                                .font(.subheadline)
                                .lineLimit(1)
                            Text("\(store.localeStore.text("gui.registry.reviewStatus")): \(entry.reviewStatus ?? store.localeStore.text("gui.common.notSet"))")
                                .font(.subheadline)
                                .lineLimit(1)
                            Text("\(store.localeStore.text("gui.registry.source")): \(entry.registrySourceLabel ?? entry.registrySourceLocation ?? store.localeStore.text("gui.common.notSet"))")
                                .font(.subheadline)
                                .lineLimit(1)
                            Text("\(store.localeStore.text("gui.registry.capabilities")): \(entry.capabilities?.joined(separator: ", ") ?? store.localeStore.text("gui.common.notSet"))")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                            ViewThatFits(in: .horizontal) {
                                HStack(spacing: 12) {
                                    Button(store.localeStore.text("gui.registry.install")) {
                                        Task { await store.installRegistryEntry(entry.id) }
                                    }
                                    Button(store.localeStore.text("gui.registry.inspect")) {
                                        Task { await store.inspectRegistryEntry(entry.id) }
                                    }
                                    Spacer()
                                }
                                VStack(alignment: .leading, spacing: 8) {
                                    Button(store.localeStore.text("gui.registry.install")) {
                                        Task { await store.installRegistryEntry(entry.id) }
                                    }
                                    Button(store.localeStore.text("gui.registry.inspect")) {
                                        Task { await store.inspectRegistryEntry(entry.id) }
                                    }
                                }
                            }
                        }
                        .padding(.vertical, 6)
                    }
                    .frame(maxWidth: .infinity, alignment: .topLeading)
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
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(.quaternary))
                    }
                }
                ViewThatFits(in: .horizontal) {
                    HStack {
                        Button {
                            Task { await store.inspectPrompt() }
                        } label: {
                            Label(store.localeStore.text("gui.prompt.inspect"), systemImage: "wand.and.stars")
                        }
                        Text(store.localeStore.text("gui.prompt.hint"))
                            .foregroundStyle(.secondary)
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Button {
                            Task { await store.inspectPrompt() }
                        } label: {
                            Label(store.localeStore.text("gui.prompt.inspect"), systemImage: "wand.and.stars")
                        }
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
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(.quaternary))
                            .disabled(true)
                    }
                }
            }
        }
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
                        Button {
                            Task { await store.patchStatus() }
                        } label: {
                            Label(store.localeStore.text("gui.patch.statusButton"), systemImage: "arrow.triangle.2.circlepath")
                        }
                        Button {
                            Task { await store.applyPatch() }
                        } label: {
                            Label(store.localeStore.text("gui.patch.apply"), systemImage: "checkmark.circle")
                        }
                        Button {
                            Task { await store.rejectPatch() }
                        } label: {
                            Label(store.localeStore.text("gui.patch.reject"), systemImage: "xmark.circle")
                        }
                        Spacer()
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 12) {
                            Button {
                                Task { await store.inspectDiff() }
                            } label: {
                                Label(store.localeStore.text("gui.patch.inspectDiff"), systemImage: "doc.plaintext")
                            }
                            Button {
                                Task { await store.patchStatus() }
                            } label: {
                                Label(store.localeStore.text("gui.patch.statusButton"), systemImage: "arrow.triangle.2.circlepath")
                            }
                        }
                        HStack(spacing: 12) {
                            Button {
                                Task { await store.applyPatch() }
                            } label: {
                                Label(store.localeStore.text("gui.patch.apply"), systemImage: "checkmark.circle")
                            }
                            Button {
                                Task { await store.rejectPatch() }
                            } label: {
                                Label(store.localeStore.text("gui.patch.reject"), systemImage: "xmark.circle")
                            }
                        }
                    }
                }

                GroupBox(store.localeStore.text("gui.patch.diff")) {
                    if let diff = store.snapshot?.pendingPatch?.diffText, !diff.isEmpty {
                        TextEditor(text: .constant(diff))
                            .font(.system(.body, design: .monospaced))
                            .frame(minHeight: 320)
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(.quaternary))
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
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(.quaternary))
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
                        Button {
                            store.sendSessionInput(store.sessionInput)
                        } label: {
                            Label(store.localeStore.text("gui.session.send"), systemImage: "arrow.up.circle")
                        }
                        Button {
                            store.stopSession()
                        } label: {
                            Label(store.localeStore.text("gui.session.stop"), systemImage: "stop.circle")
                        }
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
                            Button {
                                store.sendSessionInput(store.sessionInput)
                            } label: {
                                Label(store.localeStore.text("gui.session.send"), systemImage: "arrow.up.circle")
                            }
                        }
                        HStack(spacing: 12) {
                            Button {
                                store.stopSession()
                            } label: {
                                Label(store.localeStore.text("gui.session.stop"), systemImage: "stop.circle")
                            }
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
                            Text(store.sessionOutputText)
                                .frame(maxWidth: .infinity, alignment: .topLeading)
                                .font(.system(.body, design: .monospaced))
                                .textSelection(.enabled)
                                .padding(8)
                        }
                        .frame(minHeight: 260)
                        .background(.quaternary.opacity(0.2))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
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
        }
    }
}

struct SectionShell<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(title)
                    .font(.title2.weight(.semibold))
                    .padding(.bottom, 2)
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(18)
        }
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
        .background(tint.opacity(0.08))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(tint.opacity(0.22)))
        .clipShape(RoundedRectangle(cornerRadius: 14))
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
                    .fill(.quaternary.opacity(0.55))
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
                    .buttonStyle(.borderedProminent)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 210, alignment: .center)
        .padding(.vertical, 18)
        .padding(.horizontal, 20)
        .background(.quaternary.opacity(0.12))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(.quaternary))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

private func keyValueRow(_ label: String, _ value: String) -> some View {
    ViewThatFits(in: .horizontal) {
        HStack(alignment: .top, spacing: 12) {
            Text(label)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(minWidth: 140, idealWidth: 180, maxWidth: 220, alignment: .leading)
            Text(value)
                .font(.subheadline)
                .lineLimit(2)
                .truncationMode(.tail)
            Spacer()
        }
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.subheadline)
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
