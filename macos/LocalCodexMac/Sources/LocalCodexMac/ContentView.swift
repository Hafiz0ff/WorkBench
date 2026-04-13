import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var store: WorkspaceStore

    var body: some View {
        NavigationSplitView {
            List(selection: $store.selectedSection) {
                Section(header: Text(store.localeStore.text("gui.sidebar.workspace"))) {
                    SidebarRow(title: store.localeStore.text("gui.sidebar.project"), subtitle: store.projectRootDisplay, badge: nil, icon: "folder", section: .project)
                    SidebarRow(title: store.localeStore.text("gui.sidebar.tasks"), subtitle: store.localeStore.text("gui.sidebar.tasksSubtitle"), badge: "\(store.taskCount)", icon: "checklist", section: .tasks)
                    SidebarRow(title: store.localeStore.text("gui.sidebar.roles"), subtitle: store.localeStore.text("gui.sidebar.rolesSubtitle"), badge: "\(store.roleCount)", icon: "person.2", section: .roles)
                    SidebarRow(title: store.localeStore.text("gui.sidebar.extensions"), subtitle: store.localeStore.text("gui.sidebar.extensionsSubtitle"), badge: "\(store.extensionCount)", icon: "puzzlepiece.extension", section: .extensions)
                    SidebarRow(title: store.localeStore.text("gui.sidebar.registry"), subtitle: store.localeStore.text("gui.sidebar.registrySubtitle"), badge: "\(store.registryEntryCount)", icon: "book.closed", section: .registry)
                    SidebarRow(title: store.localeStore.text("gui.sidebar.prompt"), subtitle: store.localeStore.text("gui.sidebar.promptSubtitle"), badge: nil, icon: "wand.and.stars", section: .prompt)
                    SidebarRow(title: store.localeStore.text("gui.sidebar.patches"), subtitle: store.currentPatchStatusDisplay, badge: store.hasPendingPatch ? "1" : "0", icon: "doc.on.doc", section: .patches)
                    SidebarRow(title: store.localeStore.text("gui.sidebar.policy"), subtitle: store.approvalModeDisplay, badge: nil, icon: "shield.checkered", section: .policy)
                    SidebarRow(title: store.localeStore.text("gui.sidebar.session"), subtitle: store.sessionStatusDisplay, badge: nil, icon: store.sessionIsRunning ? "play.fill" : "pause.fill", section: .session)
                }
                Section(header: Text(store.localeStore.text("gui.sidebar.app"))) {
                    SidebarRow(title: store.localeStore.text("gui.sidebar.settings"), subtitle: store.localeStore.text("gui.sidebar.settingsSubtitle"), badge: nil, icon: "gearshape", section: .settings)
                }
            }
            .listStyle(.sidebar)
            .navigationSplitViewColumnWidth(min: 200, ideal: 230, max: 280)
            .navigationTitle(store.localeStore.text("gui.app.title"))
        } detail: {
            Group {
                switch store.selectedSection {
                case .project:
                    ProjectView()
                case .tasks:
                    TasksView()
                case .roles:
                    RolesView()
                case .extensions:
                    ExtensionsView()
                case .registry:
                    RegistryView()
                case .prompt:
                    PromptInspectorView()
                case .patches:
                    PatchesView()
                case .policy:
                    PolicyView()
                case .session:
                    SessionView()
                case .settings:
                    SettingsView()
                }
            }
            .navigationTitle(detailTitle)
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    Button {
                        store.chooseProjectFolder()
                    } label: {
                        Label(store.localeStore.text("gui.toolbar.openProject"), systemImage: "folder")
                    }
                    Button {
                        Task { await store.refreshWorkspace() }
                    } label: {
                        Label(store.localeStore.text("gui.toolbar.refresh"), systemImage: "arrow.clockwise")
                    }
                    Button {
                        Task { await store.initializeWorkspace() }
                    } label: {
                        Label(store.localeStore.text("gui.toolbar.initWorkspace"), systemImage: "plus.circle")
                    }
                }
            }
        }
        .task {
            if store.snapshot == nil, store.selectedProjectRoot != nil {
                await store.refreshSnapshot()
            }
        }
        .task(id: store.selectedSection) {
            guard store.selectedProjectRoot != nil else { return }
            await store.refreshSnapshot()
        }
    }

    private var detailTitle: String {
        switch store.selectedSection {
        case .project: return store.localeStore.text("gui.sidebar.project")
        case .tasks: return store.localeStore.text("gui.sidebar.tasks")
        case .roles: return store.localeStore.text("gui.sidebar.roles")
        case .extensions: return store.localeStore.text("gui.sidebar.extensions")
        case .registry: return store.localeStore.text("gui.sidebar.registry")
        case .prompt: return store.localeStore.text("gui.sidebar.prompt")
        case .patches: return store.localeStore.text("gui.sidebar.patches")
        case .policy: return store.localeStore.text("gui.sidebar.policy")
        case .session: return store.localeStore.text("gui.sidebar.session")
        case .settings: return store.localeStore.text("gui.sidebar.settings")
        }
    }
}

private struct SidebarRow: View {
    let title: String
    let subtitle: String?
    let badge: String?
    let icon: String
    let section: WorkspaceSection

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .font(.caption.weight(.semibold))
                .frame(width: 16, alignment: .center)
                .foregroundStyle(.secondary)
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .layoutPriority(1)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .layoutPriority(1)
                }
            }
            Spacer(minLength: 8)
            if let badge, !badge.isEmpty {
                Text(badge)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(.quaternary.opacity(0.55))
                    .clipShape(Capsule())
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .tag(section)
    }
}
