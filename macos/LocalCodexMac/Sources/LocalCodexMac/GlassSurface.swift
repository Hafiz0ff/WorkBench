import SwiftUI

struct GlassSurfaceModifier: ViewModifier {
    var cornerRadius: CGFloat
    var material: Material
    var tint: Color
    var border: Color
    var borderWidth: CGFloat
    var shadowColor: Color
    var shadowRadius: CGFloat
    var shadowY: CGFloat

    func body(content: Content) -> some View {
        content
            .background {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(material)
                    .overlay {
                        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                            .fill(tint)
                    }
            }
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(border, lineWidth: borderWidth)
                    .allowsHitTesting(false)
            }
            .shadow(color: shadowColor, radius: shadowRadius, y: shadowY)
    }
}

extension View {
    func glassSurface(
        cornerRadius: CGFloat = 16,
        material: Material = .ultraThinMaterial,
        tint: Color = .clear,
        border: Color = .primary.opacity(0.10),
        borderWidth: CGFloat = 1,
        shadowColor: Color = .black.opacity(0.06),
        shadowRadius: CGFloat = 12,
        shadowY: CGFloat = 4
    ) -> some View {
        modifier(
            GlassSurfaceModifier(
                cornerRadius: cornerRadius,
                material: material,
                tint: tint,
                border: border,
                borderWidth: borderWidth,
                shadowColor: shadowColor,
                shadowRadius: shadowRadius,
                shadowY: shadowY
            )
        )
    }
}
