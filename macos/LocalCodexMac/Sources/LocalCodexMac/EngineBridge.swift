import Foundation

final class OutputAccumulator: @unchecked Sendable {
    private let lock = NSLock()
    private var data = Data()

    func append(_ chunk: Data) {
        lock.lock()
        data.append(chunk)
        lock.unlock()
    }

    func string() -> String {
        lock.lock()
        let copy = data
        lock.unlock()
        return String(decoding: copy, as: UTF8.self)
    }

    func drain() -> String {
        lock.lock()
        let copy = data
        data.removeAll(keepingCapacity: true)
        lock.unlock()
        return String(decoding: copy, as: UTF8.self)
    }
}

struct EngineCommandResult {
    var command: String
    var arguments: [String]
    var exitCode: Int32
    var stdout: String
    var stderr: String
}

protocol CLICommandRunning: Sendable {
    func runCLI(arguments: [String], currentDirectory: URL?, environment: [String: String]) async throws -> EngineCommandResult
}

final class EngineBridge: @unchecked Sendable {
    let engineRoot: URL
    let cliURL: URL
    let nodeExecutableURL: URL?

    init(engineRoot: URL, nodeExecutableURL: URL? = nil) {
        self.engineRoot = engineRoot
        self.cliURL = engineRoot.appendingPathComponent("src/cli.js")
        self.nodeExecutableURL = nodeExecutableURL ?? EngineBridge.resolveNodeExecutable()
    }

    static func resolveNodeExecutable(
        fileManager: FileManager = .default,
        homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> URL? {
        let explicitVariables = ["LOCALCODEX_NODE_BINARY", "WORKBENCH_NODE_BINARY", "NODE_BINARY"]
        for key in explicitVariables {
            if let rawPath = environment[key], !rawPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                let url = URL(fileURLWithPath: rawPath)
                if fileManager.isExecutableFile(atPath: url.path) {
                    return url
                }
            }
        }

        let standardPaths = [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node",
        ]
        for candidate in standardPaths {
            if fileManager.isExecutableFile(atPath: candidate) {
                return URL(fileURLWithPath: candidate)
            }
        }

        let nvmRoot = homeDirectory
            .appendingPathComponent(".nvm", isDirectory: true)
            .appendingPathComponent("versions", isDirectory: true)
            .appendingPathComponent("node", isDirectory: true)
        if let versions = try? fileManager.contentsOfDirectory(at: nvmRoot, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles]) {
            for versionDirectory in versions.sorted(by: { $0.lastPathComponent > $1.lastPathComponent }) {
                let node = versionDirectory.appendingPathComponent("bin", isDirectory: true).appendingPathComponent("node")
                if fileManager.isExecutableFile(atPath: node.path) {
                    return node
                }
            }
        }

        return nil
    }

    static func detectEngineRoot(startingAt url: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)) -> URL? {
        var current = url.standardizedFileURL
        let fm = FileManager.default
        while true {
            let cliCandidate = current.appendingPathComponent("src/cli.js")
            if fm.fileExists(atPath: cliCandidate.path) {
                return current
            }
            let parent = current.deletingLastPathComponent()
            if parent.path == current.path {
                return nil
            }
            current = parent
        }
    }

    func runCLI(arguments: [String], currentDirectory: URL? = nil, environment: [String: String] = [:]) async throws -> EngineCommandResult {
        try await withCheckedThrowingContinuation { continuation in
            let process = Process()
            let stdoutPipe = Pipe()
            let stderrPipe = Pipe()
            let stdoutData = OutputAccumulator()
            let stderrData = OutputAccumulator()

            guard let nodeExecutableURL else {
                continuation.resume(throwing: NSError(
                    domain: "LocalCodexMac.EngineBridge",
                    code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "Node.js executable not found."]
                ))
                return
            }

            process.executableURL = nodeExecutableURL
            process.arguments = [cliURL.path] + arguments
            process.currentDirectoryURL = currentDirectory ?? engineRoot
            process.standardOutput = stdoutPipe
            process.standardError = stderrPipe
            process.environment = ProcessInfo.processInfo.environment.merging(environment, uniquingKeysWith: { _, new in new })

            stdoutPipe.fileHandleForReading.readabilityHandler = { handle in
                stdoutData.append(handle.availableData)
            }
            stderrPipe.fileHandleForReading.readabilityHandler = { handle in
                stderrData.append(handle.availableData)
            }

            process.terminationHandler = { proc in
                stdoutPipe.fileHandleForReading.readabilityHandler = nil
                stderrPipe.fileHandleForReading.readabilityHandler = nil
                continuation.resume(returning: EngineCommandResult(
                    command: nodeExecutableURL.path,
                    arguments: arguments,
                    exitCode: proc.terminationStatus,
                    stdout: stdoutData.string(),
                    stderr: stderrData.string()
                ))
            }

            do {
                try process.run()
            } catch {
                stdoutPipe.fileHandleForReading.readabilityHandler = nil
                stderrPipe.fileHandleForReading.readabilityHandler = nil
                continuation.resume(throwing: error)
            }
        }
    }
}

extension EngineBridge: CLICommandRunning {}
