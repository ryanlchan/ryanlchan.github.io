// Tests
function runTests() {
    // Set a undo point
    undoCreate("tests")
    let backup = [...actionStack]

    // Reset everything to fresh
    round = { ...defaultRound(), course: courseName };
    currentHole = round.holes[0]
    actionStack = []

    // Test logging location
    const position = {
        coords: {
            latitude: 40.712776,
            longitude: -74.005974,
        },
    };
    strokeCreate(position);
    console.assert(currentHole.strokes.length === 1, "Failed to log location");

    // Test creating a new hole
    handleNewHoleClick();
    console.assert(round.holes.length === 2, "Failed to create a new hole");
    console.assert(currentHole.number === 2, "Failed to update current hole number");

    // Test starting a new round
    handleRoundCreateClick();
    console.assert(round.holes.length === 1, "Failed to start a new round");
    console.assert(currentHole.number === 1, "Failed to reset current hole number");

    // Test undoing an action
    let valid = round.course
    undoCreate("test undo")
    round.course = "UNDO ME"
    handleUndoActionClick();
    console.assert(round.course === valid, "Failed to undo action");

    console.log("All tests passed!");
    console.log("Undoing test stack")
    actionStack = [...backup];
    handleUndoActionClick();

    // Blue teebox on Rancho 1
    const RANCHO_1_BLUE = [34.045387833581394, -118.4175638211316]
    // Center of fairway on Rancho 1
    const RANCHO_1_FAIRWAY = [34.0464857232968, -118.41542967255143]
    // right flag on Rancho 1
    const RANCHO_1_COG = [34.04684885, -118.41427055791367]
    let hexGrid = sgGridCalculate(RANCHO_1_BLUE, RANCHO_1_FAIRWAY, RANCHO_1_COG, 1);
    let wsg = hexGrid.features.reduce((sum, feature) => sum + feature.properties.weightedStrokesGained);
    console.assert(Math.abs(wsg - 0.1) <= 0.05, "Failed to calculate weighted strokes gained");
}

function initTests() {
    if (typeof mapView !== "undefined") {
        runTests();
    } else {
        // Delay running the tests by waiting for the map to be initialized
        setTimeout(initTests, 100);
    }
}

let params = new URL(document.location).searchParams;
if (params.get("test")) {
    initTests()
}