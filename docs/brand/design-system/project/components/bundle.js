/* Unfurl preview helpers: the fiddlehead mark and progress rings. Plain DOM, no React. */
(function () {
  // The mark: the fiddlehead, a stem rising into a spiral with two young leaflets. 24-unit grid, round caps.
  var MARK =
    '<path d="M7.5 21.5 C7.5 16.5 8.6 12.6 11.6 10.1 C14.2 7.9 18.7 8.4 18.9 12.1 C19.1 15 16 16.4 14 14.9 C12.5 13.8 12.9 11.4 14.8 11.2 C16.1 11.1 16.9 12.3 16.2 13.2"/>' +
    '<path d="M8 18 C6.3 17 4.6 17.2 3.6 18.5"/><path d="M8.9 14.4 C7.5 13.2 5.8 13 4.7 13.9"/>';

  function mark(size, color) {
    var w = size < 28 ? 2.4 : 2;
    return (
      '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="' + (color || "currentColor") +
      '" stroke-width="' + w + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + MARK + "</svg>"
    );
  }

  function ring(el) {
    var size = +el.getAttribute("data-ring") || 104;
    var value = Math.max(0, Math.min(1, +el.getAttribute("data-value") || 0));
    var sw = +el.getAttribute("data-stroke") || 6;
    var r = (size - sw) / 2;
    var c = 2 * Math.PI * r;
    el.style.width = el.style.height = size + "px";
    el.insertAdjacentHTML(
      "afterbegin",
      '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + " " + size + '">' +
        '<circle class="track" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" stroke-width="' + sw + '"/>' +
        '<circle class="arc" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" stroke-width="' + sw + '" stroke-dasharray="' + c * value + " " + c + '"/></svg>'
    );
  }

  function render(root) {
    root = root || document;
    root.querySelectorAll("[data-mark]").forEach(function (el) {
      el.innerHTML = mark(+el.getAttribute("data-mark") || 24, el.getAttribute("data-color"));
    });
    root.querySelectorAll("[data-ring]").forEach(ring);
    root.querySelectorAll("[data-spark]").forEach(spark);
    root.querySelectorAll("[data-line]").forEach(line);
  }

  function nums(s) {
    return String(s).split(",").map(Number);
  }

  // Sparkline: data-spark="1,2,3"; fills its box, ends on a dot at the latest value.
  function spark(el) {
    var v = nums(el.getAttribute("data-spark"));
    var w = el.clientWidth || 140, h = el.clientHeight || 30, pad = 3;
    var lo = Math.min.apply(null, v), hi = Math.max.apply(null, v), span = hi - lo || 1;
    var pts = v.map(function (y, i) {
      return [pad + (i * (w - pad * 2)) / (v.length - 1), pad + (1 - (y - lo) / span) * (h - pad * 2)];
    });
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
    var last = pts[pts.length - 1];
    el.innerHTML =
      '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '" aria-hidden="true">' +
      '<path class="uf-spark-area" d="' + d + " L" + last[0].toFixed(1) + " " + h + " L" + pts[0][0].toFixed(1) + " " + h + ' Z"/>' +
      '<path class="uf-spark-line" d="' + d + '"/><circle class="uf-spark-end" cx="' + last[0] + '" cy="' + last[1] + '" r="3.5"/></svg>';
  }

  // Trend chart: data-line (daily values), data-avg (7-day average), data-goal, data-x (first,last label), data-unit.
  // Dots for each day, a line for the average, a dashed goal, and a crosshair readout on hover or touch.
  function line(el) {
    var v = nums(el.getAttribute("data-line"));
    var avg = el.hasAttribute("data-avg") ? nums(el.getAttribute("data-avg")) : null;
    var goal = el.hasAttribute("data-goal") ? +el.getAttribute("data-goal") : null;
    var unit = el.getAttribute("data-unit") || "";
    var xl = (el.getAttribute("data-x") || ",").split(",");
    var w = el.clientWidth || 320, h = +el.getAttribute("data-h") || 140, l = 4, r = 44, t = 10, b = 20;
    var all = v.concat(avg || []).concat(goal != null ? [goal] : []);
    var lo = Math.floor(Math.min.apply(null, all) - 0.3), hi = Math.ceil(Math.max.apply(null, all) + 0.3);
    var X = function (i) { return l + (i * (w - l - r)) / (v.length - 1); };
    var Y = function (y) { return t + (1 - (y - lo) / (hi - lo)) * (h - t - b); };
    var s = '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="' + (el.getAttribute("aria-label") || "") + '">';
    [lo, (lo + hi) / 2, hi].forEach(function (g) {
      s += '<line class="grid" x1="' + l + '" x2="' + (w - r) + '" y1="' + Y(g) + '" y2="' + Y(g) + '"/><text class="ax" x="' + (w - r + 6) + '" y="' + (Y(g) + 4) + '">' + (g % 1 ? g.toFixed(1) : g.toFixed(0)) + "</text>";
    });
    if (goal != null) s += '<line class="goal" x1="' + l + '" x2="' + (w - r) + '" y1="' + Y(goal) + '" y2="' + Y(goal) + '"/>';
    v.forEach(function (y, i) { s += '<circle class="raw" cx="' + X(i) + '" cy="' + Y(y) + '" r="2.5"/>'; });
    if (avg) {
      s += '<path class="avg" d="' + avg.map(function (y, i) { return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(y).toFixed(1); }).join(" ") + '"/>';
      var ly = Y(avg[avg.length - 1]);
      s += '<circle class="uf-spark-end" cx="' + X(avg.length - 1) + '" cy="' + ly + '" r="4"/>';
    }
    s += '<text class="ax" x="' + l + '" y="' + (h - 4) + '">' + xl[0] + '</text><text class="ax" x="' + (w - r) + '" y="' + (h - 4) + '" text-anchor="end">' + xl[1] + "</text>";
    s += '<line class="xh" visibility="hidden" y1="' + t + '" y2="' + (h - b) + '" x1="0" x2="0"/></svg><div class="uf-tip" hidden></div>';
    el.classList.add("uf-linechart");
    el.innerHTML = s;
    var xh = el.querySelector(".xh"), tip = el.querySelector(".uf-tip");
    var days = +el.getAttribute("data-days") || v.length;
    function show(ev) {
      var box = el.getBoundingClientRect();
      var i = Math.max(0, Math.min(v.length - 1, Math.round(((ev.clientX - box.left - l) / (w - l - r)) * (v.length - 1))));
      xh.setAttribute("x1", X(i)); xh.setAttribute("x2", X(i)); xh.setAttribute("visibility", "visible");
      tip.hidden = false;
      tip.style.left = X(i) + "px"; tip.style.top = Y(v[i]) + "px";
      tip.textContent = (days - (v.length - 1 - i) === days ? "Today" : (v.length - 1 - i) + "d ago") + " · " + v[i] + " " + unit + (avg ? " · avg " + avg[i] : "");
    }
    el.addEventListener("pointermove", show);
    el.addEventListener("pointerdown", show);
    el.addEventListener("pointerleave", function () { tip.hidden = true; xh.setAttribute("visibility", "hidden"); });
  }

  window.Unfurl = { mark: mark, render: render };
})();
