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
        feature.properties.distanceToAim = distance
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

function erf(x, mean, standardDeviation) {
    const z = (x - mean) / (standardDeviation * Math.sqrt(2));
    const t = 1 / (1 + 0.3275911 * Math.abs(z));
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    return 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
}

function cdf(x, mean, standardDeviation) {
    const erf = erf(x, mean, standardDeviation);
    const z = (x - mean) / (standardDeviation * Math.sqrt(2));
    const cdf = 0.5 * (1 + Math.sign(z) * erf);
    return cdf;
}