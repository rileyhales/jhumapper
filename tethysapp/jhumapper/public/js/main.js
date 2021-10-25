const map = L.map('map', {
    zoom: 3,
    minZoom: 2,
    zoomSnap: .5,
    boxZoom: true,
    maxBounds: L.latLngBounds(L.latLng(-100.0, -270.0), L.latLng(100.0, 270.0)),
    center: [0, 0],
    timeDimension: true,
    timeDimensionControl: true,
    timeDimensionControlOptions: {
        position: "bottomleft",
        autoPlay: true,
        loopButton: true,
        backwardButton: true,
        forwardButton: true,
        timeSliderDragUpdate: true,
        minSpeed: 2,
        maxSpeed: 6,
        speedStep: 1,
    },
})

let layerShigella = null;

const layerDraw = new L.FeatureGroup();
layerDraw.addTo(map);
const drawControl = new L.Control.Draw({
    position: 'topleft',
    draw: {
        polyline: false,
        polygon: {
            allowIntersection: false, // Restricts shapes to simple polygons
        },
        circle: false, // Turns off this drawing tool
        rectangle: true,
        marker: true
    },
    edit: {
        featureGroup: layerDraw
    }
});
const URL_OPENSTREETMAP = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const layerOSM = L.tileLayer(URL_OPENSTREETMAP, {attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'});
const basemaps = {"Open Street Maps": layerOSM.addTo(map)};
const layerControl = L.control.layers(basemaps, {"Drawings": layerDraw}, {collapsed: false}).addTo(map);

const legend = L.control({position: 'bottomright'});
legend.onAdd = () => {
    let div = L.DomUtil.create('div', 'legend');
    let url = `${URL_THREDDS}?REQUEST=GetLegendGraphic&LAYER=${$("#select-layers").val()}&COLORSCALERANGE=0,50`;
    div.innerHTML = `<img src="${url}" alt="legend" style="width:100%; float:right;">`
    return div
};

const addWMS = function () {
    let layer = $("#select-layers").val()
    if (layerShigella !== null) {
        layerControl.removeLayer(layerShigella);
        map.removeLayer(layerShigella);
    }
    layerShigella = L.tileLayer.wms(URL_THREDDS, {
        layers: layer,
        format: "image/png",
        transparent: true,
        crossOrigin: false,
        colorscalerange: '0,50',
    });
    if (layer === 'probability') {
        layerShigella = L.timeDimension.layer.wms(layerShigella, {
            name: 'time',
            requestTimefromCapabilities: true,
            updateTimeDimension: true,
            updateTimeDimensionMode: 'replace',
            cache: 20,
        })
    }
    layerShigella.addTo(map)
    layerControl.addOverlay(layerShigella, "Shigella Layer")
    legend.addTo(map);
};

function onEachFeature(feature, layer) {
    layer.bindPopup(`<button class="btn btn-primary" onclick="fetchPlotData({shape: '${feature.properties.GID_1}'})">Get plots for this region (${feature.properties.GID_1})</button>`)
}

const geojsonStyle = {
    "color": "#ffca94",
    "weight": 4,
    "opacity": 0.5
}
let user_shapefile = L.geoJSON(false, {onEachFeature: onEachFeature, style: geojsonStyle});
layerControl.addOverlay(user_shapefile, "GADM World Admin boundaries")
const getGeoServerGJ = () => {
    const gsURL = "https://geoserver.hydroshare.org/geoserver/HS-bbaf9b8d1dbd43659afe7befaaa6f2ce/ows"
    let parameters = L.Util.getParamString(
        L.Util.extend({
            service: 'WFS',
            version: '1.0.0',
            request: 'GetFeature',
            typeName: 'HS-bbaf9b8d1dbd43659afe7befaaa6f2ce:gadm36_1',
            maxFeatures: 10000,
            outputFormat: 'application/json',
            parseResponse: 'getJson',
            srsName: 'EPSG:4326',
            crossOrigin: 'anonymous'
        })
    );
    $.ajax({
        async: true,
        jsonp: false,
        url: `${gsURL}${parameters}`,
        contentType: 'application/json',
        success: (data) => {
            user_shapefile.clearLayers();
            user_shapefile.addData(data).addTo(map);
            map.flyToBounds(user_shapefile.getBounds());
        },
    });
}
getGeoServerGJ()
$("#select-layers").change(() => {
    addWMS()
})
addWMS();

const fetchPlotData = (data) => {
    console.log(data)
    $("#chart_modal").modal("show")
    fetch(`${URL_QUERYVALUES}?${new URLSearchParams(data).toString()}`)
        .then(res => res.json())
        .then(res => {
            plotlyTimeseries(res)
        })
}

map.addControl(drawControl);
map.on("draw:drawstart", function (event) {
    layerDraw.clearLayers();
})
map.on("draw:created", function (event) {
    layerDraw.addLayer(event.layer);
    let data = {}
    if (event.layerType === "marker") {
        data.point = [event.layer._latlng.lat, event.layer._latlng.lng]  // event.layer._latlng -> json {lat, lng}
    } else if (event.layerType === "rectangle") {
        data.rectangle = [
            event.layer._latlngs[0][0].lat,
            event.layer._latlngs[0][0].lng,
            event.layer._latlngs[0][2].lat,
            event.layer._latlngs[0][2].lng,
        ]  // array of 4 {lat, lng}, clockwise from bottom left
    } else if (event.layerType === "polygon") {
        data.polygon = JSON.stringify(layerDraw.toGeoJSON())  // geojson object
    }
    fetchPlotData(data)
});


function plotlyTimeseries(data) {
    let layout = {
        title: 'Schigella Probability v Time',
        xaxis: {title: 'Time'},
        yaxis: {title: 'Probability (%)'}
    };
    let plots = []

    if (data.plotType === 'point') {
        plots.push({
            x: data.x,
            y: data.y,
            name: 'Probability',
            mode: 'lines+markers',
            type: 'scatter'
        })
    } else {
        const statList = ['max', 'p75', 'median', 'p25', 'min']
        statList.forEach(
            stat => plots.push({
                x: data.x,
                y: data[stat],
                name: stat,
                mode: 'lines+markers',
                type: 'scatter'
            })
        )
    }

    let lineChart = $("#line-chart");
    let histChart = $("#hist-chart");

    Plotly.newPlot('line-chart', plots, layout);
    lineChart.css('height', 500);
    Plotly.Plots.resize(lineChart[0]);

    if (data.plotType === 'point') {
        histChart.empty()
        histChart.css('height', 0);
        return
    }

    layout = {
        title: 'Distribution of Modeled Risk Values',
        xaxis: {title: 'Probability (%)'},
        yaxis: {title: 'Cell Count (Frequency)'}
    };
    plots = [{
        x: data.values,
        type: "histogram",
        xbins: {
            size: .6
        }
    }]
    Plotly.newPlot('hist-chart', plots, layout);
    histChart.css('height', 500);
    Plotly.Plots.resize(histChart[0]);
}