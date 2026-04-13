import SwiftUI

@main
struct LocalCodexMacApp: App {
    @NSApplicationDelegateAdaptor(WorkbenchAppDelegate.self) private var appDelegate
    @StateObject private var store = WorkspaceStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
                .environmentObject(store.localeStore)
        }
        .commands {
            LocalCodexCommands(store: store)
        }

        Settings {
            SettingsView()
                .environmentObject(store)
                .environmentObject(store.localeStore)
        }
    }
}
