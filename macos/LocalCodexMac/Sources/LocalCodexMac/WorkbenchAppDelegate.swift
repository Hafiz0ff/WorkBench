import AppKit
import Foundation

@MainActor
final class WorkbenchAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        DispatchQueue.main.async { [weak self] in
            self?.normalizeOpenWindows()
        }
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        DispatchQueue.main.async { [weak self] in
            self?.normalizeOpenWindows()
        }
    }

    private func firstProjectFolder(from filenames: [String]) -> URL? {
        let fm = FileManager.default
        for filename in filenames {
            let url = URL(fileURLWithPath: filename)
            var isDirectory: ObjCBool = false
            if fm.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue {
                return url
            }
        }
        return nil
    }

    func application(_ sender: NSApplication, openFiles filenames: [String]) {
        if let folder = firstProjectFolder(from: filenames) {
            NotificationCenter.default.post(name: .workbenchOpenProject, object: folder)
        }
        sender.reply(toOpenOrPrint: .success)
    }

    func application(_ sender: NSApplication, openFile filename: String) -> Bool {
        guard let folder = firstProjectFolder(from: [filename]) else {
            return false
        }
        NotificationCenter.default.post(name: .workbenchOpenProject, object: folder)
        return true
    }

    private func normalizeOpenWindows() {
        let minimumSize = NSSize(width: 980, height: 640)
        let maximumSize = NSSize(width: 10_000, height: 10_000)
        for window in NSApp.windows {
            if !window.styleMask.contains(.resizable) {
                window.styleMask.insert(.resizable)
            }
            if window.minSize.width < minimumSize.width || window.minSize.height < minimumSize.height {
                window.minSize = minimumSize
            }
            if window.maxSize.width < maximumSize.width || window.maxSize.height < maximumSize.height {
                window.maxSize = maximumSize
            }
        }
    }
}
