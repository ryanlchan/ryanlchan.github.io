// const turf = require('@turf/turf');
// const fetch = require('node-fetch');
// const osmtogeojson = require('osmtogeojson');

const GOLF_COURSE_URL = "https://overpass-api.de/api/interpreter?data=[out:json];(relation[\"name\"=\"Golf Course\"];);out%20geom;";

// Pre-calculated coefficients for the polynomial preloaded from coeffs.js
// const POLY_COEFFS = xxxx

function fetchGolfCourseData() {
    // Stub for the OSM query
    // return fetch(GOLF_COURSE_URL).then(response => {
    //     let data = response.json();
    //     data = osmtogeojson(data)
    //     return scrubOSMData(data.features)
    // });
    let data = rancho_data.response;
    data = osmtogeojson(data)
    return scrubOSMData(data.features)
}

function fetchGolfCourseBoundaries() {
    return fetch(GOLF_COURSE_URL).then(response => response.json());
}

function scrubOSMData(features) {
    for (let feature of features) {
        if (feature.properties.golf) {
            feature.properties["terrainType"] = feature.properties.golf
        }
    }
    return features
}

function createHexGrid(feature) {
    // Calculate the hexagon sidelength according to a max cell count
    const maximum_cells = 2000;
    const bbox = turf.bbox(feature);

    // Get sidelength. turf.area calculates in sq meters, we need to convert back to kilometers 
    const x = Math.sqrt((turf.area(feature)) / (maximum_cells * (3 * Math.sqrt(3) / 2))) / 1000;


    let options = { units: 'kilometers' };
    let grid = turf.hexGrid(bbox, x, options);
    // Create an empty feature collection to store the filtered features
    const filteredGrid = turf.featureCollection([]);

    // Iterate over each cell in geojson1
    turf.featureEach(grid, (cell) => {
        // Check if the cell exists within the aim feature
        if (turf.booleanContains(feature, cell)) {
            // Add the cell to the filtered collection
            filteredGrid.features.push(cell);
        }
    });
    // const filteredGrid = grid;

    return filteredGrid;
}

const findTerrainType = (point, features) => {
    // Define the priority of terrains
    const terrainPriority = ["green", "tee", "bunker", "fairway", "hazard", "penalty"];

    // Sort the features based on the priority of the terrains
    features.sort((a, b) => {
        return terrainPriority.indexOf(a.properties.terrainType) - terrainPriority.indexOf(b.properties.terrainType);
    });

    // Find the feature in which the point resides
    for (let feature of features) {
        let featureType = turf.getType(feature);
        if (featureType === 'Polygon' && turf.booleanPointInPolygon(point, feature)) {
            return feature.properties.terrainType;
        }
        else if (featureType === 'MultiPolygon') {
            // If it's a MultiPolygon, check each individual Polygon
            for (let polygon of feature.geometry.coordinates) {
                // The Polygon needs to be converted back to a GeoJSON feature to be used with booleanPointInPolygon
                let polygonFeature = turf.polygon(polygon);
                if (turf.booleanPointInPolygon(point, polygonFeature)) {
                    return feature.properties.terrainType;
                }
            }
        }
    }

    // If the point does not overlap with any of these terrain features, it is considered to be in the rough
    return "rough";
}

function probability(stddev, distance, mean = 0) {
    // Normal distribution pdf value for the given point distance
    const coefficient = 1 / (stddev * Math.sqrt(2 * Math.PI));
    const exponent = -((distance - mean) ** 2) / (2 * stddev ** 2);
    return coefficient * Math.exp(exponent);
};

function probabilityGrid(grid, aimPoint, dispersionNumber) {
    let total = 0.0;
    grid.features.forEach((feature) => {
        const distance = turf.distance(turf.center(feature), aimPoint, { units: "kilometers" }) * 1000;
        let p = probability(dispersionNumber, distance);
        feature.properties.probability = p;
        total += p;
    });
    grid.features.forEach((feature) => {
        feature.properties.probability = feature.properties.probability / total;
    });
}

function calculateStrokesRemaining(distanceToHole, terrainType) {
    // Assume that we have an polynomial function defined by POLY_COEFFS
    let totalStrokes = POLY_COEFFS[terrainType].reduce((acc, coeff, index) => acc + coeff * Math.pow(distanceToHole, index), 0);
    return totalStrokes;
}

function calculateStrokesGained(grid, holeCoordinate, strokesRemainingStart, terrainData) {
    grid.features.forEach((feature) => {
        const center = turf.center(feature);
        const distanceToHole = turf.distance(center, holeCoordinate, { units: "kilometers" }) * 1000;
        const terrainType = findTerrainType(center, terrainData);
        const strokesRemaining = calculateStrokesRemaining(distanceToHole, terrainType);
        const strokesGained = strokesRemainingStart - strokesRemaining - 1;
        feature.properties.distanceToHole = distanceToHole;
        feature.properties.terrainType = terrainType;
        feature.properties.strokesRemaining = strokesRemaining;
        feature.properties.strokesGained = strokesGained;
        feature.properties.weightedStrokesGained = strokesGained * feature.properties.probability;
    });
}

function sgGridCalculate(startCoordinate, aimCoordinate, holeCoordinate, dispersionNumber) {
    let startPoint = turf.flip(turf.point(startCoordinate));
    let aimPoint = turf.flip(turf.point(aimCoordinate));
    let holePoint = turf.flip(turf.point(holeCoordinate));
    let aimWindow = turf.circle(aimPoint, 3 * dispersionNumber / 1000, { units: "kilometers" })

    let golfCourseData = fetchGolfCourseData();

    // Determine strokes gained at the start
    let terrainTypeStart = findTerrainType(startPoint, golfCourseData);
    let distanceToHole = turf.distance(startPoint, holePoint, { units: "kilometers" }) * 1000
    let strokesRemainingStart = calculateStrokesRemaining(distanceToHole, terrainTypeStart);

    // Create a grid
    let hexGrid = createHexGrid(aimWindow);

    // Get probabilities
    probabilityGrid(hexGrid, aimPoint, dispersionNumber);
    calculateStrokesGained(hexGrid, holePoint, strokesRemainingStart, golfCourseData);

    let totalWeightedStrokesGained = hexGrid.features.reduce((sum, feature) => sum + feature.properties.weightedStrokesGained, 0);

    console.log('Total Weighted Strokes Gained:', totalWeightedStrokesGained);

    return hexGrid;
}

// Blue teebox on Rancho 1
const RANCHO_1_BLUE = [34.045387833581394, -118.4175638211316]
// Center of fairway on Rancho 1
const RANCHO_1_FAIRWAY = [34.0464857232968, -118.41542967255143]
// right flag on Rancho 1
const RANCHO_1_RIGHT_FLAG = [34.046794432521104, -118.41416477236325]
const RANCHO_1_COG = [34.04684885, -118.41427055791367]
const start = [34.0453989458967, -118.41754320137206]
const aim = [34.04649461303403, -118.41540545614271]
const pin = [34.04684885, -118.41427055791367]
let hexGrid = sgGridCalculate(RANCHO_1_BLUE, RANCHO_1_FAIRWAY, RANCHO_1_COG, 1);