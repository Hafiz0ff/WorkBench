import Foundation
import SwiftUI

enum AppLocale: String, CaseIterable, Identifiable {
    case ru
    case en

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .ru: return "Русский"
        case .en: return "English"
        }
    }
}

@MainActor
final class LocalizationStore: ObservableObject {
    @Published var locale: AppLocale {
        didSet {
            UserDefaults.standard.set(locale.rawValue, forKey: "localcodex.locale")
        }
    }

    init() {
        let code = UserDefaults.standard.string(forKey: "localcodex.locale") ?? AppLocale.ru.rawValue
        locale = AppLocale(rawValue: code) ?? .ru
    }

    func text(_ key: String, _ arguments: CVarArg...) -> String {
        let bundle = localizationBundle(for: locale)
        let format = NSLocalizedString(key, bundle: bundle, comment: "")
        guard !arguments.isEmpty else {
            return format
        }
        return String(format: format, locale: Locale(identifier: locale.rawValue), arguments: arguments)
    }

    private func localizationBundle(for locale: AppLocale) -> Bundle {
        if let url = Bundle.module.url(forResource: locale.rawValue, withExtension: "lproj"),
           let bundle = Bundle(url: url) {
            return bundle
        }
        return .module
    }
}
