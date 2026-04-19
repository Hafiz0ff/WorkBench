import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var store: WorkspaceStore
    @State private var columnVisibility: NavigationSplitViewVisibility = .doubleColumn

    var body: some View {
        GeometryReader { proxy in
            let density = WorkspaceDensity(width: proxy.size.width)
            NavigationSplitView(columnVisibility: $columnVisibility) {
                WorkspaceRailView(density: density)
                    .navigationSplitViewColumnWidth(
                        min: density.isCompact ? 220 : 250,
                        ideal: density.isCompact ? 240 : 290,
                        max: density.isCompact ? 280 : 340
                    )
                    .navigationTitle(store.localeStore.text("gui.app.title"))
            } content: {
                VStack(alignment: .leading, spacing: density.isCompact ? 8 : 12) {
                    Group {
                        if store.isLoading {
                            LoadingSkeletonView(title: workspaceTitle)
                        } else {
                            WorkspaceMainSurfaceView(density: density)
                        }
                    }
                    .id(store.isLoading ? "loading" : "workspace")
                    .transition(.opacity.combined(with: .scale(scale: 0.985)))
                }
                .padding(.horizontal, density.isCompact ? 10 : 14)
                .padding(.top, density.isCompact ? 10 : 14)
                .navigationTitle(workspaceTitle)
                .animation(IntentMotion.selection, value: store.selectedInspectorTab)
                .toolbar {
                    ToolbarItemGroup(placement: .primaryAction) {
                        Button {
                            store.chooseProjectFolder()
                        } label: {
                            Label(store.localeStore.text("gui.toolbar.openProject"), systemImage: "folder")
                        }
                        .buttonStyle(.intent(.text))
                        Button {
                            Task { await store.refreshWorkspace() }
                        } label: {
                            Label(store.localeStore.text("gui.toolbar.refresh"), systemImage: "arrow.clockwise")
                        }
                        .buttonStyle(.intent(.text))
                        Button {
                            Task { await store.initializeWorkspace() }
                        } label: {
                            Label(store.localeStore.text("gui.toolbar.initWorkspace"), systemImage: "plus.circle")
                        }
                        .buttonStyle(.intent(.text))
                    }
                }
            } detail: {
                WorkspaceInspectorPanelView(density: density)
                    .navigationSplitViewColumnWidth(
                        min: density.isCompact ? 300 : 340,
                        ideal: density.isCompact ? 350 : 400,
                        max: density.isCompact ? 460 : 520
                    )
            }
            .task {
                if store.snapshot == nil, store.selectedProjectRoot != nil, !store.isProjectBootstrapping {
                    await store.refreshSnapshot()
                }
                syncInspectorVisibility(isSessionRunning: store.sessionIsRunning)
            }
            .task(id: store.selectedSection) {
                guard store.selectedProjectRoot != nil, !store.isProjectBootstrapping else { return }
                await store.refreshSnapshot()
            }
            .onChange(of: store.sessionIsRunning) { _, isRunning in
                syncInspectorVisibility(isSessionRunning: isRunning)
            }
        }
    }

    private var workspaceTitle: String {
        if let taskId = store.selectedTaskId ?? store.snapshot?.state?.currentTaskId {
            return "\(store.localeStore.text("gui.app.title")) · \(taskId)"
        }
        return store.localeStore.text("gui.app.title")
    }

    private func syncInspectorVisibility(isSessionRunning: Bool) {
        if isSessionRunning {
            columnVisibility = .all
            store.selectedInspectorTab = .logs
        } else {
            columnVisibility = .doubleColumn
        }
    }
}
