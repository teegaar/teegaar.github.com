/*
 Tiny Leaflet plugin for radiation level.
 Based on Leaflet.heat plugin by Vladimir Agafonkin - https://github.com/Leaflet/Leaflet.heat
*/

L.RadLayer = (L.Layer ? L.Layer : L.Class).extend({

    // options: {
    //     minOpacity: 0.05,
    //     maxZoom: 18,
    //     radius: 25,
    //     blur: 15,
    //     max: 1.0
    // },

    initialize: function (latlngs, options) {
        this._latlngs = latlngs;
        L.setOptions(this, options);
    },

    setLatLngs: function (latlngs) {
        this._latlngs = latlngs;
        return this.redraw();
    },

    addLatLng: function (latlng) {
        this._latlngs.push(latlng);
        return this.redraw();
    },

    setOptions: function (options) {
        L.setOptions(this, options);
        return this.redraw();
    },

    redraw: function () {
        if (!this._frame && !this._map._animating) {
            this._frame = L.Util.requestAnimFrame(this._redraw, this);
        }
        return this;
    },

    onAdd: function (map) {
        this._map = map;

        if (!this._canvas) {
            this._initCanvas();
        }

        map._panes.overlayPane.appendChild(this._canvas);

        map.on('moveend', this._reset, this);

        if (map.options.zoomAnimation && L.Browser.any3d) {
            map.on('zoomanim', this._animateZoom, this);
        }

        this._reset();
    },

    onRemove: function (map) {
        map.getPanes().overlayPane.removeChild(this._canvas);

        map.off('moveend', this._reset, this);

        if (map.options.zoomAnimation) {
            map.off('zoomanim', this._animateZoom, this);
        }
    },

    addTo: function (map) {
        map.addLayer(this);
        return this;
    },

    _initCanvas: function () {
        var canvas = this._canvas = L.DomUtil.create('canvas', 'leaflet-radmap-layer leaflet-layer');

        var size = this._map.getSize();
        canvas.width  = size.x;
        canvas.height = size.y;

        var animated = this._map.options.zoomAnimation && L.Browser.any3d;
        L.DomUtil.addClass(canvas, 'leaflet-zoom-' + (animated ? 'animated' : 'hide'));

        if (!this._circle) {
            this._createCircle();
        }

        if (!this._grad) {
            this._createGrad(); 
        }
    },

    _reset: function () {
        var topLeft = this._map.containerPointToLayerPoint([0, 0]);
        L.DomUtil.setPosition(this._canvas, topLeft);

        var size = this._map.getSize();

        if (this._canvas._width !== size.x) {
            this._canvas.width = size.x;
        }
        if (this._canvas._height !== size.y) {
            this._canvas.height = size.y;
        }

        this._redraw();
    },

    _redraw: function () {
        var data = [],
            r = this._r,
            size = this._map.getSize(),
            bounds = new L.LatLngBounds(
                this._map.containerPointToLatLng(L.point([-r, -r])),
                this._map.containerPointToLatLng(size.add([r, r]))),

            max = this.options.max === undefined ? 1 : this.options.max,
            maxZoom = this.options.maxZoom === undefined ? this._map.getMaxZoom() : this.options.maxZoom,
            v = 1 / Math.pow(2, Math.max(0, Math.min(maxZoom - this._map.getZoom(), 12))),
            cellSize = r / 4,
            grid = [],
            panePos = this._map._getMapPanePos(),
            offsetX = panePos.x % cellSize,
            offsetY = panePos.y % cellSize,
            i, len, p, cell, x, y, j, len2, k;

        //console.log('data size', this._latlngs.length);
        //console.log('scale: v =', v);

        //console.time('process');
        var data = {
            x: new Array(), 
            y: new Array(), 
            t: new Array()
        };

        for (i = 0, len = this._latlngs.length; i < len; i++) {
            if (bounds.contains(this._latlngs[i])) {
                p = this._map.latLngToContainerPoint(this._latlngs[i]);
                x = Math.floor((p.x - offsetX) / cellSize) + 2;
                y = Math.floor((p.y - offsetY) / cellSize) + 2;

                var alt =
                    this._latlngs[i].alt !== undefined ? this._latlngs[i].alt :
                    this._latlngs[i][2] !== undefined ? +this._latlngs[i][2] : 1;
                //console.log('alt', alt);
                k = alt * v;

                grid[y] = grid[y] || [];
                cell = grid[y][x];

                if (!cell) {
                    grid[y][x] = [p.x, p.y, k, 1];

                } else {
                    cell[0] = (cell[0] * cell[2] + p.x * k) / (cell[2] + k); // x
                    cell[1] = (cell[1] * cell[2] + p.y * k) / (cell[2] + k); // y
                    cell[2] += k; // cumulated intensity value
                    cell[3] += 1; // number of cells
                }
            }
        }

        var points = new Array();
        for (i = 0, len = grid.length; i < len; i++) {
            if (grid[i]) {
                for (j = 0, len2 = grid[i].length; j < len2; j++) {
                    cell = grid[i][j];
                    if (cell) {
                        data.x.push(cell[0]);
                        data.y.push(cell[1]);
                        data.t.push((cell[2] / cell[3]) / v); // average and normalize intensity
                        points.push({x: cell[0], y: cell[1], t: (cell[2] / cell[3]) / v});
                    }
                }
            }
        }
        //console.timeEnd('process');
        //console.log('points', points);

        var ctx = this._canvas.getContext('2d');
        var width = this._canvas.width;
        var height = this._canvas.height;

        //console.log('opt:', this.options);

        try {
            //console.log('grid size: ', grid.length);
            
            
            //console.time('kriging');
            var model = "exponential";
            var sigma2 = 0, alpha = 100;
            var fitModel = kriging.train(data.t, data.x, data.y, model, sigma2, alpha);
            this._model = fitModel;
            //console.timeEnd('kriging');

            console.time('plot');
            ctx.clearRect(0, 0, width, height);

            //ctx.globalAlpha = 1;
            for (var i = 0; i < points.length; i++) {
                ctx.drawImage(this._circle, points[i].x - this._r, points[i].y - this._r);
            }

            var img = ctx.getImageData(0, 0, width, height);
            for (var i = 0, len = img.data.length, p; i < len; i += 4) {
                var x = i / 4 % width;
                var y = i / 4 / width;
                if (img.data[i + 3] > 0) {
                    var t = Math.round(kriging.predict(x, y, fitModel) / max * 255);
                    img.data[i + 0] = this._grad[t * 4];
                    img.data[i + 1] = this._grad[t * 4 + 1];
                    img.data[i + 2] = this._grad[t * 4 + 2];
                    img.data[i + 3] *= 0.8;
                }
            }
            ctx.putImageData(img, 0, 0);
            console.timeEnd('plot');

        } catch (e) {

            // var message = e,
            //     m = ctx.measureText(message);
            
            // ctx.fillStyle = 'red';
            // ctx.font = "20px Verdana";            
            // ctx.fillText(message, (width - m.width) / 2, (height - 20) / 2);
            // console.log(message, (width - m.width) / 2, (height - 20) / 2);

            // krigint failed - not enough data points? - draw an average level
            var avg = 0;
            for (var i = 0; i < data.t.length; i++) {
                avg += data.t[i];
            }
            avg /= data.t.length;
            console.log('avg', avg, avg / max * 255);

            console.time('plot no kriging');
            ctx.clearRect(0, 0, width, height);
            for (var i = 0; i < points.length; i++) {
                ctx.drawImage(this._circle, points[i].x - this._r, points[i].y - this._r);
            }
            var img = ctx.getImageData(0, 0, width, height);
            for (var i = 0, len = img.data.length, p; i < len; i += 4) {
                var x = i / 4 % width;
                var y = i / 4 / width;
                if (img.data[i + 3] > 0) {
                    var t = Math.round(avg / max * 255);
                    img.data[i + 0] = this._grad[t * 4];
                    img.data[i + 1] = this._grad[t * 4 + 1];
                    img.data[i + 2] = this._grad[t * 4 + 2];
                }
            }
            ctx.putImageData(img, 0, 0);
            console.timeEnd('plot no kriging');
        }

        this._frame = null;
    },


    _createCircle: function() {
        var circle = document.createElement('canvas');

        var r = this.options.radius || 32,
            blur = this.options.blur || 32,
            ctx = circle.getContext('2d'),
            r2 = r + blur;

        circle.width = circle.height = r2 * 2;

        ctx.shadowOffsetX = 200;//ctx.shadowOffsetY = 200;
        ctx.shadowBlur = blur;
        ctx.shadowColor = 'black';

        ctx.beginPath();
        ctx.arc(r2 - 200, r2, r, 0, Math.PI * 2);
        ctx.closePath();
        ctx.fillStyle = 'black';
        ctx.fill();

        this._circle = circle;
        this._r = 2 * r;

        return circle;
    },

    _createGrad: function() {
        // create a 256x1 gradient that we'll use to turn a grayscale heatmap into a colored one
        var canvas = document.createElement('canvas'),
            ctx = canvas.getContext('2d'),
            gradient = ctx.createLinearGradient(0, 0, 0, 256);

        canvas.width = 1;
        canvas.height = 256;

        var grad = this.options.grad || {
            0.4: 'blue',
            0.6: 'cyan',
            0.7: 'lime',
            0.8: 'yellow',
            1.0: 'red'
        };

        for (var i in grad) {
            gradient.addColorStop(i, grad[i]);
        }

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 1, 256);

        this._grad = ctx.getImageData(0, 0, 1, 256).data;
    },

    onMapClick: function (e) {
        var popup = L.popup();

        console.log(e.target);

        var cellSize = e.target._r / 4,
            panePos = e.target._map._getMapPanePos(),
            offsetX = panePos.x % cellSize,
            offsetY = panePos.y % cellSize;

            p = this._map.latLngToContainerPoint(e.latlng);
            x = Math.floor((p.x - offsetX) / cellSize) + 2;
            y = Math.floor((p.y - offsetY) / cellSize) + 2;

        if (this._model) {
           var value = kriging.predict(x, y, this._model);

            popup
                .setLatLng(e.latlng)
                .setContent("You clicked the map at " + e.latlng.toString() + "<br>Radiation: " + value)
                .openOn(map);
        }
    },

    _animateZoom: function (e) {
        var scale = this._map.getZoomScale(e.zoom),
            offset = this._map._getCenterOffset(e.center)._multiplyBy(-scale).subtract(this._map._getMapPanePos());

        if (L.DomUtil.setTransform) {
           L.DomUtil.setTransform(this._canvas, offset, scale);

        } else {
            this._canvas.style[L.DomUtil.TRANSFORM] = L.DomUtil.getTranslateString(offset) + ' scale(' + scale + ')';
        }
    }
});

L.radLayer = function (latlngs, options) {
    return new L.RadLayer(latlngs, options);
};
