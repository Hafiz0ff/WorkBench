import SwiftUI

enum WorkspaceDensity {
    case compact
    case regular

    init(width: CGFloat) {
        self = width < 1500 ? .compact : .regular
    }

    var isCompact: Bool {
        self == .compact
    }
}

struct WorkspaceRailView: View {
    @EnvironmentObject private var store: WorkspaceStore
    let density: WorkspaceDensity

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: density.isCompact ? 10 : 14) {
                GroupBox(store.localeStore.text("gui.workspace.project")) {
                    VStack(alignment: .leading, spacing: density.isCompact ? 6 : 8) {
                        Text(store.projectNameDisplay)
                            .font(.headline)
                            .lineLimit(1)
                            .truncationMode(.tail)
                        if !density.isCompact {
                            Text(store.projectRootDisplay)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                                .truncationMode(.middle)
                        }
                        HStack(spacing: 8) {
                            Label(store.currentTaskSummaryDisplay, systemImage: "checklist")
                                .font(.caption)
                            Spacer()
                        }
                        .foregroundStyle(.secondary)
                    }
                }

                GroupBox(store.localeStore.text("gui.workspace.navigate")) {
                    VStack(alignment: .leading, spacing: density.isCompact ? 6 : 8) {
                        RailNavButton(title: store.localeStore.text("gui.sidebar.project"), systemImage: "house", isSelected: store.selectedSection == .project, density: density) {
                            store.selectedSection = .project
                        }
                        RailNavButton(title: store.localeStore.text("gui.sidebar.tasks"), systemImage: "checklist", isSelected: store.selectedInspectorTab == .task, density: density) {
                            store.selectedInspectorTab = .task
                        }
                        RailNavButton(title: store.localeStore.text("gui.sidebar.roles"), systemImage: "person.2", isSelected: store.selectedInspectorTab == .role, density: density) {
                            store.selectedInspectorTab = .role
                        }
                        RailNavButton(title: store.localeStore.text("gui.sidebar.session"), systemImage: "play.rectangle", isSelected: store.selectedInspectorTab == .logs, density: density) {
                            store.selectedInspectorTab = .logs
                        }
                        RailNavButton(title: store.localeStore.text("gui.sidebar.settings"), systemImage: "gearshape", isSelected: store.selectedInspectorTab == .advanced, density: density) {
                            store.selectedInspectorTab = .advanced
                        }
                    }
                }
            }
            .padding(density.isCompact ? 10 : 14)
        }
        .scrollContentBackground(.hidden)
        .background(.ultraThinMaterial)
    }
}

struct WorkspaceControlStripView: View {
    @EnvironmentObject private var store: WorkspaceStore
    let density: WorkspaceDensity

    var body: some View {
        VStack(alignment: .leading, spacing: density.isCompact ? 8 : 10) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: density.isCompact ? 10 : 12) {
                    Menu {
                        ForEach(filteredTasks) { task in
                            Button(task.title) {
                                Task { await store.useTask(task.id) }
                            }
                        }
                    } label: {
                        WorkspaceContextChipView(
                            title: store.currentTaskSummaryDisplay,
                            subtitle: store.localeStore.text("gui.inspector.task"),
                            systemImage: "checklist",
                            tint: .orange,
                            isActive: store.selectedInspectorTab == .task
                        )
                    }
                    .buttonStyle(.intent(.text))

                    Menu {
                        ForEach(filteredRoles) { role in
                            Button(role.name) {
                                Task { await store.useRole(role.name) }
                            }
                        }
                    } label: {
                        WorkspaceContextChipView(
                            title: store.currentRoleDisplay,
                            subtitle: store.localeStore.text("gui.inspector.role"),
                            systemImage: "person.2",
                            tint: .blue,
                            isActive: store.selectedInspectorTab == .role
                        )
                    }
                    .buttonStyle(.intent(.text))

                    Menu {
                        Button(store.localeStore.text("gui.project.quickStructure")) {
                            store.projectComposerText = store.localeStore.text("gui.project.quickStructurePrompt")
                        }
                        Button(store.localeStore.text("gui.project.quickEntryPoint")) {
                            store.projectComposerText = store.localeStore.text("gui.project.quickEntryPointPrompt")
                        }
                        Button(store.localeStore.text("gui.project.quickPlan")) {
                            store.projectComposerText = store.localeStore.text("gui.project.quickPlanPrompt")
                        }
                        Button(store.localeStore.text("gui.project.quickPatch")) {
                            Task { await store.patchStatus() }
                        }
                        Button(store.localeStore.text("gui.project.quickContext")) {
                            store.projectComposerText = store.localeStore.text("gui.project.quickContextPrompt")
                        }
                    } label: {
                        WorkspaceContextChipView(
                            title: store.localeStore.text("gui.project.quickActions"),
                            subtitle: store.localeStore.text("gui.project.quickActionsHint"),
                            systemImage: "bolt",
                            tint: .orange,
                            isActive: false
                        )
                    }
                    .buttonStyle(.intent(.text))

                    WorkspaceContextChipView(
                        title: store.currentProviderDisplay,
                        subtitle: store.currentModelDisplay,
                        systemImage: "cpu",
                        tint: .teal,
                        isActive: store.selectedInspectorTab == .context
                    )

                    Spacer(minLength: 12)
                }
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 10) {
                        Menu {
                            ForEach(filteredTasks) { task in
                                Button(task.title) {
                                    Task { await store.useTask(task.id) }
                                }
                            }
                        } label: {
                            WorkspaceContextChipView(
                                title: store.currentTaskSummaryDisplay,
                                subtitle: store.localeStore.text("gui.inspector.task"),
                                systemImage: "checklist",
                                tint: .orange,
                                isActive: store.selectedInspectorTab == .task
                            )
                        }
                        .buttonStyle(.intent(.text))

                        Menu {
                            ForEach(filteredRoles) { role in
                                Button(role.name) {
                                    Task { await store.useRole(role.name) }
                                }
                            }
                        } label: {
                            WorkspaceContextChipView(
                                title: store.currentRoleDisplay,
                                subtitle: store.localeStore.text("gui.inspector.role"),
                                systemImage: "person.2",
                                tint: .blue,
                                isActive: store.selectedInspectorTab == .role
                            )
                        }
                        .buttonStyle(.intent(.text))

                        Menu {
                            Button(store.localeStore.text("gui.project.quickStructure")) {
                                store.projectComposerText = store.localeStore.text("gui.project.quickStructurePrompt")
                            }
                            Button(store.localeStore.text("gui.project.quickEntryPoint")) {
                                store.projectComposerText = store.localeStore.text("gui.project.quickEntryPointPrompt")
                            }
                            Button(store.localeStore.text("gui.project.quickPlan")) {
                                store.projectComposerText = store.localeStore.text("gui.project.quickPlanPrompt")
                            }
                            Button(store.localeStore.text("gui.project.quickPatch")) {
                                Task { await store.patchStatus() }
                            }
                            Button(store.localeStore.text("gui.project.quickContext")) {
                                store.projectComposerText = store.localeStore.text("gui.project.quickContextPrompt")
                            }
                        } label: {
                            WorkspaceContextChipView(
                                title: store.localeStore.text("gui.project.quickActions"),
                                subtitle: store.localeStore.text("gui.project.quickActionsHint"),
                                systemImage: "bolt",
                                tint: .orange,
                                isActive: false
                            )
                        }
                        .buttonStyle(.intent(.text))
                    }
                    WorkspaceContextChipView(
                        title: store.currentProviderDisplay,
                        subtitle: store.currentModelDisplay,
                        systemImage: "cpu",
                        tint: .teal,
                        isActive: store.selectedInspectorTab == .context
                    )
                }
            }
        }
        .padding(.horizontal, density.isCompact ? 0 : 2)
        .padding(.bottom, density.isCompact ? 6 : 8)
    }

    private var filteredTasks: [TaskIndexEntry] { store.snapshot?.tasks ?? [] }

    private var filteredRoles: [RoleFileSnapshot] { store.snapshot?.roles ?? [] }
}

struct WorkspaceMainSurfaceView: View {
    @EnvironmentObject private var store: WorkspaceStore
    let density: WorkspaceDensity

    var body: some View {
        VStack(alignment: .leading, spacing: density.isCompact ? 8 : 12) {
            ProjectView(compact: density.isCompact)
        }
    }
}

struct WorkspaceWorkingSetView: View {
    @EnvironmentObject private var store: WorkspaceStore
    let density: WorkspaceDensity

    var body: some View {
        SectionShell(title: store.localeStore.text("gui.workspace.digest")) {
            VStack(alignment: .leading, spacing: density.isCompact ? 10 : 14) {
                if density.isCompact {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 140, maximum: 220), spacing: 8)], spacing: 8) {
                        WorkspaceContextChipView(
                            title: store.currentTaskSummaryDisplay,
                            subtitle: store.localeStore.text("gui.inspector.task"),
                            systemImage: "checklist",
                            tint: .orange,
                            isActive: store.selectedInspectorTab == .task
                        )
                        WorkspaceContextChipView(
                            title: store.currentRoleDisplay,
                            subtitle: store.localeStore.text("gui.inspector.role"),
                            systemImage: "person.2",
                            tint: .blue,
                            isActive: store.selectedInspectorTab == .role
                        )
                        WorkspaceContextChipView(
                            title: store.currentModelDisplay,
                            subtitle: store.localeStore.text("gui.workspace.model"),
                            systemImage: "cpu",
                            tint: .teal,
                            isActive: store.selectedInspectorTab == .context
                        )
                        WorkspaceContextChipView(
                            title: store.currentPatchStatusDisplay,
                            subtitle: store.localeStore.text("gui.patch.status"),
                            systemImage: "doc.on.doc",
                            tint: store.hasPendingPatch ? .red : .secondary,
                            isActive: store.selectedInspectorTab == .patch
                        )
                        WorkspaceContextChipView(
                            title: store.sessionStatusDisplay,
                            subtitle: store.localeStore.text("gui.session.status"),
                            systemImage: store.sessionIsRunning ? "play.fill" : "pause.fill",
                            tint: store.sessionIsRunning ? .green : .secondary,
                            isActive: store.selectedInspectorTab == .logs
                        )
                    }
                } else {
                    StatusRibbon(items: [
                        .init(label: store.localeStore.text("gui.session.task"), value: store.currentTaskSummaryDisplay, tint: .orange, symbol: "checkmark.circle"),
                        .init(label: store.localeStore.text("gui.session.role"), value: store.currentRoleDisplay, tint: .blue, symbol: "person.fill"),
                        .init(label: store.localeStore.text("gui.session.model"), value: store.currentModelDisplay, tint: .teal, symbol: "cpu"),
                        .init(label: store.localeStore.text("gui.patch.status"), value: store.currentPatchStatusDisplay, tint: store.hasPendingPatch ? .red : .secondary, symbol: "doc.on.doc"),
                        .init(label: store.localeStore.text("gui.session.status"), value: store.sessionStatusDisplay, tint: store.sessionIsRunning ? .green : .secondary, symbol: store.sessionIsRunning ? "play.fill" : "pause.fill"),
                    ])
                }

                workspaceKeyValueRow(store.localeStore.text("gui.workspace.taskRequest"), store.currentTaskRequestDisplay, compact: density.isCompact)
                workspaceKeyValueRow(store.localeStore.text("gui.workspace.diagnostics"), store.diagnosticsSummaryDisplay, compact: density.isCompact)

                if !density.isCompact || !store.sessionOutputText.isEmpty {
                    GroupBox(store.localeStore.text("gui.session.output")) {
                        if store.sessionOutputText.isEmpty {
                            EmptyStateView(
                                title: store.localeStore.text("gui.session.empty"),
                                message: store.localeStore.text("gui.session.emptyHint"),
                                systemImage: "terminal"
                            )
                        } else {
                            Text(store.sessionOutputExcerptDisplay)
                                .font(.system(.body, design: .monospaced))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .lineLimit(density.isCompact ? 5 : 8)
                                .textSelection(.enabled)
                        }
                    }
                }

            }
        }
    }
}

struct WorkspaceInspectorPanelView: View {
    @EnvironmentObject private var store: WorkspaceStore
    let density: WorkspaceDensity

    var body: some View {
        VStack(alignment: .leading, spacing: density.isCompact ? 10 : 12) {
            Picker(store.localeStore.text("gui.workspace.inspector"), selection: $store.selectedInspectorTab) {
                ForEach(WorkspaceInspectorTab.allCases) { tab in
                    Text(tab.displayTitle(locale: store.localeStore)).tag(tab)
                }
            }
            .pickerStyle(.segmented)

            Group {
                switch store.selectedInspectorTab {
                case .task:
                    TasksView()
                case .role:
                    RolesView()
                case .context:
                    PromptInspectorView()
                case .patch:
                    PatchesView()
                case .logs:
                    SessionView()
                case .advanced:
                    AdvancedInspectorView()
                }
            }
        }
        .padding(.trailing, density.isCompact ? 8 : 12)
    }
}

private struct AdvancedInspectorView: View {
    @EnvironmentObject private var store: WorkspaceStore
    @State private var advancedSurface: AdvancedSurface = .extensions

    private enum AdvancedSurface: String, CaseIterable, Identifiable {
        case extensions
        case registry
        case policy
        case settings

        var id: String { rawValue }
    }

    var body: some View {
        SectionShell(title: store.localeStore.text("gui.workspace.advanced")) {
            VStack(alignment: .leading, spacing: 12) {
                workspaceKeyValueRow(store.localeStore.text("gui.workspace.provider"), store.currentProviderDisplay)
                workspaceKeyValueRow(store.localeStore.text("gui.workspace.model"), store.currentModelDisplay)
                workspaceKeyValueRow(store.localeStore.text("gui.workspace.policy"), store.approvalModeDisplay)

                GroupBox(store.localeStore.text("gui.workspace.providerModel")) {
                    VStack(alignment: .leading, spacing: 10) {
                        WorkspaceContextChipView(
                            title: store.currentProviderDisplay,
                            subtitle: store.currentModelDisplay,
                            systemImage: "cpu",
                            tint: .teal,
                            isActive: store.selectedInspectorTab == .context
                        )
                        TextField(store.localeStore.text("gui.workspace.modelPlaceholder"), text: $store.modelOverrideInput)
                            .textFieldStyle(.roundedBorder)
                        Button(store.localeStore.text("gui.workspace.applyModel")) {
                            Task { await store.applyModelOverride() }
                        }
                        .buttonStyle(.intent(.secondary))
                        .disabled(store.modelOverrideInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }

                Picker(store.localeStore.text("gui.workspace.advanced"), selection: $advancedSurface) {
                    ForEach(AdvancedSurface.allCases) { surface in
                        switch surface {
                        case .extensions:
                            Text(store.localeStore.text("gui.extensions.title")).tag(surface)
                        case .registry:
                            Text(store.localeStore.text("gui.registry.title")).tag(surface)
                        case .policy:
                            Text(store.localeStore.text("gui.policy.title")).tag(surface)
                        case .settings:
                            Text(store.localeStore.text("gui.settings.title")).tag(surface)
                        }
                    }
                }
                .pickerStyle(.segmented)

                Group {
                    switch advancedSurface {
                    case .extensions:
                        ExtensionsView()
                    case .registry:
                        RegistryView()
                    case .policy:
                        PolicyView()
                    case .settings:
                        SettingsView()
                    }
                }
            }
        }
    }
}

private struct RailNavButton: View {
    let title: String
    let systemImage: String
    let isSelected: Bool
    let density: WorkspaceDensity
    let action: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: systemImage)
                Text(title)
                Spacer()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.intent(.text))
        .padding(.horizontal, 10)
        .padding(.vertical, density.isCompact ? 7 : 8)
        .glassSurface(
            cornerRadius: density.isCompact ? 10 : 12,
            material: .ultraThinMaterial,
            tint: isSelected ? Color.accentColor.opacity(0.08) : (isHovered ? Color.primary.opacity(0.035) : Color.primary.opacity(0.015)),
            border: isSelected ? Color.accentColor.opacity(0.28) : (isHovered ? Color.primary.opacity(0.16) : Color.primary.opacity(0.10)),
            shadowRadius: isHovered || isSelected ? (density.isCompact ? 6 : 8) : 6
        )
        .overlay {
            RoundedRectangle(cornerRadius: density.isCompact ? 10 : 12, style: .continuous)
                .strokeBorder(isSelected ? Color.accentColor.opacity(0.45) : Color.clear, lineWidth: 1)
        }
        .scaleEffect(isHovered ? 1.01 : 1)
        .onHover { isHovered = $0 }
        .animation(IntentMotion.selection, value: isHovered)
    }
}

private struct WorkspaceContextChipView: View {
    let title: String
    let subtitle: String
    let systemImage: String
    let tint: Color
    let isActive: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                Image(systemName: systemImage)
                    .font(.caption.weight(.semibold))
                Text(subtitle)
                    .font(.caption2)
                    .textCase(.uppercase)
                    .tracking(0.3)
            }
            .foregroundStyle(isActive ? tint : .secondary)
            Text(title)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(minWidth: 150, alignment: .leading)
        .glassSurface(
            cornerRadius: 14,
            material: .ultraThinMaterial,
            tint: isActive ? tint.opacity(0.08) : Color.primary.opacity(0.015),
            border: isActive ? tint.opacity(0.30) : Color.primary.opacity(0.10),
            shadowRadius: isActive ? 10 : 6
        )
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(isActive ? tint.opacity(0.55) : Color.clear, lineWidth: 1)
        }
        .animation(IntentMotion.selection, value: isActive)
    }
}

private extension WorkspaceInspectorTab {
    @MainActor
    func displayTitle(locale: LocalizationStore) -> String {
        switch self {
        case .task: return locale.text("gui.inspector.task")
        case .role: return locale.text("gui.inspector.role")
        case .context: return locale.text("gui.inspector.context")
        case .patch: return locale.text("gui.inspector.patch")
        case .logs: return locale.text("gui.inspector.logs")
        case .advanced: return locale.text("gui.inspector.advanced")
        }
    }
}

private func workspaceKeyValueRow(_ label: String, _ value: String, compact: Bool = false) -> some View {
    ViewThatFits(in: .horizontal) {
        HStack(alignment: .top, spacing: 12) {
            Text(label)
                .font(compact ? .caption2 : .caption)
                .foregroundStyle(.secondary)
                .frame(width: compact ? 104 : 120, alignment: .leading)
            Text(value)
                .font(compact ? .caption : .subheadline)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(compact ? .caption2 : .caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(compact ? .caption : .subheadline)
        }
    }
}
