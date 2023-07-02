var markers = [];
var pinMarkers = [];
var round = {
    date: new Date().toISOString(),
    course: "",
    holes: [],
};
var currentHole = {
    course: "",
    number: 1,
    strokes: [],
};
var currentStrokeIndex = 0;
var actionStack = [];

window.onload = function () {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(function (position) {
            mymap = L.map('mapid').setView([position.coords.latitude, position.coords.longitude], 18);
            L.tileLayer('https://api.mapbox.com/styles/v1/{id}/tiles/{z}/{x}/{y}?access_token={accessToken}', {
                attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors, <a href="https://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, Imagery © <a href="https://www.mapbox.com/">Mapbox</a>',
                maxZoom: 22,
                maxNativeZoom: 19,
                id: 'mapbox/satellite-v9',
                tileSize: 512,
                zoomOffset: -1,
                accessToken: 'pk.eyJ1IjoicnlhbmxjaGFuIiwiYSI6ImNsamwyb2JwcDBuYzMzbHBpb2l0dHg2ODIifQ.vkFG7K0DrbHs5O1W0CIvzw' // replace with your Mapbox access token
            }).addTo(mymap);

            var loadedData = JSON.parse(localStorage.getItem('golfData'));
            if (loadedData) {
                round = loadedData;
                round.holes.forEach(function (hole) {
                    console.log("Creating markers for hole " + hole.number)
                    hole.strokes.forEach(function (stroke) {
                        addMarker(stroke.start);
                    });
                    if (hole.pin) {
                        addPin(hole.pin)
                    }
                });

                var lastHole = round.holes[round.holes.length - 1];
                if (lastHole) {
                    currentHole = lastHole;
                    round.holes.pop();  // Remove last hole to avoid duplication
                    currentStrokeIndex = lastHole.strokes.length;
                }
                updateLocationData();
            }
        }, showError);
    } else {
        document.getElementById('error').innerHTML = "Geolocation is not supported by this browser.";
    }
}

document.getElementById("setPin").addEventListener("click", setPin);

document.getElementById('saveCourseName').addEventListener('click', function () {
    var courseName = document.getElementById('courseName').value;
    actionStack.push({
        action: "saveCourseName",
        round: JSON.parse(JSON.stringify(round)),
        currentHole: JSON.parse(JSON.stringify(currentHole)),
        currentStrokeIndex: currentStrokeIndex
    });
    round.course = courseName;
    currentHole.course = courseName;
    saveData();
    updateLocationData();
});

document.getElementById('logLocation').addEventListener('click', function () {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(showPosition, showError);
    } else {
        document.getElementById('error').innerHTML = "Geolocation is not supported by this browser.";
    }
});

document.getElementById('newHole').addEventListener('click', function () {
    if (currentHole.strokes.length > 0) {
        actionStack.push({
            action: "newHole",
            round: JSON.parse(JSON.stringify(round)),
            currentHole: JSON.parse(JSON.stringify(currentHole)),
            currentStrokeIndex: currentStrokeIndex
        });
        round.holes.push(currentHole);
        currentHole = {
            course: round.course,
            number: round.holes.length + 1,
            strokes: [],
        };
        currentStrokeIndex = 0;
        updateLocationData();
        saveData();
    } else {
        document.getElementById('error').innerHTML = "Current hole is empty, cannot create a new hole.";
    }
});

document.getElementById('newRound').addEventListener('click', function () {
    if (confirm("Are you sure you want to start a new round? All current data will be lost.")) {
        actionStack.push({
            action: "newRound",
            round: JSON.parse(JSON.stringify(round)),
            currentHole: JSON.parse(JSON.stringify(currentHole)),
            currentStrokeIndex: currentStrokeIndex
        });
        round = {
            date: new Date().toISOString(),
            course: "",
            holes: [],
        };
        currentHole = {
            course: "",
            number: 1,
            strokes: [],
        };
        currentStrokeIndex = 0;
        updateLocationData();
        localStorage.removeItem('golfData');
    }
});

document.getElementById('toggleRound').addEventListener('click', function () {
    var roundDiv = document.getElementById('roundInfo');
    if (roundDiv.style.display === "none") {
        roundDiv.style.display = "block";
    } else {
        roundDiv.style.display = "none";
    }
});

document.getElementById('copyToClipboard').addEventListener('click', function () {
    navigator.clipboard.writeText(document.getElementById('locationData').textContent);
});

document.getElementById('undoAction').addEventListener('click', function () {
    if (actionStack.length > 0) {
        var previousAction = actionStack.pop();
        round = previousAction.round;
        currentHole = previousAction.currentHole;
        currentStrokeIndex = previousAction.currentStrokeIndex;
        updateLocationData();
        saveData();
    } else {
        document.getElementById('error').innerHTML = "No action to undo.";
    }
});

function showPosition(position) {
    var club = document.getElementById('club').value;
    var stroke = {
        course: round.course,
        club: club,
        index: currentStrokeIndex,
        start: {
            x: position.coords.longitude,
            y: position.coords.latitude,
            crs: "EPSG:4326"
        }
    };
    if (currentHole.strokes.length > 0) {
        currentHole.strokes[currentHole.strokes.length - 1].aim = stroke.start;
    }
    actionStack.push({
        action: "logLocation",
        round: JSON.parse(JSON.stringify(round)),
        currentHole: JSON.parse(JSON.stringify(currentHole)),
        currentStrokeIndex: currentStrokeIndex
    });
    currentHole.strokes.push(stroke);
    addMarker(stroke.start)
    mymap.setView([position.coords.latitude, position.coords.longitude], 18);

    currentStrokeIndex++;
    updateLocationData();
    saveData();
}

function updateLocationData() {
    document.getElementById('locationData').textContent = JSON.stringify(Object.assign({}, round, {
        holes: round.holes.concat(currentHole)
    }), null, 2);
}

function saveData() {
    localStorage.setItem('golfData', JSON.stringify(Object.assign({}, round, {
        holes: round.holes.concat(currentHole)
    })));
}

function setPin() {
    if (!currentHole) {
        return;
    }
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(function (position) {
            currentHole.pin = {
                x: position.coords.longitude,
                y: position.coords.latitude,
                crs: "EPSG:4326"
            };
            if (pinMarkers.length > 0) {
                mymap.removeLayer(pinMarkers.pop());
            }
            addPin(currentHole.pin)
            saveData();
            updateLocationData();
        }, showError);
    } else {
        document.getElementById('error').innerHTML = "Geolocation is not supported by this browser.";
    }
}

function addMarker(coordinate, options = false) {
    if (!options) {
        options = { draggable: 'true' }
    }
    var marker = L.marker([coordinate.y, coordinate.x], options).addTo(mymap);
    marker.on('dragend', function (event) {
        var position = marker.getLatLng();
        coordinate.x = position.lng;
        coordinate.y = position.lat;
        updateLocationData();
        saveData();
    });
    markers.push(marker);
}

function addPin(coordinate) {
    var flagIcon = L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png', // replace with the path to your flag icon
        iconSize: [25, 41], // size of the icon
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        shadowSize: [41, 41]

    });
    var options = {
        draggable: 'true',
        icon: flagIcon,
    }
    addMarker(coordinate, options)
    pin = markers.pop()
    pinMarkers.push(pin)
}



function showError(error) {
    switch (error.code) {
        case error.PERMISSION_DENIED:
            document.getElementById('error').innerHTML = "User denied the request for Geolocation.";
            break;
        case error.POSITION_UNAVAILABLE:
            document.getElementById('error').innerHTML = "Location information is unavailable.";
            break;
        case error.TIMEOUT:
            document.getElementById('error').innerHTML = "The request to get user location timed out.";
            break;
        case error.UNKNOWN_ERROR:
            document.getElementById('error').innerHTML = "An unknown error occurred.";
            break;
    }
}
