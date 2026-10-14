import Foundation
import Testing
@testable import EffectDrive

@Suite("ListingRules")
struct ListingRulesTests {
    static let allSorts = SortColumn.allCases.flatMap { [ListingSort($0, .forward), ListingSort($0, .reverse)] }

    @Test("The first click sorts names and people A to Z, dates and size newest or largest first")
    func firstClickDirection() {
        #expect(ListingSort(.name).rawValue == "name-asc")
        #expect(ListingSort(.uploadedBy).rawValue == "uploaded-by-asc")
        #expect(ListingSort(.editedBy).rawValue == "edited-by-asc")
        #expect(ListingSort(.created).rawValue == "created-desc")
        #expect(ListingSort(.modified).rawValue == "modified-desc")
        #expect(ListingSort(.size).rawValue == "size-desc")
        #expect(ListingSort.default == ListingSort(.modified))
    }

    @Test("Every sort the headers offer is one the API accepts", arguments: allSorts)
    func sortIsAnAPIValue(sort: ListingSort) {
        #expect(sort.query?.rawValue == sort.rawValue)
    }

    @Test("The type filter is sent as sorted, comma-separated types; none sends nothing")
    func filterQuery() {
        #expect(ListingFilter(["kt", "jpg"]).query == "jpg,kt")
        #expect(ListingFilter().query == nil)
    }

    @Test("The summary lists the selected types with their dots, sorted")
    func summary() {
        #expect(ListingRules.summary(of: ["kt", "jpg"]) == ".jpg, .kt")
    }

    @Test("Empty states name the chosen types in a sentence")
    func describeTypes() {
        #expect(ListingRules.describe(["jpg"]) == ".jpg")
        #expect(ListingRules.describe(["kt", "jpg"]) == ".jpg or .kt")
        #expect(ListingRules.describe(["txt", "kt", "jpg"]) == ".jpg, .kt or .txt")
    }
}
