import SwiftUI

struct LocalCodexCommands: Commands {
    let store: WorkspaceStore

    init(store: WorkspaceStore) {
        self.store = store
    }

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button(store.localeStore.text("gui.toolbar.openProject")) {
                store.chooseProjectFolder()
            }
            .keyboardShortcut("o", modifiers: [.command, .shift])
        }

        CommandGroup(after: .newItem) {
            Button(store.localeStore.text("gui.toolbar.refresh")) {
                Task { await store.refreshWorkspace() }
            }
            .keyboardShortcut("r", modifiers: [.command, .shift])

            Button(store.localeStore.text("gui.toolbar.initWorkspace")) {
                Task { await store.initializeWorkspace() }
            }
        }

        CommandMenu(store.localeStore.text("gui.commands.session")) {
            Button(store.localeStore.text("gui.session.inspectPrompt")) {
                Task { await store.inspectPrompt() }
            }
            Button(store.localeStore.text("gui.session.inspectDiff")) {
                Task { await store.inspectDiff() }
            }
            Button(store.localeStore.text("gui.session.applyPatch")) {
                Task { await store.applyPatch() }
            }
            Button(store.localeStore.text("gui.session.rejectPatch")) {
                Task { await store.rejectPatch() }
            }
        }
    }
}
