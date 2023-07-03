/**
 * Golf App
 * A JavaScript program for tracking golf rounds and locations.
 */

// Variables
let mapView;
let currentHole = defaultCurrentHole();
let round = defaultRound();
let currentStrokeIndex = 0;
let layers = {};
let actionStack = [];

/**
 * ===========
 * Stroke CRUD
 * ===========
 */

/** 
 * Shows the current position on the map and logs it as a stroke.
 * @param {Position} position - The current geolocation position.
 */
function strokeCreate(position) {
    // set an undo point 
    undoCreate("strokeCreate");

    // Create the stroke object
    const club = document.getElementById("club").value;
    const stroke = {
        club,
        index: currentStrokeIndex,
        hole: currentHole.number,
        start: {
            x: position.coords.longitude,
            y: position.coords.latitude,
            crs: "EPSG:4326",
        },
    };
    if (currentHole.pin) {
        stroke.aim = currentHole.pin;
    }

    // Add the stroke to the data layer
    currentHole.strokes.push(stroke);
    currentStrokeIndex++;

    // Add the stroke to the view
    strokeMarkerCreate(stroke);
    rerender();
}

/**
 * Delete a stroke out of the round
 * @param {Number} holeId 
 * @param {Number} strokeIndex 
 */
function strokeDelete(holeNumber, strokeIndex) {
    console.debug("Deleting stroke " + strokeIndex + " from hole " + holeNumber)
    let hole = round.holes.find(h => h.number === holeNumber);
    if (hole) {
        let stroke = hole.strokes[strokeIndex];

        // Delete Marker
        let markerID = strokeMarkerID(stroke)
        layerDelete(markerID)

        // Delete from data layer
        hole.strokes.splice(strokeIndex, 1);

        // Reindex remaining strokes
        hole.strokes.forEach((stroke, index) => stroke.index = index);

        // Rerender views
        rerender();
    }
}

function strokeMove(holeNumber, strokeIndex, offset) {
    console.debug("Moving stroke " + strokeIndex + " from hole " + holeNumber + " by " + offset)
    const hole = round.holes[holeNumber - 1]
    const mover = hole.strokes[strokeIndex]
    if (offset < 0) {
        offset = Math.min(offset, -strokeIndex)
    } else {
        offset = Math.max(offset, hole.strokes.length - strokeIndex - 1)
    }
    hole.strokes.splice(strokeIndex, 1)
    hole.strokes.splice(strokeIndex + offset, 0, mover)
    hole.strokes.forEach((stroke, index) => stroke.index = index);
    // Update the map and polylines
    rerender()
}

/**
 * Adds a stroke marker to the map.
 * @param {Object} stroke - the stroke to add a marker for
 * @param {Object} options - Marker options.
 */
function strokeMarkerCreate(stroke, options) {
    const coordinate = stroke.start;
    const icon = L.icon({
        iconUrl: "circle-ypad.png", // replace with the path to your flag icon
        iconSize: [30, 45], // size of the icon
    });
    let opt = { draggable: true, opacity: .8, icon }
    if (!(options === undefined)) {
        opt = {
            ...opt,
            ...options
        }
    }
    let id = strokeMarkerID(stroke)
    let marker = markerCreate(id, coordinate, opt);
    marker.bindTooltip((function () { return strokeTooltipText(stroke) }), { permanent: true, direction: "top", offset: [0, 10] })
    mapView.setView([coordinate.y, coordinate.x], 18);
}

/**
 * Create a unique ID for a Stroke
 * @param {Object} stroke 
 * @returns {String}
 */
function strokeMarkerID(stroke) {
    return "stroke_marker_" + stroke.index + "_hole_" + stroke.hole
}


/**
 * Return the tooltip text for a stroke marker
 * @param {Object} stroke 
 */
function strokeTooltipText(stroke) {
    const club = stroke.club;
    const distance = Math.round(getDistance(stroke) * 10) / 10; // jesus christ I cannot believe how dumb javascript is just let me round floats
    return `${club} (${distance}m)`
}

/**
 * ============
 * Stroke Lines
 * ============
 */

/**
 * Create a stroke line for a given hole
 * @param {Object} hole 
 */
function strokelineCreate(hole) {
    let points = [];
    let strokeline;
    // console.debug("Creating strokeline for hole " + hole.number)

    // Sort strokes by index and convert to LatLng objects
    hole.strokes.sort((a, b) => a.index - b.index).forEach(stroke => {
        points.push(L.latLng(stroke.start.y, stroke.start.x));
    });

    // If a pin is set, add it to the end of the polyline
    if (hole.pin) {
        points.push(L.latLng(hole.pin.y, hole.pin.x));
    }

    // Only create polyline if there's more than one point
    if (points.length == 0) {
        return
    }

    // Add Line to map
    strokeline = L.polyline(points, { color: 'white', weight: 2 })
    id = strokelineID(hole)
    layerCreate(id, strokeline)
    return strokeline
}

/**
 * Rerender Stroke Lines
 */
function strokelineUpdate() {
    // Remove existing polylines
    strokelineDeleteAll();

    // For each hole, add a polyline
    for (const hole of round.holes) {
        strokelineCreate(hole)
    }
}

/**
 * Clears the current polylines connecting markers
 */
function strokelineDeleteAll() {
    for (const hole of round.holes) {
        layerDelete(strokelineID(hole))
    }
}

/**
 * Generate a unique layer primary key for this hole
 * @param {Object} hole 
 * @returns String
 */
function strokelineID(hole) {
    return "strokeline_hole" + hole.number
}

/**
 * ====
 * Holes
 * ====
 */

/**
 * Create a new hole
 */
function holeCreate() {
    if (currentHole.strokes.length > 0) {
        undoCreate("holeCreate")
        currentHole = { ...defaultCurrentHole(), number: round.holes.length + 1 };
        round.holes.push(currentHole);
        currentStrokeIndex = 0;
        rerender();
    } else {
        document.getElementById("error").innerText = "Current hole is empty, cannot create a new hole.";
    }
}

/**
 * Sets a pin at the current location.
 */
function holePinCreate() {
    if (!currentHole) {
        return;
    }
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(function (position) {
            currentHole.pin = {
                x: position.coords.longitude,
                y: position.coords.latitude,
                crs: "EPSG:4326",
            };
            const id = holePinID(hole);
            layerDelete(id)
            pinMarkerCreate(currentHole);

            // Rerender views
            rerender();
        }, showError);
    } else {
        document.getElementById("error").innerText = "Geolocation is not supported by this browser.";
    }
}

function holePinID(hole) {
    return "hole_pin_" + hole.number
}

/**
 * Adds a pin marker to the map.
 * @param {Object} hole - The hole to add a pin for
 */
function pinMarkerCreate(hole) {
    const coordinate = hole.pin;
    const holeNum = hole.number
    const flagIcon = L.icon({
        iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png", // replace with the path to your flag icon
        iconSize: [25, 41], // size of the icon
        shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png",
        shadowSize: [41, 41],
        iconAnchor: [12, 41]
    });
    const options = {
        draggable: true,
        icon: flagIcon,
        title: String(holeNum),
    };
    const id = holePinID(hole);
    markerCreate(id, coordinate, options);
}

/**
 * ======
 * Rounds
 * ======
 */

/**
 * Create a new round and clear away all old data
 */
function roundCreate() {
    // Set undo point
    undoCreate("roundCreate")

    const courseName = document.getElementById("courseName").value;

    // Reset all major data
    localStorage.removeItem("golfData");
    round = { ...defaultRound(), course: courseName };
    currentHole = round.holes[0]
    currentStrokeIndex = 0;
    updateLocationData();
    layerDeleteAll()
    saveData()
}

function defaultCurrentHole() {
    return {
        number: 1,
        strokes: [],
    };
}

function defaultRound() {
    return {
        date: new Date().toISOString(),
        course: "Rancho Park Golf Course",
        holes: [defaultCurrentHole()],
    };
}

/**
 * ==============
 * Saving/Loading
 * ==============
 */
/**
 * Saves the current data to localStorage.
 */

/**
 * Save round data to localstorage
 */
function saveData() {
    localStorage.setItem(
        "golfData",
        JSON.stringify({ ...round })
    );
    updateStats();
}

/**
 * Loads the data from localStorage and initializes the map.
 */
function loadData() {
    const loadedData = JSON.parse(localStorage.getItem("golfData"));
    if (loadedData) {
        round = loadedData;
        console.log("Rehydrating round from localStorage")
        round.holes.forEach(function (hole) {
            console.debug(`Creating markers for hole ${hole.number}`);
            hole.strokes.forEach(function (stroke) {
                console.debug(`Creating stroke markers for hole ${hole.number} stroke ${stroke.index}`);
                strokeMarkerCreate(stroke);
            });
            if (hole.pin) {
                console.debug(`Creating pin markers for hole ${hole.number}`);
                pinMarkerCreate(hole);
            }
        });

        const lastHoleIndex = round.holes.length - 1;
        if (lastHoleIndex >= 0) {
            currentHole = round.holes[lastHoleIndex];
            currentStrokeIndex = currentHole.strokes.length;
        }
    }
    rerender();
}

/**
 * ===========
 * Base Marker
 * ===========
 */

/**
 * Adds a marker to the map.
 * @param {Object} coordinate - The coordinate object { x, y, crs }.
 * @param {Object} options - Marker options.
 */
function markerCreate(name, coordinate, options) {
    const marker = L.marker([coordinate.y, coordinate.x], options);
    marker.on("drag", handleMarkerDrag(marker, coordinate));
    layerCreate(name, marker)
    strokelineUpdate();
    return marker
}

/**
 * Shortcut factory for marker drag callbacks
 * @param {L.marker} marker 
 */
function handleMarkerDrag(marker, coordinate) {
    return (function mdrag(event) {
        const position = marker.getLatLng();
        coordinate.x = position.lng;
        coordinate.y = position.lat;
        let tooltip = marker.getTooltip();
        if (tooltip) {
            tooltip.update()
        }
        rerender();
    });
}

/**
 * ==================
 * Undo functionaltiy
 * ==================
 */

/**
 * Handles the click event for undoing the last action.
 */
function handleUndoActionClick() {
    undoRun();
}

/**
 * Set an undo point that you can return to
 * @param {String} action 
 */
function undoCreate(action) {
    actionStack.push({
        action,
        round: { ...round },
        currentHoleNum: currentHole.number,
        currentStrokeIndex,
    });
    console.debug("Created a new undo point for action#" + action)
}

/**
 * Undo off the top of the action stack
 */
function undoRun() {
    if (actionStack.length > 0) {
        const previousAction = actionStack.pop();
        round = previousAction.round;
        currentHole = round.holes[previousAction.currentHoleNum - 1];
        currentStrokeIndex = previousAction.currentStrokeIndex;
        updateLocationData();
        saveData();
    } else {
        document.getElementById("error").innerText = "No action to undo.";
        console.error("No action to undo.");
    }
}


/**
 * =========
 * Distances
 * =========
 */

/**
 * Calculates the distance between two coordinates in meters.
 * @param {Object} coord1 - The first coordinate object { x, y }.
 * @param {Object} coord2 - The second coordinate object { x, y }.
 * @returns {number} The distance between the coordinates in meters.
 */
function calculateDistance(coord1, coord2) {
    const lat1 = coord1.y;
    const lon1 = coord1.x;
    const lat2 = coord2.y;
    const lon2 = coord2.x;
    const R = 6371e3; // meters
    const phi1 = (lat1 * Math.PI) / 180; // phi, lambda in radians
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a =
        Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
        Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    const distance = R * c; // meters
    return distance;
}

/**
 * Get the distance from this stroke to the next
 * @param {Object*} stroke 
 */
function getDistance(stroke) {
    let distance = 0;
    const hole = round.holes[stroke.hole - 1]
    const following = hole.strokes[stroke.index + 1]
    if (following) {
        distance = calculateDistance(stroke.start, following.start);
    } else if (hole.pin) {
        distance = calculateDistance(stroke.start, hole.pin);
    }

    return distance
}

/**
 * ========
 * LayerSet
 * A frontend for tracking and reading back out layers
 * ========
 */

/**
 * Store a layer in the layerSet
 * @param {String} id 
 * @param {*} object 
 */
function layerCreate(id, object) {
    if (layers[id]) {
        console.error("Layer Error: ID " + id + " already exists!")
        return
    }
    layers[id] = object
    mapView.addLayer(object)
}

/**
 * Get a view layer from the Layer Set using an ID
 * @param {String} id 
 * @returns {*} object from db
 */
function layerRead(id) {
    return layers[id]
}

/**
 * Delete a layer with a given ID
 * @param {String} id 
 */
function layerDelete(id) {
    if (layers[id]) {
        mapView.removeLayer(layers[id])
        delete layers[id]
    }
}

/**
 * Delete all layers
 */
function layerDeleteAll() {
    for (const id in layers) {
        mapView.removeLayer(layers[id])
        delete layers[id]
    }
}

/**
 * Return an object of id to layers
 * @returns {Object}
 */
function layerReadAll() {
    return layers
}

/**
 * =======================
 * Views/Output formatting
 * =======================
 */

/**
 * Initialize the leaflet map and satellite baselayer
 */
function mapViewCreate() {
    mapView = L.map("mapid").setView([36.567383, -121.947729], 18);
    L.tileLayer("https://api.mapbox.com/styles/v1/{id}/tiles/{z}/{x}/{y}?access_token={accessToken}", {
        attribution:
            'Map data &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors, <a href="https://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, Imagery © <a href="https://www.mapbox.com/">Mapbox</a>',
        maxZoom: 22,
        maxNativeZoom: 19,
        id: "mapbox/satellite-v9",
        tileSize: 512,
        zoomOffset: -1,
        accessToken:
            "pk.eyJ1IjoicnlhbmxjaGFuIiwiYSI6ImNsamwyb2JwcDBuYzMzbHBpb2l0dHg2ODIifQ.vkFG7K0DrbHs5O1W0CIvzw", // replace with your Mapbox access token
    }).addTo(mapView);
}

/**
 * Updates the location data displayed on the page.
 */
function updateLocationData() {
    const locationData = document.getElementById("locationData");
    locationData.textContent = JSON.stringify(
        { ...round },
        null,
        2
    );
}

/**
 * Updates the statistics information on the page.
 */
function updateStats() {
    const holeElement = document.getElementById("holeStats");
    const strokeElement = document.getElementById("strokeStats");
    if (currentHole) {
        holeElement.innerText = `Hole ${currentHole.number} | ${currentHole.strokes.length} Strokes`;
        strokeElement.innerHTML = "";
        currentHole.strokes.forEach(function (stroke, index) {
            let distance = 0;
            if (currentHole.strokes[index + 1]) {
                distance = calculateDistance(stroke.start, currentHole.strokes[index + 1].start);
            } else if (currentHole.pin) {
                distance = calculateDistance(stroke.start, currentHole.pin);
            }
            const listItem = document.createElement("li");
            listItem.innerHTML = `${index + 1}. ${stroke.club} (${Math.round(distance)}m) | `;
            let actions = [strokeDeleteViewCreate(stroke), " | ", strokeMoveViewCreate(stroke, -1), " | ", strokeMoveViewCreate(stroke, 1)];
            listItem.append(...actions);
            strokeElement.appendChild(listItem);
        });
    } else {
        holeElement.innerText = "";
        strokeElement.innerHTML = "";
    }
}

/**
 * Create a link that deletes this stroke
 * @param {Object} stroke 
 * @returns {link}
 */
function strokeDeleteViewCreate(stroke) {
    let link = document.createElement("button");
    link.innerHTML = "delete";
    link.id = "stroke_" + stroke.index + "_delete"
    link.addEventListener("click", (() => {
        strokeDelete(stroke.hole, stroke.index);
    }));
    return link
}

/**
 * Create a link that moves this stroke
 * @param {Object} stroke the stroke to move
 * @param {Number} offset the offset for the stroke index
 * @returns {link}
 */
function strokeMoveViewCreate(stroke, offset) {
    let link = document.createElement("button");
    link.innerHTML = "Move " + offset;
    link.id = "stroke_" + stroke.index + "_move_" + offset
    link.addEventListener("click", (() => {
        strokeMove(stroke.hole, stroke.index, offset);
    }));
    return link
}

/**
 * Rerender key views based on volatile data
 */
function rerender() {
    updateLocationData();
    strokelineUpdate();
    saveData();
}

/**
 * =========================
 * Handlers for click events
 * =========================
 */

/**
 * Handles the window onload event.
 */
function handleLoad() {
    mapViewCreate();
    loadData();
}

/**
 * Handles the click event for logging the current location.
 */
function handleLogLocationClick() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(strokeCreate, showError);
    } else {
        document.getElementById("error").innerText = "Geolocation is not supported by this browser.";
    }
}

/**
 * Handles the click event for creating a new hole.
 */
function handleNewHoleClick() {
    holeCreate();
}

/**
 * Handles the click event for starting a new round.
 */
function handleRoundCreateClick() {
    if (confirm("Are you sure you want to start a new round? All current data will be lost.")) {
        roundCreate();
    }
}

/**
 * Handles the click event for toggling the round information display.
 */
function handleToggleRoundClick() {
    const roundDiv = document.getElementById("roundInfo");
    roundDiv.classList.toggle("inactive");
}

/**
 * Handles the click event for copying location data to the clipboard.
 */
function handleCopyToClipboardClick() {
    navigator.clipboard.writeText(document.getElementById("locationData").textContent);
}

/**
 * Shows an error message based on the geolocation error code.
 * @param {PositionError} error - The geolocation error object.
 */
function showError(error) {
    switch (error.code) {
        case error.PERMISSION_DENIED:
            document.getElementById("error").innerText = "User denied the request for Geolocation.";
            break;
        case error.POSITION_UNAVAILABLE:
            document.getElementById("error").innerText = "Location information is unavailable.";
            break;
        case error.TIMEOUT:
            document.getElementById("error").innerText = "The request to get user location timed out.";
            break;
        case error.UNKNOWN_ERROR:
            document.getElementById("error").innerText = "An unknown error occurred.";
            break;
    }
}

// Event listeners
window.onload = handleLoad;
document.getElementById("holePinCreate").addEventListener("click", holePinCreate);
document.getElementById("logLocation").addEventListener("click", handleLogLocationClick);
document.getElementById("newHole").addEventListener("click", handleNewHoleClick);
document.getElementById("roundCreate").addEventListener("click", handleRoundCreateClick);
document.getElementById("toggleRound").addEventListener("click", handleToggleRoundClick);
document.getElementById("copyToClipboard").addEventListener("click", handleCopyToClipboardClick);
document.getElementById("undoAction").addEventListener("click", handleUndoActionClick);