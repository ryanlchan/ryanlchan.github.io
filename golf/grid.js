// const turf = require('@turf/turf');
// const fetch = require('node-fetch');
// const osmtogeojson = require('osmtogeojson');

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search?q=";

function setCache(key, json) {
    localStorage.setItem(
        key,
        JSON.stringify({ ...json })
    );
}

function readCache(key) {
    return JSON.parse(localStorage.getItem(key));
}

/**
 * Fetch some data from OSM, process it, then cache it in localStorage
 * @param {String} url 
 * @param {String} storageKey 
 * @param {Function} callback 
 * @returns {Promise}
 */
function fetchOSMData(query, storageKey, callback) {
    let opt = {
        method: "POST",
        mode: "cors",
        redirect: "follow",
        headers: {
            Accept: "*",
        },
        body: `data=${encodeURIComponent(query)}`
    };
    return fetch(OVERPASS_URL, opt)
        .then(response => {
            if (!response.ok) {
                return Promise.reject('Request failed: HTTP ' + response.status);
            }
            return response.json();
        }).then((data) => {
            console.debug("Succesfully downloaded OSM polys, starting processing")
            data = osmtogeojson(data);
            data = scrubOSMData(data)
            console.debug("Succesfully processed OSM polys, caching as " + storageKey)
            setCache(storageKey, data)
            if (callback) {
                callback(data);
            }
        });
}

/**
 * Precache all course data
 * @param {String} courseName 
 * @param {Function} callback 
 * @returns {Promise}
 */
function fetchAllGolfCourseData(courseName, callback) {
    let polys = fetchGolfCourseData(courseName);
    return Promise.all([polys], callback);
}

/**
 * Precache course polys
 * @param {String} courseName 
 * @param {Boolean} force set to true to force a rewrite of cached polys
 * @param {Function} callback
 * @returns {Promise}
 */
function fetchGolfCourseData(courseName, force, callback) {
    let query = `[out: json];(way["leisure"="golf_course"]["name"~"${courseName}"];relation["leisure"="golf_course"]["name"~"${courseName}"];);out geom;`
    let storageKey = `courseData-${courseName}`;
    if (force || !readCache(storageKey)) {
        return fetchOSMData(query, storageKey, callback);
    } else {
        return new Promise(() => setTimeout(callback, 0));
    }
}

function getGolfCourseData(courseName) {
    // Check if the cache has it first
    let storageKey = `courseData-${courseName}`;
    let polys = readCache(storageKey);
    if (polys) {
        // Cache hit, just return the callback asap
        return polys;
    } else {
        console.warn("Course has no polys or not found");
        return Error("No data available");
    }
}

function scrubOSMData(geojson) {
    for (let feature of geojson.features) {
        if (feature.properties.golf) {
            feature.properties["terrainType"] = feature.properties.golf
        }
        let featureType = turf.getType(feature);
        if (featureType === 'MultiPolygon') {
            // If it's a MultiPolygon, split into polygons
            for (let polygon of feature.geometry.coordinates) {
                let polygonFeature = turf.polygon(polygon);
                polygonFeature.properties = feature.properties;
            }
        }
    }
    presortTerrain(geojson);
    return geojson
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

function presortTerrain(collection) {
    // Define the priority of terrains
    const terrainPriority = ["green", "tee", "bunker", "fairway", "hazard", "penalty"];

    // Sort the features based on the priority of the terrains
    collection.features.sort((a, b) => {
        return terrainPriority.indexOf(a.properties.terrainType) - terrainPriority.indexOf(b.properties.terrainType);
    });
    return collection
}

function findBoundaries(collection) {
    return turf.featureCollection(collection.features.reduce((acc, feature) => {
        if (feature.properties.leisure == "golf_course") {
            return acc.concat(feature);
        }
    }, []));
}

/**
 * 
 * @param {Point} point 
 * @param {FeatureCollection} collection A prescrubbed collection of Features (sorted, single poly'd, etc)
 * @param {FeatureCollection} bounds A prescrubbed collection of boundaries, optional
 * @returns 
 */
function findTerrainType(point, collection, bounds) {
    if (!bounds) {
        bounds = findBoundaries(collection);
    }
    if (bounds.features.every((bound) => !turf.booleanPointInPolygon(point, bound))) {
        return "out_of_bounds"
    }
    // Find the feature in which the point resides
    for (let feature of collection.features) {
        let featureType = turf.getType(feature);
        if (featureType === 'Polygon' && turf.booleanPointInPolygon(point, feature)) {
            if (feature.properties.terrainType) {
                return feature.properties.terrainType;
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

function calculateStrokesGained(grid, holeCoordinate, strokesRemainingStart, golfCourseData) {
    let bounds = findBoundaries(golfCourseData);

    grid.features.forEach((feature) => {
        const center = turf.center(feature);
        const distanceToHole = turf.distance(center, holeCoordinate, { units: "kilometers" }) * 1000;
        const terrainType = findTerrainType(center, golfCourseData, bounds);
        const strokesRemaining = calculateStrokesRemaining(distanceToHole, terrainType);
        const strokesGained = strokesRemainingStart - strokesRemaining - 1;
        feature.properties.distanceToHole = distanceToHole;
        feature.properties.terrainType = terrainType;
        feature.properties.strokesRemaining = strokesRemaining;
        feature.properties.strokesGained = strokesGained;
        feature.properties.weightedStrokesGained = strokesGained * feature.properties.probability;
    });
}

function sgGridCalculate(startCoordinate, aimCoordinate, holeCoordinate, dispersionNumber, courseName) {
    let golfCourseData = getGolfCourseData(courseName);
    if (golfCourseData instanceof Error) {
        // If no data currently available, reraise error to caller
        return golfCourseData;
    }
    presortTerrain(golfCourseData);
    let startPoint = turf.flip(turf.point(startCoordinate));
    let aimPoint = turf.flip(turf.point(aimCoordinate));
    let holePoint = turf.flip(turf.point(holeCoordinate));
    let aimWindow = turf.circle(aimPoint, 3 * dispersionNumber / 1000, { units: "kilometers" })

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

/**
 * Calculate the error remainder function for a normal
 * @param {Number} x
 * @param {Number} mean
 * @param {Number} standardDeviation
 * @returns {Number}
 */
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

/**
 * Calculates the cumulative distribution function for a normal
 * @param {Number} x 
 * @param {Number} mean 
 * @param {Number} standardDeviation 
 * @returns {Number}
 */
function cdf(x, mean, standardDeviation) {
    const erf = erf(x, mean, standardDeviation);
    const z = (x - mean) / (standardDeviation * Math.sqrt(2));
    const cdf = 0.5 * (1 + Math.sign(z) * erf);
    return cdf;
}