import Foundation
import Testing
@testable import EffectDrive

@Suite("Column visibility")
struct ColumnVisibilityTests {
    func makeDefaults() -> UserDefaults {
        let suite = "EffectDriveTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        return defaults
    }

    @Test("All columns are visible by default")
    func defaultsToAllVisible() {
        let store = ColumnVisibilityStore(defaults: makeDefaults())
        let visibility = store.load()
        #expect(DriveColumn.allCases.allSatisfy { visibility.isVisible($0) })
    }

    @Test("The name column can't be hidden")
    func nameStaysVisible() {
        var visibility = ColumnVisibility.allVisible
        visibility.setVisible(false, for: .name)
        #expect(visibility.isVisible(.name))
        #expect(!DriveColumn.name.isHideable)
        #expect(ColumnVisibility(hidden: [.name, .size]).isVisible(.name))
    }

    @Test("Each metadata column hides independently")
    func independentToggles() {
        var visibility = ColumnVisibility.allVisible
        visibility.setVisible(false, for: .created)
        visibility.setVisible(false, for: .lastEditedBy)
        #expect(!visibility.isVisible(.created))
        #expect(!visibility.isVisible(.lastEditedBy))
        #expect(visibility.isVisible(.modified))
        #expect(visibility.isVisible(.uploadedBy))
        visibility.setVisible(true, for: .created)
        #expect(visibility.isVisible(.created))
    }

    @Test("The choice survives a save/load round trip")
    func roundTrip() {
        let defaults = makeDefaults()
        var visibility = ColumnVisibility.allVisible
        visibility.setVisible(false, for: .uploadedBy)
        visibility.setVisible(false, for: .size)
        ColumnVisibilityStore(defaults: defaults).save(visibility)

        let restored = ColumnVisibilityStore(defaults: defaults).load()
        #expect(restored == visibility)
        #expect(!restored.isVisible(.uploadedBy))
        #expect(!restored.isVisible(.size))
        #expect(restored.isVisible(.created))
    }

    @Test("Stored data can't hide the name column, and unknown ids are ignored")
    func loadIgnoresBadData() {
        let defaults = makeDefaults()
        defaults.set(["name", "created", "no-such-column"], forKey: ColumnVisibilityStore.key)
        let restored = ColumnVisibilityStore(defaults: defaults).load()
        #expect(restored.isVisible(.name))
        #expect(!restored.isVisible(.created))
        #expect(restored.hidden == [.created])
    }

    @Test("Beside the preview pane, Created, Uploaded By and Last Edited By hide by default")
    func besidePreview() {
        let visibility = ColumnVisibility.allVisible
        #expect(!visibility.isVisible(.created, besidePreview: true))
        #expect(!visibility.isVisible(.uploadedBy, besidePreview: true))
        #expect(!visibility.isVisible(.lastEditedBy, besidePreview: true))
        #expect(visibility.isVisible(.modified, besidePreview: true))
        #expect(visibility.isVisible(.size, besidePreview: true))
        #expect(visibility.isVisible(.name, besidePreview: true))
    }

    @Test("A column shown explicitly stays visible beside the preview pane, and the choice is stored")
    func explicitlyShown() {
        let defaults = makeDefaults()
        var visibility = ColumnVisibility.allVisible
        visibility.setVisible(true, for: .created)
        visibility.setVisible(false, for: .size)
        ColumnVisibilityStore(defaults: defaults).save(visibility)

        let restored = ColumnVisibilityStore(defaults: defaults).load()
        #expect(restored == visibility)
        #expect(restored.isVisible(.created, besidePreview: true))
        #expect(!restored.isVisible(.uploadedBy, besidePreview: true))
        #expect(!restored.isVisible(.size))
    }
}
